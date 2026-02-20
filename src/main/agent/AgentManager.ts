import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { AgentProcess, AgentProcessOptions } from './AgentProcess'
import type { AgentEvent, StreamEvent } from './types'
import { broadcastSend } from '../broadcast'

const SYSTEM_PROMPT_APPEND =
  'You are running inside ClaudeX, a desktop IDE. You have MCP tools for the IDE\'s terminal and browser panels. ' +
  'Terminal commands and browser navigation are visible to the user in real-time. ' +
  'Use terminal_execute to run commands and terminal_read to check output. ' +
  'Use browser_navigate, browser_content, and browser_screenshot to interact with web pages.'

/**
 * Manages multiple agent sessions, keyed by sessionId.
 * Each project can have multiple concurrent sessions.
 */
export class AgentManager {
  private agents: Map<string, AgentProcess> = new Map()
  private mainWindow: BrowserWindow | null = null
  private bridgePort = 0
  private bridgeToken = ''
  private mcpTempFiles: Map<string, string> = new Map()
  private deltaBuffer: Map<string, AgentEvent[]> = new Map()
  private deltaFlushPending: Set<string> = new Set()

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  setBridgeInfo(port: number, token: string): void {
    this.bridgePort = port
    this.bridgeToken = token
  }

  private getMcpServerPath(): string {
    // In development: resources/ at project root
    // In packaged app: process.resourcesPath
    if (app.isPackaged) {
      return join(process.resourcesPath, 'claudex-mcp-server.js')
    }
    return join(app.getAppPath(), 'resources', 'claudex-mcp-server.js')
  }

  private createMcpConfig(projectPath: string): string | null {
    if (!this.bridgePort || !this.bridgeToken) return null

    const mcpServerPath = this.getMcpServerPath()
    if (!existsSync(mcpServerPath)) {
      console.warn('[AgentManager] MCP server script not found:', mcpServerPath)
      return null
    }

    const config = {
      mcpServers: {
        'claudex-bridge': {
          command: 'node',
          args: [mcpServerPath],
          env: {
            CLAUDEX_BRIDGE_PORT: String(this.bridgePort),
            CLAUDEX_BRIDGE_TOKEN: this.bridgeToken,
            CLAUDEX_PROJECT_PATH: projectPath
          }
        }
      }
    }

    const tmpPath = join(tmpdir(), `claudex-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}.json`)
    writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8')
    return tmpPath
  }

  private cleanupTempFile(sessionId: string): void {
    const tmpPath = this.mcpTempFiles.get(sessionId)
    if (tmpPath) {
      try {
        unlinkSync(tmpPath)
      } catch {
        // ignore cleanup errors
      }
      this.mcpTempFiles.delete(sessionId)
    }
  }

  private flushDeltas(sessionId: string): void {
    const events = this.deltaBuffer.get(sessionId)
    if (!events || events.length === 0) return
    this.deltaBuffer.delete(sessionId)
    this.deltaFlushPending.delete(sessionId)
    broadcastSend(this.mainWindow,'agent:events', { sessionId, events })
  }

  private wireEvents(sessionId: string, agent: AgentProcess): void {
    agent.on('event', (event: AgentEvent) => {
      const isTextDelta =
        event.type === 'stream_event' &&
        (event as StreamEvent).event?.type === 'content_block_delta'

      if (isTextDelta) {
        const buf = this.deltaBuffer.get(sessionId) ?? []
        buf.push(event)
        this.deltaBuffer.set(sessionId, buf)
        if (!this.deltaFlushPending.has(sessionId)) {
          this.deltaFlushPending.add(sessionId)
          setImmediate(() => this.flushDeltas(sessionId))
        }
      } else {
        // Flush any buffered deltas before this non-delta event
        const pending = this.deltaBuffer.get(sessionId)
        if (pending && pending.length > 0) {
          this.deltaBuffer.delete(sessionId)
          this.deltaFlushPending.delete(sessionId)
          broadcastSend(this.mainWindow,'agent:events', { sessionId, events: pending })
        }
        broadcastSend(this.mainWindow,'agent:event', { sessionId, event })
      }
    })

    agent.on('close', (code: number | null) => {
      this.flushDeltas(sessionId)
      broadcastSend(this.mainWindow,'agent:closed', { sessionId, code })
    })

    agent.on('error', (err: Error) => {
      broadcastSend(this.mainWindow,'agent:error', { sessionId, error: err.message })
    })

    agent.on('stderr', (data: string) => {
      broadcastSend(this.mainWindow,'agent:stderr', { sessionId, data })
    })
  }

  startAgent(options: AgentProcessOptions, initialPrompt: string): string {
    // Generate MCP config for this session
    const mcpConfigPath = this.createMcpConfig(options.projectPath)

    const agentOptions: AgentProcessOptions = {
      ...options,
      mcpConfigPath,
      systemPromptAppend: mcpConfigPath ? SYSTEM_PROMPT_APPEND : null
    }

    const agent = new AgentProcess(agentOptions)
    const sessionId = agent.sessionId
    this.wireEvents(sessionId, agent)

    // Track temp file for cleanup
    if (mcpConfigPath) {
      this.mcpTempFiles.set(sessionId, mcpConfigPath)
    }

    // Clean up temp file when agent session closes
    agent.on('close', () => {
      this.cleanupTempFile(sessionId)
    })

    agent.start(initialPrompt)
    this.agents.set(sessionId, agent)
    return sessionId
  }

  /**
   * Send a follow-up message to an existing session.
   * This re-spawns the CLI with --resume since -p mode exits after each turn.
   */
  sendMessage(sessionId: string, content: string): void {
    const agent = this.agents.get(sessionId)
    if (!agent) {
      throw new Error(`No agent session found for ${sessionId}`)
    }

    if (agent.isRunning) {
      throw new Error('Agent is still processing — wait for it to finish')
    }

    // Re-wire events since we'll get a new process
    agent.removeAllListeners()
    this.wireEvents(sessionId, agent)
    agent.resume(content)
  }

  /**
   * Change the model used for subsequent agent spawns.
   */
  setModel(sessionId: string, model: string | null): void {
    const agent = this.agents.get(sessionId)
    if (agent) {
      agent.setModel(model)
    }
  }

  stopAgent(sessionId?: string): void {
    if (sessionId) {
      const agent = this.agents.get(sessionId)
      agent?.stop()
    } else {
      // Stop all agents
      for (const [, agent] of this.agents) {
        agent.stop()
      }
    }
  }

  getStatus(sessionId: string): {
    isRunning: boolean
    sessionId: string | null
    projectPath: string | null
    hasSession: boolean
  } {
    const agent = this.agents.get(sessionId)
    return {
      isRunning: agent?.isRunning ?? false,
      sessionId: agent?.sessionId ?? null,
      projectPath: agent?.projectPath ?? null,
      hasSession: agent?.hasCompletedFirstTurn ?? false
    }
  }
}
