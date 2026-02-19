import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'

export interface PersistedSession {
  id: string
  claudeSessionId?: string
  projectPath: string
  name: string
  createdAt: number
  lastActiveAt: number
}

export interface PersistedAppState {
  version: 1
  activeProjectPath: string | null
  expandedProjects: string[]
  sessions: PersistedSession[]
  theme: string
  sidebarWidth: number
}

export interface HistoryEntry {
  id: string
  claudeSessionId?: string
  projectPath: string
  name: string
  createdAt: number
  endedAt: number
}

const DEFAULT_STATE: PersistedAppState = {
  version: 1,
  activeProjectPath: null,
  expandedProjects: [],
  sessions: [],
  theme: 'dark',
  sidebarWidth: 240
}

export class SessionPersistence {
  private configDir: string
  private statePath: string
  private historyPath: string

  constructor() {
    this.configDir = join(app.getPath('userData'))
    this.statePath = join(this.configDir, 'session-state.json')
    this.historyPath = join(this.configDir, 'session-history.json')
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true })
    }
  }

  loadState(): PersistedAppState {
    try {
      if (existsSync(this.statePath)) {
        const raw = readFileSync(this.statePath, 'utf-8')
        const parsed = JSON.parse(raw) as PersistedAppState
        if (parsed.version === 1) return parsed
      }
    } catch (err) {
      console.warn('[SessionPersistence] Failed to load state:', err)
    }
    return { ...DEFAULT_STATE }
  }

  saveState(state: PersistedAppState): void {
    try {
      writeFileSync(this.statePath, JSON.stringify(state, null, 2), 'utf-8')
    } catch (err) {
      console.error('[SessionPersistence] Failed to save state:', err)
    }
  }

  addToHistory(entry: HistoryEntry): void {
    const history = this.getHistoryAll()
    history.push(entry)
    // Keep last 200 entries
    while (history.length > 200) history.shift()
    this.saveHistory(history)
  }

  getHistory(projectPath: string): HistoryEntry[] {
    return this.getHistoryAll().filter(e => e.projectPath === projectPath)
  }

  clearHistory(projectPath?: string): void {
    if (projectPath) {
      const history = this.getHistoryAll().filter(e => e.projectPath !== projectPath)
      this.saveHistory(history)
    } else {
      this.saveHistory([])
    }
  }

  private getHistoryAll(): HistoryEntry[] {
    try {
      if (existsSync(this.historyPath)) {
        const raw = readFileSync(this.historyPath, 'utf-8')
        return JSON.parse(raw) as HistoryEntry[]
      }
    } catch (err) {
      console.warn('[SessionPersistence] Failed to load history:', err)
    }
    return []
  }

  private saveHistory(history: HistoryEntry[]): void {
    try {
      writeFileSync(this.historyPath, JSON.stringify(history, null, 2), 'utf-8')
    } catch (err) {
      console.error('[SessionPersistence] Failed to save history:', err)
    }
  }
}
