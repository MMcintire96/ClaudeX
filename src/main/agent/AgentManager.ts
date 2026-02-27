import { app, BrowserWindow, Notification } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { AgentProcess, AgentProcessOptions } from './AgentProcess'
import type { AgentEvent, StreamEvent } from './types'
import { broadcastSend } from '../broadcast'
import { generateSessionTitle } from './TitleGenerator'
import type { SettingsManager } from '../settings/SettingsManager'
import type { NeovimManager } from '../neovim/NeovimManager'

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
  private deltaBuffer: Map<string, AgentEvent[]> = new Map()
  private deltaFlushPending: Set<string> = new Set()
  private static readonly MAX_DELTA_BUFFER = 500
  private initialPrompts: Map<string, string> = new Map()
  private titleGenerated: Set<string> = new Set()
  private settingsManager: SettingsManager | null = null
  private neovimManager: NeovimManager | null = null

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  setBridgeInfo(port: number, token: string): void {
    this.bridgePort = port
    this.bridgeToken = token
  }

  setSettingsManager(manager: SettingsManager): void {
    this.settingsManager = manager
  }

  setNeovimManager(manager: NeovimManager): void {
    this.neovimManager = manager
  }

  private getMcpServerPath(): string {
    // In development: resources/ at project root
    // In packaged app: process.resourcesPath
    if (app.isPackaged) {
      return join(process.resourcesPath, 'claudex-mcp-server.js')
    }
    return join(app.getAppPath(), 'resources', 'claudex-mcp-server.js')
  }

  private buildMcpServers(projectPath: string): Record<string, any> | null {
    if (!this.bridgePort || !this.bridgeToken) return null

    const mcpServerPath = this.getMcpServerPath()
    if (!existsSync(mcpServerPath)) {
      console.warn('[AgentManager] MCP server script not found:', mcpServerPath)
      return null
    }

    return {
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
        // Force-flush if buffer is getting large to prevent unbounded growth
        if (buf.length >= AgentManager.MAX_DELTA_BUFFER) {
          this.flushDeltas(sessionId)
        } else if (!this.deltaFlushPending.has(sessionId)) {
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

        // Refresh Neovim buffers when a tool finishes (files may have changed)
        if (event.type === 'tool_result' && this.neovimManager) {
          const agent = this.agents.get(sessionId)
          if (agent?.projectPath) {
            this.neovimManager.refreshBuffers(agent.projectPath)
          }
        }
      }
    })

    agent.on('close', (code: number | null) => {
      this.flushDeltas(sessionId)
      broadcastSend(this.mainWindow,'agent:closed', { sessionId, code })

      // Show native notification when agent finishes and window is not focused
      if (this.settingsManager?.get().notificationSounds !== false) {
        const isFocused = this.mainWindow?.isFocused() ?? false
        if (!isFocused && Notification.isSupported()) {
          const n = new Notification({
            title: 'Claude finished',
            body: code === 0 || code === null ? 'Task completed' : `Agent exited with code ${code}`,
            silent: false
          })
          n.show()
        }
      }

      // Generate title after first successful turn
      const prompt = this.initialPrompts.get(sessionId)
      if (prompt && !this.titleGenerated.has(sessionId)) {
        this.titleGenerated.add(sessionId)
        this.initialPrompts.delete(sessionId)
        generateSessionTitle(prompt).then(title => {
          if (title) {
            broadcastSend(this.mainWindow, 'agent:title', { sessionId, title })
          }
        })
      }
    })

    agent.on('error', (err: Error) => {
      broadcastSend(this.mainWindow,'agent:error', { sessionId, error: err.message })
    })
  }

  startAgent(options: AgentProcessOptions, initialPrompt: string): string {
    const mcpServers = this.buildMcpServers(options.projectPath)

    const agentOptions: AgentProcessOptions = {
      ...options,
      mcpServers,
      systemPromptAppend: mcpServers ? SYSTEM_PROMPT_APPEND : null
    }

    const agent = new AgentProcess(agentOptions)
    const sessionId = agent.sessionId
    this.wireEvents(sessionId, agent)

    this.initialPrompts.set(sessionId, initialPrompt)
    agent.start(initialPrompt)
    this.agents.set(sessionId, agent)
    return sessionId
  }

  /**
   * Resume a session that was restored from disk.
   * Creates a new AgentProcess with the saved sessionId and calls resume().
   */
  resumeAgent(sessionId: string, projectPath: string, model: string | null, message: string): string {
    const mcpServers = this.buildMcpServers(projectPath)
    const agent = new AgentProcess({
      projectPath,
      sessionId,
      model,
      mcpServers,
      systemPromptAppend: mcpServers ? SYSTEM_PROMPT_APPEND : null
    })
    this.wireEvents(sessionId, agent)
    agent.resume(message)
    this.agents.set(sessionId, agent)
    return sessionId
  }

  /**
   * Send a follow-up message to an existing session.
   * Uses SDK resume to continue the conversation.
   */
  sendMessage(sessionId: string, content: string): void {
    const agent = this.agents.get(sessionId)
    if (!agent) {
      throw new Error(`No agent session found for ${sessionId}`)
    }

    if (agent.isRunning) {
      throw new Error('Agent is still processing — wait for it to finish')
    }

    // Re-wire events for the new query
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
