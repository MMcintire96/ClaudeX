import { BrowserWindow } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import * as fs from 'fs'

interface WatcherState {
  projectDir: string
  activeFile: string | null
  activeSessionId: string | null
  offset: number
  dirWatcher: fs.FSWatcher | null
  fileWatcher: fs.FSWatcher | null
  pollTimer: ReturnType<typeof setInterval> | null
  startedAt: number
}

export interface SessionFileEntry {
  type: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any
}

export class SessionFileWatcher {
  private watchers = new Map<string, WatcherState>()
  private mainWindow: BrowserWindow | null = null

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  hashProjectPath(p: string): string {
    return p.replace(/\//g, '-')
  }

  getProjectDir(projectPath: string): string {
    const hash = this.hashProjectPath(projectPath)
    return join(homedir(), '.claude', 'projects', hash)
  }

  getSessionFilePath(claudeSessionId: string, projectPath: string): string {
    return join(this.getProjectDir(projectPath), `${claudeSessionId}.jsonl`)
  }

  parseLines(text: string): SessionFileEntry[] {
    const entries: SessionFileEntry[] = []
    const lines = text.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const parsed = JSON.parse(trimmed)
        if (parsed && typeof parsed === 'object' && parsed.type) {
          entries.push(parsed)
        }
      } catch {
        // skip malformed lines
      }
    }
    return entries
  }

  /**
   * Find the most recently modified JSONL file in the project dir.
   * Returns the file path and session ID.
   */
  private findActiveFile(projectDir: string, afterMs?: number): { filePath: string; sessionId: string } | null {
    if (!fs.existsSync(projectDir)) return null
    try {
      const files = fs.readdirSync(projectDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => {
          const fullPath = join(projectDir, f)
          const stat = fs.statSync(fullPath)
          return { name: f, fullPath, mtime: stat.mtimeMs }
        })
        .filter(f => !afterMs || f.mtime >= afterMs)
        .sort((a, b) => b.mtime - a.mtime)

      if (files.length === 0) return null
      return {
        filePath: files[0].fullPath,
        sessionId: files[0].name.replace(/\.jsonl$/, '')
      }
    } catch {
      return null
    }
  }

  watch(terminalId: string, _claudeSessionId: string | null, projectPath: string): SessionFileEntry[] {
    this.unwatch(terminalId)

    const projectDir = this.getProjectDir(projectPath)
    console.log(`[SessionFileWatcher] watch terminalId=${terminalId} projectDir=${projectDir}`)

    const state: WatcherState = {
      projectDir,
      activeFile: null,
      activeSessionId: null,
      offset: 0,
      dirWatcher: null,
      fileWatcher: null,
      pollTimer: null,
      startedAt: Date.now()
    }

    this.watchers.set(terminalId, state)

    // Try to find active file immediately
    const initial = this.findAndAttachFile(terminalId, state)

    // Also watch the directory for new/changed files
    this.startDirectoryWatch(terminalId, state)

    return initial
  }

  private findAndAttachFile(terminalId: string, state: WatcherState): SessionFileEntry[] {
    const found = this.findActiveFile(state.projectDir)
    if (!found) return []

    // If we're already watching this file, don't re-attach
    if (state.activeFile === found.filePath) return []

    console.log(`[SessionFileWatcher] attaching to file: ${found.sessionId} (${found.filePath})`)

    // Close old file watcher
    if (state.fileWatcher) {
      state.fileWatcher.close()
      state.fileWatcher = null
    }

    state.activeFile = found.filePath
    state.activeSessionId = found.sessionId

    // Read existing content
    let initialEntries: SessionFileEntry[] = []
    if (fs.existsSync(found.filePath)) {
      const content = fs.readFileSync(found.filePath, 'utf-8')
      initialEntries = this.parseLines(content)
      state.offset = Buffer.byteLength(content, 'utf-8')
    }

    // Watch the specific file for changes
    this.startFileWatch(terminalId, state)

    return initialEntries
  }

  private startFileWatch(terminalId: string, state: WatcherState): void {
    if (!state.activeFile) return
    try {
      state.fileWatcher = fs.watch(state.activeFile, () => {
        this.readNewContent(terminalId, state)
      })
    } catch {
      // fs.watch failed, rely on polling via directory watch
    }
  }

  private startDirectoryWatch(terminalId: string, state: WatcherState): void {
    // Poll the directory periodically to detect new session files
    // and changes (covers cases where fs.watch on the file doesn't fire)
    state.pollTimer = setInterval(() => {
      const found = this.findActiveFile(state.projectDir)
      if (!found) return

      if (found.filePath !== state.activeFile) {
        // New active file detected — switch to it
        console.log(`[SessionFileWatcher] switching to new session: ${found.sessionId}`)
        if (state.fileWatcher) {
          state.fileWatcher.close()
          state.fileWatcher = null
        }
        state.activeFile = found.filePath
        state.activeSessionId = found.sessionId
        state.offset = 0

        // Read full content of new file
        if (fs.existsSync(found.filePath)) {
          const content = fs.readFileSync(found.filePath, 'utf-8')
          const entries = this.parseLines(content)
          state.offset = Buffer.byteLength(content, 'utf-8')
          if (entries.length > 0) {
            // Send a special 'reset' then all entries
            this.sendReset(terminalId, entries)
          }
        }
        this.startFileWatch(terminalId, state)
      } else {
        // Same file, check for new content (backup for fs.watch)
        this.readNewContent(terminalId, state)
      }
    }, 1500)
  }

  private readNewContent(terminalId: string, state: WatcherState): void {
    if (!state.activeFile) return
    try {
      const stat = fs.statSync(state.activeFile)
      if (stat.size <= state.offset) return

      const fd = fs.openSync(state.activeFile, 'r')
      const buf = Buffer.alloc(stat.size - state.offset)
      fs.readSync(fd, buf, 0, buf.length, state.offset)
      fs.closeSync(fd)

      state.offset = stat.size
      const text = buf.toString('utf-8')
      const entries = this.parseLines(text)

      if (entries.length > 0) {
        console.log(`[SessionFileWatcher] new entries for ${terminalId}: ${entries.length}`)
        this.sendEntries(terminalId, entries)
      }
    } catch {
      // File may be temporarily unavailable
    }
  }

  private sendEntries(terminalId: string, entries: SessionFileEntry[]): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('session-file:entries', terminalId, entries)
    }
  }

  private sendReset(terminalId: string, entries: SessionFileEntry[]): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('session-file:reset', terminalId, entries)
    }
  }

  findLatestSessionId(projectPath: string, _afterTimestamp?: number): string | null {
    const projectDir = this.getProjectDir(projectPath)
    const found = this.findActiveFile(projectDir)
    return found?.sessionId ?? null
  }

  readAll(claudeSessionId: string, projectPath: string): SessionFileEntry[] {
    const filePath = this.getSessionFilePath(claudeSessionId, projectPath)
    if (!fs.existsSync(filePath)) return []
    const content = fs.readFileSync(filePath, 'utf-8')
    return this.parseLines(content)
  }

  unwatch(terminalId: string): void {
    const state = this.watchers.get(terminalId)
    if (!state) return

    if (state.fileWatcher) {
      state.fileWatcher.close()
      state.fileWatcher = null
    }
    if (state.dirWatcher) {
      state.dirWatcher.close()
      state.dirWatcher = null
    }
    if (state.pollTimer) {
      clearInterval(state.pollTimer)
      state.pollTimer = null
    }
    this.watchers.delete(terminalId)
  }

  destroy(): void {
    for (const [id] of this.watchers) {
      this.unwatch(id)
    }
  }
}
