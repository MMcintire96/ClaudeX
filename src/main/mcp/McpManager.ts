import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { homedir } from 'os'

export interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  enabled: boolean // Whether Claude should use this server
  autoStart: boolean // Whether to auto-start when app launches
}

export interface McpServerStatus {
  id: string
  name: string
  running: boolean
  pid?: number
  error?: string
  enabled: boolean
  builtin?: boolean // True for built-in servers like claudex-bridge
  external?: boolean // True for servers loaded from ~/.mcp.json or project .mcp.json
  claudeReported?: boolean // True for servers reported by Claude sessions (like claude_ai_HubSpot)
  source?: string // Where the server config came from
  tools?: string[] // List of tool names (for Claude-reported servers)
}

// External MCP config structure (from ~/.mcp.json)
interface ExternalMcpConfig {
  mcpServers?: Record<string, {
    command: string
    args?: string[]
    env?: Record<string, string>
  }>
}

/**
 * Manages user-configured MCP servers.
 * Also tracks built-in servers like claudex-bridge and external configs from ~/.mcp.json
 */
export class McpManager extends EventEmitter {
  private servers: Map<string, McpServerConfig> = new Map()
  private processes: Map<string, ChildProcess> = new Map()
  private errors: Map<string, string> = new Map()
  
  // Built-in bridge info
  private bridgePort = 0
  private bridgeToken = ''
  private bridgeEnabled = true
  
  // External MCP servers (from ~/.mcp.json and project .mcp.json)
  private externalServers: Map<string, { config: McpServerConfig; source: string }> = new Map()
  private currentProjectPath: string | null = null
  
  // MCP servers reported by Claude sessions (like claude_ai_HubSpot)
  private claudeReportedServers: Map<string, { name: string; tools: string[] }> = new Map()

  // Remote MCP server names that the user has disabled
  private disabledRemoteServers: Set<string> = new Set()

  // Persisted tool names per remote server (survives session restarts)
  private knownRemoteServers: Map<string, string[]> = new Map()

  // Main window reference for broadcasting events
  private mainWindow: import('electron').BrowserWindow | null = null

  /**
   * Set the main window reference for broadcasting events
   */
  setMainWindow(win: import('electron').BrowserWindow): void {
    this.mainWindow = win
  }

  /**
   * Get the main window (for use by handlers)
   */
  getMainWindow(): import('electron').BrowserWindow | null {
    return this.mainWindow
  }

  /**
   * Set the built-in bridge info
   */
  setBridgeInfo(port: number, token: string): void {
    this.bridgePort = port
    this.bridgeToken = token
    this.emit('statusChanged', 'claudex-bridge')
  }

  /**
   * Check if the built-in bridge is active
   */
  isBridgeActive(): boolean {
    return this.bridgePort > 0 && this.bridgeToken.length > 0
  }

  /**
   * Toggle the built-in bridge enabled state
   */
  setBridgeEnabled(enabled: boolean): void {
    this.bridgeEnabled = enabled
    this.emit('configChanged')
  }

  /**
   * Get whether built-in bridge is enabled
   */
  isBridgeEnabled(): boolean {
    return this.bridgeEnabled
  }

  /**
   * Load server configs (called after settings are loaded)
   */
  loadConfigs(configs: McpServerConfig[]): void {
    this.servers.clear()
    for (const config of configs) {
      this.servers.set(config.id, config)
    }
  }

