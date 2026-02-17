import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

export interface AppSettings {
  claude: {
    dangerouslySkipPermissions: boolean
  }
  modKey: string
  vimMode: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
  claude: {
    dangerouslySkipPermissions: false
  },
  modKey: 'Alt',
  vimMode: true
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
        vimMode: loaded.vimMode ?? DEFAULT_SETTINGS.vimMode
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
    await this.persist()
    return this.settings
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
