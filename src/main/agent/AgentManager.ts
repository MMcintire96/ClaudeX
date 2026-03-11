import { app, BrowserWindow } from 'electron'
import { join, basename } from 'path'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { AgentProcess, AgentProcessOptions } from './AgentProcess'
import { CodexProcess } from './CodexProcess'
import type { AgentEvent, StreamEvent, AssistantMessageEvent, ToolUseBlock } from './types'
import { broadcastSend } from '../broadcast'
import { generateSessionTitle } from './TitleGenerator'
import { generateSuggestion } from './SuggestionGenerator'
import { loadUserSkills, formatSkillsForPrompt } from './SkillLoader'
import type { SettingsManager } from '../settings/SettingsManager'
import type { NeovimManager } from '../neovim/NeovimManager'
import type { McpManager } from '../mcp/McpManager'
import type { ClaudexBridgeServer } from '../bridge/ClaudexBridgeServer'
import type { CheckpointManager } from '../checkpoint/CheckpointManager'

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
  private agents: Map<string, AgentProcess | CodexProcess> = new Map()
  private mainWindow: BrowserWindow | null = null
  private bridgePort = 0
  private bridgeToken = ''
  private deltaBuffer: Map<string, AgentEvent[]> = new Map()
  private deltaFlushPending: Set<string> = new Set()
  private static readonly MAX_DELTA_BUFFER = 500
  private initialPrompts: Map<string, string> = new Map()
  private titleGenerated: Set<string> = new Set()
  private lastUserMessage: Map<string, string> = new Map()
  private lastResultText: Map<string, string> = new Map()
  private sessionNames: Map<string, string> = new Map()
  private settingsManager: SettingsManager | null = null
  private neovimManager: NeovimManager | null = null
  private mcpManager: McpManager | null = null
  private bridgeServer: ClaudexBridgeServer | null = null
  private checkpointManager: CheckpointManager | null = null

  // Session pairing for split-view collaboration
  private sessionPartners: Map<string, string> = new Map()
  private pendingModifiedFiles: Map<string, Set<string>> = new Map()
  private pendingForwardQueue: Map<string, string> = new Map()
  private static readonly MAX_DIFF_SIZE = 8192

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

  setBridgeServer(server: ClaudexBridgeServer): void {
    this.bridgeServer = server
  }

  setCheckpointManager(manager: CheckpointManager): void {
    this.checkpointManager = manager
  }

  pairSessions(a: string, b: string): void {
    // Clear any existing pairings for these sessions
    this.unpairSession(a)
    this.unpairSession(b)
    this.sessionPartners.set(a, b)
    this.sessionPartners.set(b, a)
    console.log(`[AgentManager] Paired sessions: ${a.slice(0, 8)} <-> ${b.slice(0, 8)}`)
  }

  unpairSession(id: string): void {
    const partner = this.sessionPartners.get(id)
    if (partner) {
      this.sessionPartners.delete(partner)
      this.pendingForwardQueue.delete(partner)
    }
    this.sessionPartners.delete(id)
    this.pendingModifiedFiles.delete(id)
    this.pendingForwardQueue.delete(id)
  }

  setMcpManager(manager: McpManager): void {
    this.mcpManager = manager
    // Persist known remote server tool names whenever they're updated
    manager.on('knownServersUpdated', () => {
      if (this.settingsManager) {
        this.settingsManager.update({ knownRemoteMcpServers: manager.getKnownRemoteServers() }).catch(() => {})
      }
    })
  }

  private isCodexModel(model: string | null): boolean {
    if (!model) return false
    return model.startsWith('codex-') || model.startsWith('gpt-')
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

  private wireEvents(sessionId: string, agent: AgentProcess | CodexProcess): void {
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

        // Capture last result text for suggestion generation
        if (event.type === 'result' && (event as import('./types').ResultEvent).result) {
          this.lastResultText.set(sessionId, (event as import('./types').ResultEvent).result!)
        }

        // Track file modifications from Edit/Write tools for session pairing
        if (event.type === 'assistant') {
          const assistantEvent = event as AssistantMessageEvent
          const content = assistantEvent.message?.content
          if (Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'tool_use') {
                const toolBlock = block as ToolUseBlock
                if ((toolBlock.name === 'Edit' || toolBlock.name === 'Write') && toolBlock.input?.file_path) {
                  const files = this.pendingModifiedFiles.get(sessionId) ?? new Set()
                  files.add(String(toolBlock.input.file_path))
                  this.pendingModifiedFiles.set(sessionId, files)
                }
              }
            }
          }
        }

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

      // Notify renderer of modified files so it can create a checkpoint with the correct turn number
      const modifiedFiles = this.pendingModifiedFiles.get(sessionId)
      if (modifiedFiles && modifiedFiles.size > 0 && this.checkpointManager) {
        const agentRef = this.agents.get(sessionId)
        if (agentRef?.projectPath) {
          broadcastSend(this.mainWindow, 'checkpoint:files-modified', {
            sessionId,
            projectPath: agentRef.projectPath,
            filesModified: [...modifiedFiles],
            sdkSessionId: agentRef.sessionId
          })
        }
      }

      // Forward file changes to paired session
      this.forwardChangesToPartner(sessionId).catch(err => {
        console.warn('[AgentManager] Failed to forward changes to partner:', err)
      })
      // Drain any queued review messages for this session (partner sent changes while we were busy)
      this.drainForwardQueue(sessionId)

      this.bridgeServer?.unregisterSession(sessionId)
      broadcastSend(this.mainWindow,'agent:closed', { sessionId, code })

      // Always send Linux notification + sound when agent finishes
      const agent = this.agents.get(sessionId)
      const projectName = agent?.projectPath ? basename(agent.projectPath) : null
      const threadName = this.sessionNames.get(sessionId)
      let body: string
      if (code !== 0 && code !== null) {
        body = `Agent exited with code ${code}`
      } else if (threadName && projectName) {
        body = `${threadName} · ${projectName}`
      } else if (threadName) {
        body = threadName
      } else if (projectName) {
        body = `Task completed · ${projectName}`
      } else {
        body = 'Task completed'
      }
      const soundFile = '/usr/share/sounds/freedesktop/stereo/complete.oga'
      const notifyTitle = agent instanceof CodexProcess ? 'Codex finished' : 'Claude finished'
      execFile('notify-send', ['--app-name=ClaudeX', '--icon=dialog-information', notifyTitle, body], () => {})
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
            this.sessionNames.set(sessionId, title)
            // Update the bridge registry so session_list returns the friendly name
            const agent = this.agents.get(sessionId)
            if (agent?.projectPath) {
              this.bridgeServer?.registerSession(sessionId, title, agent.projectPath)
            }
            broadcastSend(this.mainWindow, 'agent:title', { sessionId, title })
          }
        })
      }

      // Generate next-message suggestion (if enabled in settings)
      const suggestEnabled = this.settingsManager?.get().suggestNextMessage ?? true
      const lastUser = this.lastUserMessage.get(sessionId)
      const lastResult = this.lastResultText.get(sessionId)
      if (suggestEnabled && lastUser && lastResult) {
        generateSuggestion(lastUser, lastResult).then(suggestion => {
          if (suggestion) {
            broadcastSend(this.mainWindow, 'agent:suggestion', { sessionId, suggestion })
          }
        })
      }
      this.lastResultText.delete(sessionId)
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
    const model = options.model ?? null

    if (this.isCodexModel(model)) {
      const agent = new CodexProcess({
        projectPath: options.projectPath,
        sessionId: options.sessionId,
        model,
      })
      const sessionId = agent.sessionId
      this.wireEvents(sessionId, agent)
      this.initialPrompts.set(sessionId, initialPrompt)
      this.lastUserMessage.set(sessionId, initialPrompt)
      this.bridgeServer?.registerSession(sessionId, `Session ${sessionId.slice(0, 8)}`, options.projectPath)
      agent.start(initialPrompt)
      this.agents.set(sessionId, agent)
      return sessionId
    }

    // Claude model — existing path
    // Ensure external .mcp.json configs are loaded for this project before building server list
    if (this.mcpManager) {
      await this.mcpManager.loadExternalConfigs(options.projectPath)
    }

    const mcpServers = this.buildMcpServers(options.projectPath)
    const systemPromptAppend = await this.buildSystemPromptAppend(!!mcpServers)
    const disallowedTools = this.mcpManager?.getDisallowedRemoteTools() ?? null

    const agentOptions: AgentProcessOptions = {
      ...options,
      mcpServers,
      systemPromptAppend,
      disallowedTools: disallowedTools && disallowedTools.length > 0 ? disallowedTools : null
    }

    const agent = new AgentProcess(agentOptions)
    const sessionId = agent.sessionId
    this.wireEvents(sessionId, agent)

    this.initialPrompts.set(sessionId, initialPrompt)
    this.lastUserMessage.set(sessionId, initialPrompt)
    this.bridgeServer?.registerSession(sessionId, `Session ${sessionId.slice(0, 8)}`, options.projectPath)
    agent.start(initialPrompt)
    this.agents.set(sessionId, agent)
    return sessionId
  }

  /**
   * Resume a session that was restored from disk.
   * Creates a new AgentProcess with the saved sessionId and calls resume().
   */
  async resumeAgent(sessionId: string, projectPath: string, model: string | null, message: string, effort?: string | null): Promise<string> {
    if (this.isCodexModel(model)) {
      const agent = new CodexProcess({
        projectPath,
        sessionId,
        model,
      })
      this.wireEvents(sessionId, agent)
      this.bridgeServer?.registerSession(sessionId, this.sessionNames.get(sessionId) || `Session ${sessionId.slice(0, 8)}`, projectPath)
      agent.resume(message)
      this.agents.set(sessionId, agent)
      return sessionId
    }

    // Claude model — existing path
    // Ensure external .mcp.json configs are loaded for this project before building server list
    if (this.mcpManager) {
      await this.mcpManager.loadExternalConfigs(projectPath)
    }

    const mcpServers = this.buildMcpServers(projectPath)
    const systemPromptAppend = await this.buildSystemPromptAppend(!!mcpServers)
    const disallowedTools = this.mcpManager?.getDisallowedRemoteTools() ?? null
    const agent = new AgentProcess({
      projectPath,
      sessionId,
      model,
      effort,
      mcpServers,
      systemPromptAppend,
      disallowedTools: disallowedTools && disallowedTools.length > 0 ? disallowedTools : null
    })
    this.wireEvents(sessionId, agent)
    this.bridgeServer?.registerSession(sessionId, this.sessionNames.get(sessionId) || `Session ${sessionId.slice(0, 8)}`, projectPath)
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

    // Refresh disallowed tools in case user toggled remote servers since session start
    if (this.mcpManager) {
      const disallowedTools = this.mcpManager.getDisallowedRemoteTools()
      agent.updateDisallowedTools(disallowedTools.length > 0 ? disallowedTools : null)
    }

    this.lastUserMessage.set(sessionId, content)
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

  setEffort(sessionId: string, effort: string | null): void {
    const agent = this.agents.get(sessionId)
    if (agent) {
      agent.setEffort(effort)
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

  // --- Session pairing: file change forwarding ---

  private async computeDiffForFiles(projectPath: string, files: Set<string>): Promise<string> {
    return new Promise((resolve) => {
      // Use git diff to get the actual changes for tracked files + untracked content
      const args = ['diff', 'HEAD', '--', ...files]
      execFile('git', args, { cwd: projectPath, maxBuffer: 64 * 1024 }, (err, stdout) => {
        if (err || !stdout.trim()) {
          // Fallback: try diff without HEAD (for new repos or untracked files)
          execFile('git', ['diff', '--', ...files], { cwd: projectPath, maxBuffer: 64 * 1024 }, (_err2, stdout2) => {
            resolve(stdout2?.trim() || '')
          })
          return
        }
        resolve(stdout.trim())
      })
    })
  }

  private async forwardChangesToPartner(sessionId: string): Promise<void> {
    const files = this.pendingModifiedFiles.get(sessionId)
    this.pendingModifiedFiles.delete(sessionId)
    if (!files || files.size === 0) return

    const partnerId = this.sessionPartners.get(sessionId)
    if (!partnerId) return

    const agent = this.agents.get(sessionId)
    if (!agent?.projectPath) return

    let diff = await this.computeDiffForFiles(agent.projectPath, files)
    if (!diff) return

    // Cap diff size
    let truncated = false
    if (diff.length > AgentManager.MAX_DIFF_SIZE) {
      diff = diff.slice(0, AgentManager.MAX_DIFF_SIZE)
      truncated = true
    }

    const fileList = [...files].map(f => `  - ${f}`).join('\n')
    const reviewMessage =
      `The paired session just made changes to the following files:\n${fileList}\n\n` +
      '```diff\n' + diff + '\n```' +
      (truncated ? '\n\n(Diff truncated — full changes are larger than 8KB)' : '') +
      '\n\nPlease review these changes. Focus on correctness, potential bugs, and code quality. ' +
      'Share your feedback using session_send().'

    const partnerAgent = this.agents.get(partnerId)
    if (!partnerAgent) {
      // Partner has no agent process yet — inject into bridge inbox
      this.bridgeServer?.injectMessage(partnerId, sessionId, this.sessionNames.get(sessionId) || 'Partner', reviewMessage)
      return
    }

    if (partnerAgent.isRunning) {
      // Partner is busy — queue message for when it finishes
      this.pendingForwardQueue.set(partnerId, reviewMessage)
      return
    }

    // Partner is idle — send directly
    try {
      broadcastSend(this.mainWindow, 'agent:forwarded-review', { sessionId: partnerId, content: reviewMessage })
      this.lastUserMessage.set(partnerId, reviewMessage)
      partnerAgent.removeAllListeners()
      this.wireEvents(partnerId, partnerAgent)
      partnerAgent.resume(reviewMessage)
    } catch (err) {
      console.warn('[AgentManager] Failed to send review to partner:', err)
    }
  }

  private drainForwardQueue(sessionId: string): void {
    const queuedMessage = this.pendingForwardQueue.get(sessionId)
    if (!queuedMessage) return
    this.pendingForwardQueue.delete(sessionId)

    const agent = this.agents.get(sessionId)
    if (!agent || agent.isRunning) return

    try {
      broadcastSend(this.mainWindow, 'agent:forwarded-review', { sessionId, content: queuedMessage })
      this.lastUserMessage.set(sessionId, queuedMessage)
      agent.removeAllListeners()
      this.wireEvents(sessionId, agent)
      agent.resume(queuedMessage)
    } catch (err) {
      console.warn('[AgentManager] Failed to drain forward queue:', err)
    }
  }
}