  /**
   * Load external MCP configs from ~/.mcp.json and .mcp.json files
   * found by traversing up from the project directory to the filesystem root.
   * Configs closer to the project take precedence (loaded last, overwriting earlier ones).
   */
  async loadExternalConfigs(projectPath?: string): Promise<void> {
    this.externalServers.clear()
    this.currentProjectPath = projectPath ?? null

    // Load global ~/.mcp.json
    const globalMcpPath = join(homedir(), '.mcp.json')
    await this.loadMcpJsonFile(globalMcpPath, 'Global (~/.mcp.json)')

    // Walk up from projectPath to root, collecting .mcp.json paths
    if (projectPath) {
      const home = resolve(homedir())
      const ancestors: string[] = []
      let dir = resolve(projectPath)

      while (true) {
        // Skip home dir — already loaded as global
        if (dir !== home) {
          ancestors.push(dir)
        }
        const parent = dirname(dir)
        if (parent === dir) break // reached filesystem root
        dir = parent
      }

      // Load from outermost ancestor first so that closer configs win (overwrite)
      ancestors.reverse()
      for (const ancestor of ancestors) {
        const mcpPath = join(ancestor, '.mcp.json')
        await this.loadMcpJsonFile(mcpPath, `Project (${ancestor})`)
      }
    }

    this.emit('configChanged')
  }

