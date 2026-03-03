import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { AgentProcess, AgentProcessOptions } from './AgentProcess'
import type { AgentEvent, StreamEvent } from './types'
import { broadcastSend } from '../broadcast'
import { generateSessionTitle } from './TitleGenerator'
import { loadUserSkills, formatSkillsForPrompt } from './SkillLoader'
import type { SettingsManager } from '../settings/SettingsManager'
import type { NeovimManager } from '../neovim/NeovimManager'
import type { McpManager } from '../mcp/McpManager'

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
  private mcpManager: McpManager | null = null

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

  setMcpManager(manager: McpManager): void {
    this.mcpManager = manager
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
    const servers: Record<string, any> = {}
    let hasServers = false

    // Add built-in claudex-bridge if bridge is configured and enabled
    const bridgeEnabled = this.mcpManager?.isBridgeEnabled() ?? true
    if (this.bridgePort && this.bridgeToken && bridgeEnabled) {
      const mcpServerPath = this.getMcpServerPath()
      if (existsSync(mcpServerPath)) {
        servers['claudex-bridge'] = {
          command: 'node',
          args: [mcpServerPath],
          env: {
            CLAUDEX_BRIDGE_PORT: String(this.bridgePort),
            CLAUDEX_BRIDGE_TOKEN: this.bridgeToken,
            CLAUDEX_PROJECT_PATH: projectPath
          }
        }
        hasServers = true
      } else {
        console.warn('[AgentManager] MCP server script not found:', mcpServerPath)
      }
    }

    // Add user-configured MCP servers that are enabled
    if (this.mcpManager) {
      const userServers = this.mcpManager.getEnabledServersForAgent()
      if (userServers) {
        for (const [id, config] of Object.entries(userServers)) {
          servers[id] = config
          hasServers = true
        }
      }
    }

    return hasServers ? servers : null
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
      // Handle system init events to capture Claude-reported MCP servers
      if (event.type === 'system' && event.subtype === 'init') {
        const systemEvent = event as import('./types').SystemInitEvent
        console.log('[AgentManager] SystemInitEvent received, tools:', systemEvent.tools?.length, 'mcp_servers:', systemEvent.mcp_servers, 'skills:', systemEvent.skills?.length, 'slash_commands:', systemEvent.slash_commands?.length)
        if (this.mcpManager && systemEvent.tools) {
          this.mcpManager.updateClaudeReportedServers(systemEvent.mcp_servers, systemEvent.tools)
        }
      }

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

      // Always send Linux notification + sound when agent finishes
      const body = code === 0 || code === null ? 'Task completed' : `Agent exited with code ${code}`
      const soundFile = '/usr/share/sounds/freedesktop/stereo/complete.oga'
      execFile('notify-send', ['--app-name=ClaudeX', '--icon=dialog-information', 'Claude finished', body], () => {})
      execFile('pw-play', [soundFile], (err) => {
        if (err) execFile('paplay', [soundFile], () => {})
      })

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

  private async buildSystemPromptAppend(hasMcp: boolean): Promise<string | null> {
    const parts: string[] = []
    if (hasMcp) {
      parts.push(SYSTEM_PROMPT_APPEND)
    }

    // Load user-defined skills from ~/.claude/skills/
    try {
      const skills = await loadUserSkills()
      if (skills.length > 0) {
        const skillSection = formatSkillsForPrompt(skills)
        parts.push(skillSection)
        console.log(`[AgentManager] Loaded ${skills.length} user skill(s): ${skills.map(s => s.name).join(', ')}`)
      }
    } catch (err) {
      console.warn('[AgentManager] Failed to load user skills:', err)
    }

    return parts.length > 0 ? parts.join('\n\n') : null
  }

  async startAgent(options: AgentProcessOptions, initialPrompt: string): Promise<string> {
    // Ensure external .mcp.json configs are loaded for this project before building server list
    if (this.mcpManager) {
      await this.mcpManager.loadExternalConfigs(options.projectPath)
    }

    const mcpServers = this.buildMcpServers(options.projectPath)
    const systemPromptAppend = await this.buildSystemPromptAppend(!!mcpServers)

    const agentOptions: AgentProcessOptions = {
      ...options,
      mcpServers,
      systemPromptAppend
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
  async resumeAgent(sessionId: string, projectPath: string, model: string | null, message: string): Promise<string> {
    // Ensure external .mcp.json configs are loaded for this project before building server list
    if (this.mcpManager) {
      await this.mcpManager.loadExternalConfigs(projectPath)
    }

    const mcpServers = this.buildMcpServers(projectPath)
    const systemPromptAppend = await this.buildSystemPromptAppend(!!mcpServers)
    const agent = new AgentProcess({
      projectPath,
      sessionId,
      model,
      mcpServers,
      systemPromptAppend
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
