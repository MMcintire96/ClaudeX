import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

import { McpServerConfig } from '../mcp/McpManager'

export interface AppSettings {
  claude: {
    dangerouslySkipPermissions: boolean
  }
  modKey: string
  vimMode: boolean
  autoExpandEdits: boolean
  notificationSounds: boolean
  preventSleep: boolean
  suggestNextMessage: boolean
  sideBySideDiffs: boolean
  defaultModel: string
  defaultEffort: string
  fontSize: number
  fontFamily: string
  lineHeight: number
  showTimestamps: boolean
  compactMessages: boolean
  defaultMainTab: 'chat' | 'cc'
  mcpServers: McpServerConfig[]
  disabledRemoteMcpServers: string[] // Remote MCP server names that are disabled
  knownRemoteMcpServers: Record<string, string[]> // Persisted tool names per remote server
}

const DEFAULT_SETTINGS: AppSettings = {
  claude: {
    dangerouslySkipPermissions: false
  },
  modKey: 'Alt',
  vimMode: false,
  autoExpandEdits: false,
  notificationSounds: true,
  preventSleep: true,
  suggestNextMessage: true,
  sideBySideDiffs: false,
  defaultModel: 'claude-opus-4-6',
  defaultEffort: 'high',
  fontSize: 14.5,
  fontFamily: 'system',
  lineHeight: 1.65,
  showTimestamps: false,
  compactMessages: false,
  defaultMainTab: 'chat',
  mcpServers: [],
  disabledRemoteMcpServers: [],
  knownRemoteMcpServers: {},
}

/**
 * Manages persistent app settings stored as JSON in userData.
 */
export class SettingsManager {
  private settings: AppSettings = structuredClone(DEFAULT_SETTINGS)
  private configPath: string

  constructor() {
    this.configPath = join(app.getPath('userData'), 'settings.json')
  }

  async init(): Promise<void> {
    try {
      const data = await readFile(this.configPath, 'utf-8')
      const loaded = JSON.parse(data)
      // Deep merge with defaults so new keys are always present
      this.settings = {
        claude: { ...DEFAULT_SETTINGS.claude, ...loaded.claude },
        modKey: loaded.modKey ?? DEFAULT_SETTINGS.modKey,
        vimMode: loaded.vimMode ?? DEFAULT_SETTINGS.vimMode,
        autoExpandEdits: loaded.autoExpandEdits ?? DEFAULT_SETTINGS.autoExpandEdits,
        notificationSounds: loaded.notificationSounds ?? DEFAULT_SETTINGS.notificationSounds,
        preventSleep: loaded.preventSleep ?? DEFAULT_SETTINGS.preventSleep,
        suggestNextMessage: loaded.suggestNextMessage ?? DEFAULT_SETTINGS.suggestNextMessage,
        sideBySideDiffs: loaded.sideBySideDiffs ?? DEFAULT_SETTINGS.sideBySideDiffs,
        defaultModel: loaded.defaultModel ?? DEFAULT_SETTINGS.defaultModel,
        defaultEffort: loaded.defaultEffort ?? DEFAULT_SETTINGS.defaultEffort,
        fontSize: loaded.fontSize ?? DEFAULT_SETTINGS.fontSize,
        fontFamily: loaded.fontFamily ?? DEFAULT_SETTINGS.fontFamily,
        lineHeight: loaded.lineHeight ?? DEFAULT_SETTINGS.lineHeight,
        showTimestamps: loaded.showTimestamps ?? DEFAULT_SETTINGS.showTimestamps,
        compactMessages: loaded.compactMessages ?? DEFAULT_SETTINGS.compactMessages,
        defaultMainTab: loaded.defaultMainTab ?? DEFAULT_SETTINGS.defaultMainTab,
        mcpServers: Array.isArray(loaded.mcpServers) ? loaded.mcpServers : [],
        disabledRemoteMcpServers: Array.isArray(loaded.disabledRemoteMcpServers) ? loaded.disabledRemoteMcpServers : [],
        knownRemoteMcpServers: (loaded.knownRemoteMcpServers && typeof loaded.knownRemoteMcpServers === 'object') ? loaded.knownRemoteMcpServers : {},
      }
    } catch {
      this.settings = structuredClone(DEFAULT_SETTINGS)
    }
  }

  get(): AppSettings {
    return this.settings
  }

  async update(partial: Partial<AppSettings>): Promise<AppSettings> {
    if (partial.claude) {
      this.settings.claude = { ...this.settings.claude, ...partial.claude }
    }
    if (partial.modKey) {
      this.settings.modKey = partial.modKey
    }
    if (partial.vimMode !== undefined) {
      this.settings.vimMode = partial.vimMode
    }
    if (partial.autoExpandEdits !== undefined) {
      this.settings.autoExpandEdits = partial.autoExpandEdits
    }
    if (partial.notificationSounds !== undefined) {
      this.settings.notificationSounds = partial.notificationSounds
    }
    if (partial.preventSleep !== undefined) {
      this.settings.preventSleep = partial.preventSleep
    }
    if (partial.suggestNextMessage !== undefined) {
      this.settings.suggestNextMessage = partial.suggestNextMessage
    }
    if (partial.sideBySideDiffs !== undefined) {
      this.settings.sideBySideDiffs = partial.sideBySideDiffs
    }
    if (partial.defaultModel !== undefined) {
      this.settings.defaultModel = partial.defaultModel
    }
    if (partial.defaultEffort !== undefined) {
      this.settings.defaultEffort = partial.defaultEffort
    }
    if (partial.fontSize !== undefined) {
      this.settings.fontSize = partial.fontSize
    }
    if (partial.fontFamily !== undefined) {
      this.settings.fontFamily = partial.fontFamily
    }
    if (partial.lineHeight !== undefined) {
      this.settings.lineHeight = partial.lineHeight
    }
    if (partial.showTimestamps !== undefined) {
      this.settings.showTimestamps = partial.showTimestamps
    }
    if (partial.compactMessages !== undefined) {
      this.settings.compactMessages = partial.compactMessages
    }
    if (partial.defaultMainTab !== undefined) {
      this.settings.defaultMainTab = partial.defaultMainTab
    }
    if (partial.mcpServers !== undefined) {
      this.settings.mcpServers = partial.mcpServers
    }
    if (partial.disabledRemoteMcpServers !== undefined) {
      this.settings.disabledRemoteMcpServers = partial.disabledRemoteMcpServers
    }
    if (partial.knownRemoteMcpServers !== undefined) {
      this.settings.knownRemoteMcpServers = partial.knownRemoteMcpServers
    }
    await this.persist()
    return this.settings
  }

  getMcpServers(): McpServerConfig[] {
    return this.settings.mcpServers
  }

  async updateMcpServers(servers: McpServerConfig[]): Promise<void> {
    this.settings.mcpServers = servers
    await this.persist()
  }

  private async persist(): Promise<void> {
    try {
      const dir = app.getPath('userData')
      await mkdir(dir, { recursive: true })
      await writeFile(this.configPath, JSON.stringify(this.settings, null, 2))
    } catch {
      // Silently fail on persistence errors
    }
  }
}