  /**
   * Load MCP servers from a .mcp.json file
   */
  private async loadMcpJsonFile(filePath: string, source: string): Promise<void> {
    if (!existsSync(filePath)) return

    try {
      const content = await readFile(filePath, 'utf-8')
      const config: ExternalMcpConfig = JSON.parse(content)
      
      if (config.mcpServers) {
        for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
          const id = `external-${name}`
          this.externalServers.set(id, {
            config: {
              id,
              name,
              command: serverConfig.command,
              args: serverConfig.args ?? [],
              env: serverConfig.env,
              enabled: true, // External servers are enabled by default
              autoStart: false
            },
            source
          })
        }
      }
    } catch (err) {
      console.warn(`[McpManager] Failed to load ${filePath}:`, err)
    }
  }

  /**
   * Refresh external configs when project changes
   */
  async setProjectPath(projectPath: string | null): Promise<void> {
    if (projectPath !== this.currentProjectPath) {
      await this.loadExternalConfigs(projectPath ?? undefined)
    }
  }

  /**
   * Update MCP servers reported by a Claude session
   * Called when we receive a system init event from the agent
   */
  updateClaudeReportedServers(mcpServers: Record<string, unknown>[] | undefined, tools: string[]): void {
    console.log('[McpManager] updateClaudeReportedServers called with', tools.length, 'tools')
    
    // Extract MCP server names from tools (format: mcp__servername__toolname)
    // Server names can contain single underscores (e.g., claude_ai_HubSpot)
    // Separators are double underscores (__)
    // Example: mcp__claude_ai_HubSpot__search_crm_objects
    //   -> server: claude_ai_HubSpot, tool: search_crm_objects
    const serverTools: Map<string, string[]> = new Map()
    
    for (const tool of tools) {
      if (!tool.startsWith('mcp__')) continue
      
      // Remove "mcp__" prefix and split by "__" (double underscore)
      const withoutPrefix = tool.slice(5) // Remove "mcp__"
      const parts = withoutPrefix.split('__')
      
      console.log('[McpManager] Parsing tool:', tool, '-> parts:', parts)
      
      if (parts.length >= 2) {
        // First part is server name, last part is tool name
        // If there are more than 2 parts, the middle ones are part of server name
        const serverName = parts.slice(0, -1).join('__')
        const toolName = parts[parts.length - 1]
        
        console.log('[McpManager] Extracted server:', serverName, 'tool:', toolName)
        
        if (!serverTools.has(serverName)) {
          serverTools.set(serverName, [])
        }
        serverTools.get(serverName)!.push(toolName)
      }
    }
    
    console.log('[McpManager] Found servers:', Array.from(serverTools.keys()))
    
    // Update claude-reported servers
    let changed = false
    let knownChanged = false
    for (const [serverName, toolList] of serverTools) {
      // Skip our own bridge
      if (serverName === 'claudex-bridge') continue

      const existing = this.claudeReportedServers.get(serverName)
      if (!existing || existing.tools.length !== toolList.length) {
        this.claudeReportedServers.set(serverName, { name: serverName, tools: toolList })
        changed = true
      }

      // Persist tool names so they're available before system_init fires in new sessions
      const knownTools = this.knownRemoteServers.get(serverName)
      if (!knownTools || knownTools.length !== toolList.length) {
        this.knownRemoteServers.set(serverName, toolList)
        knownChanged = true
      }
    }

    if (changed) {
      this.emit('configChanged')
    }
    if (knownChanged) {
      this.emit('knownServersUpdated')
    }
  }

  /**
   * Clear Claude-reported servers (e.g., when session ends)
   */
  clearClaudeReportedServers(): void {
    if (this.claudeReportedServers.size > 0) {
      this.claudeReportedServers.clear()
      this.emit('configChanged')
    }
  }

  /**
   * Load disabled remote server names from settings
   */
  loadDisabledRemoteServers(names: string[]): void {
    this.disabledRemoteServers = new Set(names)
  }

  /**
   * Load persisted known remote server tool names from settings
   */
  loadKnownRemoteServers(servers: Record<string, string[]>): void {
    this.knownRemoteServers = new Map(Object.entries(servers))
  }

  /**
   * Get known remote server tool names for persistence
   */
  getKnownRemoteServers(): Record<string, string[]> {
    return Object.fromEntries(this.knownRemoteServers)
  }

  /**
   * Toggle a remote MCP server's enabled state
   * Returns the updated list of disabled server names for persistence
   */
  setRemoteServerEnabled(serverName: string, enabled: boolean): string[] {
    if (enabled) {
      this.disabledRemoteServers.delete(serverName)
    } else {
      this.disabledRemoteServers.add(serverName)
    }
    this.emit('configChanged')
    return Array.from(this.disabledRemoteServers)
  }

  /**
   * Get disallowed tool names for disabled remote MCP servers.
   * These are full tool names (mcp__servername__toolname) that should be
   * passed to the SDK's disallowedTools option.
   * Uses claudeReportedServers when available, falls back to persisted knownRemoteServers.
   */
  getDisallowedRemoteTools(): string[] {
    const disallowed: string[] = []
    for (const serverName of this.disabledRemoteServers) {
      // Prefer live tool list; fall back to persisted known tools
      const serverInfo = this.claudeReportedServers.get(serverName)
      const tools = serverInfo?.tools ?? this.knownRemoteServers.get(serverName)
      if (tools) {
        for (const tool of tools) {
          disallowed.push(`mcp__${serverName}__${tool}`)
        }
      }
    }
    return disallowed
  }

  /**
   * Get all configured servers with their status
   */
  getServers(): McpServerStatus[] {
    const result: McpServerStatus[] = []
    
    // Add built-in claudex-bridge first
    result.push({
      id: 'claudex-bridge',
      name: 'ClaudeX Bridge',
      running: this.isBridgeActive(),
      enabled: this.bridgeEnabled,
      builtin: true
    })
    
    // Add external servers from ~/.mcp.json and project .mcp.json
    for (const [id, { config, source }] of this.externalServers) {
      result.push({
        id,
        name: config.name,
        running: true, // External servers are managed by Claude, assumed running
        enabled: config.enabled,
        external: true,
        source
      })
    }
    
    // Add user-configured servers (from ClaudeX settings)
    for (const [id, config] of this.servers) {
      const process = this.processes.get(id)
      result.push({
        id,
        name: config.name,
        running: !!process && !process.killed,
        pid: process?.pid,
        error: this.errors.get(id),
        enabled: config.enabled
      })
    }
    
    // Add Claude-reported servers (authenticated remote MCPs like claude_ai_HubSpot)
    for (const [serverName, serverInfo] of this.claudeReportedServers) {
      result.push({
        id: `claude-reported-${serverName}`,
        name: serverName,
        running: true, // Always considered running since they're active in Claude
        enabled: !this.disabledRemoteServers.has(serverName),
        claudeReported: true,
        source: 'Claude Account (Remote MCP)',
        tools: serverInfo.tools
      })
    }
    
    return result
  }

  /**
   * Get configs for servers that are enabled for Claude to use
   */
  getEnabledServersForAgent(): Record<string, { command: string; args: string[]; env?: Record<string, string> }> | null {
    const enabled: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {}
    let hasEnabled = false

    // Include external servers from .mcp.json files
    for (const [, { config }] of this.externalServers) {
      if (config.enabled) {
        enabled[config.name] = {
          command: config.command,
          args: config.args,
          env: config.env
        }
        hasEnabled = true
      }
    }

    // User-configured servers (can override external ones with same name)
    for (const [id, config] of this.servers) {
      if (config.enabled) {
        enabled[id] = {
          command: config.command,
          args: config.args,
          env: config.env
        }
        hasEnabled = true
      }
    }

    return hasEnabled ? enabled : null
  }

  /**
   * Add or update a server config
   */
  upsertServer(config: McpServerConfig): void {
    this.servers.set(config.id, config)
    this.emit('configChanged')
  }

  /**
   * Remove a server config
   */
  removeServer(id: string): void {
    this.stopServer(id)
    this.servers.delete(id)
    this.errors.delete(id)
    this.emit('configChanged')
  }

  /**
   * Start an MCP server process
   */
  startServer(id: string): boolean {
    const config = this.servers.get(id)
    if (!config) {
      this.errors.set(id, 'Server config not found')
      return false
    }

    // Already running?
    const existing = this.processes.get(id)
    if (existing && !existing.killed) {
      return true
    }

    try {
      this.errors.delete(id)
      
      const proc = spawn(config.command, config.args, {
        env: { ...process.env, ...config.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false
      })

      proc.on('error', (err) => {
        this.errors.set(id, err.message)
        this.emit('statusChanged', id)
      })

      proc.on('exit', (code, signal) => {
        this.processes.delete(id)
        if (code !== 0 && code !== null) {
          this.errors.set(id, `Exited with code ${code}`)
        } else if (signal) {
          this.errors.set(id, `Killed by signal ${signal}`)
        }
        this.emit('statusChanged', id)
      })

      // Capture stderr for error reporting
      proc.stderr?.on('data', (data) => {
        const msg = data.toString().trim()
        if (msg) {
          this.errors.set(id, msg)
          this.emit('statusChanged', id)
        }
      })

      this.processes.set(id, proc)
      this.emit('statusChanged', id)
      return true
    } catch (err) {
      this.errors.set(id, err instanceof Error ? err.message : String(err))
      this.emit('statusChanged', id)
      return false
    }
  }

  /**
   * Stop an MCP server process
   */
  stopServer(id: string): void {
    const proc = this.processes.get(id)
    if (proc && !proc.killed) {
      proc.kill('SIGTERM')
      // Force kill after timeout
      setTimeout(() => {
        if (!proc.killed) {
          proc.kill('SIGKILL')
        }
      }, 3000)
    }
    this.processes.delete(id)
    this.emit('statusChanged', id)
  }

  /**
   * Toggle whether Claude uses this server
   */
  setEnabled(id: string, enabled: boolean): void {
    const config = this.servers.get(id)
    if (config) {
      config.enabled = enabled
      this.emit('configChanged')
    }
  }

  /**
   * Start all servers marked as autoStart
   */
  startAutoStartServers(): void {
    for (const [id, config] of this.servers) {
      if (config.autoStart) {
        this.startServer(id)
      }
    }
  }

  /**
   * Stop all running servers
   */
  stopAll(): void {
    for (const id of this.processes.keys()) {
      this.stopServer(id)
    }
  }

  /**
   * Get raw configs for persistence
   */
  getConfigs(): McpServerConfig[] {
    return Array.from(this.servers.values())
  }

  /**
   * Get a single server config by ID
   */
  getServerConfig(id: string): McpServerConfig | null {
    return this.servers.get(id) ?? null
  }
}
