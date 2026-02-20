import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { createHash } from 'crypto'

export interface StartCommand {
  name: string
  command: string
  cwd?: string
}

export interface ProjectStartConfig {
  commands: StartCommand[]
  browserUrl?: string
  buildCommand?: string
}

export class ProjectConfigManager {
  private configDir: string

  constructor() {
    this.configDir = join(app.getPath('userData'), 'project-configs')
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true })
    }
  }

  private hashPath(projectPath: string): string {
    return createHash('sha256').update(projectPath).digest('hex').slice(0, 16)
  }

  private configPath(projectPath: string): string {
    return join(this.configDir, `${this.hashPath(projectPath)}.json`)
  }

  getConfig(projectPath: string): ProjectStartConfig | null {
    try {
      const p = this.configPath(projectPath)
      if (existsSync(p)) {
        return JSON.parse(readFileSync(p, 'utf-8')) as ProjectStartConfig
      }
    } catch (err) {
      console.warn('[ProjectConfigManager] Failed to load config:', err)
    }
    return null
  }

  saveConfig(projectPath: string, config: ProjectStartConfig): void {
    try {
      writeFileSync(this.configPath(projectPath), JSON.stringify(config, null, 2), 'utf-8')
    } catch (err) {
      console.error('[ProjectConfigManager] Failed to save config:', err)
    }
  }

  hasConfig(projectPath: string): boolean {
    return existsSync(this.configPath(projectPath))
  }
}
