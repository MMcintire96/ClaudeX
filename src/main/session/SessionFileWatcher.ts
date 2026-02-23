import { BrowserWindow } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import * as fs from 'fs'
import { broadcastSend } from '../broadcast'

interface WatcherState {
  projectDir: string
  activeFile: string | null
  activeSessionId: string | null
  offset: number
  dirWatcher: fs.FSWatcher | null
  fileWatcher: fs.FSWatcher | null
  pollTimer: ReturnType<typeof setInterval> | null
  filePollTimer: ReturnType<typeof setInterval> | null
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
    return p.replace(/[/_.~]/g, '-')
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
      } catch (err) {
        console.warn(`[SessionFileWatcher] Malformed JSONL line: ${trimmed.slice(0, 100)}`, err)
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
    } catch (err) {
      console.warn('[SessionFileWatcher] Error scanning project dir:', err)
      return null
    }
  }

  watch(terminalId: string, claudeSessionId: string | null, projectPath: string): SessionFileEntry[] {
    this.unwatch(terminalId)

    const projectDir = this.getProjectDir(projectPath)
    console.log(`[SessionFileWatcher] watch terminalId=${terminalId} sessionId=${claudeSessionId} projectDir=${projectDir}`)

    const state: WatcherState = {
      projectDir,
      activeFile: null,
      activeSessionId: null,
      offset: 0,
      dirWatcher: null,
      fileWatcher: null,
      pollTimer: null,
      filePollTimer: null,
      startedAt: Date.now()
    }

    this.watchers.set(terminalId, state)

    // If session ID is provided, attach directly to that file
    if (claudeSessionId) {
      const filePath = this.getSessionFilePath(claudeSessionId, projectPath)
      console.log(`[SessionFileWatcher] Watching specific file: ${filePath} (exists: ${fs.existsSync(filePath)})`)
      state.activeFile = filePath
      state.activeSessionId = claudeSessionId

      let initialEntries: SessionFileEntry[] = []
      try {
        if (fs.existsSync(filePath)) {
          const content = fs.readFileSync(filePath, 'utf-8')
          initialEntries = this.parseLines(content)
          state.offset = Buffer.byteLength(content, 'utf-8')
        }
      } catch (err) {
        console.warn(`[SessionFileWatcher] Error reading initial file ${filePath}:`, err)
      }

      this.startFileWatch(terminalId, state)
      // Don't start directory poll — it would switch to whichever file was most
      // recently modified, overriding the pinned session ID. If the user runs
      // /clear, TerminalManager will detect the new session ID and emit a new
      // terminal:claude-session-id event, triggering a fresh watch() call.
      return initialEntries
    }

    // Fallback: find active file by scanning directory
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

    // Clean up any previous file poll timer
    if (state.filePollTimer) {
      clearInterval(state.filePollTimer)
      state.filePollTimer = null
    }

    const filePath = state.activeFile
    const tryWatch = (): boolean => {
      if (!fs.existsSync(filePath)) return false
      try {
        state.fileWatcher = fs.watch(filePath, () => {
          this.readNewContent(terminalId, state)
        })
        // Read any content that appeared before the watcher was set up
        this.readNewContent(terminalId, state)
        return true
      } catch (err) {
        console.warn(`[SessionFileWatcher] fs.watch failed for ${filePath}:`, err)
        return false
      }
    }

    if (tryWatch()) return

    // File doesn't exist yet — poll until it appears (e.g. Claude CLI hasn't started writing)
    console.log(`[SessionFileWatcher] File not found yet, polling: ${filePath}`)
    let attempts = 0
    const maxAttempts = 60
    state.filePollTimer = setInterval(() => {
      attempts++
      // Stop if watcher was removed or terminal unwatched
      if (!this.watchers.has(terminalId)) {
        if (state.filePollTimer) clearInterval(state.filePollTimer)
        state.filePollTimer = null
        return
      }
      if (tryWatch()) {
        console.log(`[SessionFileWatcher] File appeared after ${attempts}s: ${filePath}`)
        if (state.filePollTimer) clearInterval(state.filePollTimer)
        state.filePollTimer = null
      } else if (attempts >= maxAttempts) {
        // Log what files DO exist in the directory to help debug path mismatches
        const dir = filePath.substring(0, filePath.lastIndexOf('/'))
        let dirContents = '(dir does not exist)'
        try {
          if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'))
            dirContents = files.length > 0 ? files.slice(-5).join(', ') : '(no .jsonl files)'
          }
        } catch { /* ignore */ }
        console.warn(`[SessionFileWatcher] Gave up waiting for file ${filePath} after ${maxAttempts}s. Dir contents: ${dirContents}`)
        this.sendError(terminalId, `Session file not found after ${maxAttempts}s — chat may not update. The session is still running in the terminal.`)
        if (state.filePollTimer) clearInterval(state.filePollTimer)
        state.filePollTimer = null
      }
    }, 1000)
  }

  private startDirectoryWatch(terminalId: string, state: WatcherState): void {
    // Poll the directory periodically to detect new session files
    // and changes (covers cases where fs.watch on the file doesn't fire)
    state.pollTimer = setInterval(() => {
      const found = this.findActiveFile(state.projectDir)
      if (!found) return

      if (found.filePath !== state.activeFile) {
        // New active file detected — switch to it
        console.log(`[SessionFileWatcher] ${terminalId}: switching to new session: ${found.sessionId}`)
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

      // File was rewritten (e.g. /compact) — re-read from scratch and send reset
      if (stat.size < state.offset) {
        console.log(`[SessionFileWatcher] file truncated for ${terminalId}, re-reading (compact?)`)
        const content = fs.readFileSync(state.activeFile, 'utf-8')
        const entries = this.parseLines(content)
        state.offset = Buffer.byteLength(content, 'utf-8')
        this.sendReset(terminalId, entries)
        return
      }

      if (stat.size <= state.offset) return

      const bytesToRead = stat.size - state.offset
      const fd = fs.openSync(state.activeFile, 'r')
      try {
        const buf = Buffer.alloc(bytesToRead)
        const bytesRead = fs.readSync(fd, buf, 0, buf.length, state.offset)
        // Only advance offset by actual bytes read, not expected size
        state.offset += bytesRead
        const text = buf.slice(0, bytesRead).toString('utf-8')
        const entries = this.parseLines(text)

        if (entries.length > 0) {
          console.log(`[SessionFileWatcher] new entries for ${terminalId}: ${entries.length}`)
          this.sendEntries(terminalId, entries)
        }
      } finally {
        fs.closeSync(fd)
      }
    } catch (err) {
      console.warn(`[SessionFileWatcher] Error reading content for ${terminalId}:`, err)
    }
  }

  private sendEntries(terminalId: string, entries: SessionFileEntry[]): void {
    broadcastSend(this.mainWindow, 'session-file:entries', terminalId, entries)
  }

  private sendReset(terminalId: string, entries: SessionFileEntry[]): void {
    broadcastSend(this.mainWindow, 'session-file:reset', terminalId, entries)
  }

  private sendError(terminalId: string, message: string): void {
    console.error(`[SessionFileWatcher] Error for ${terminalId}: ${message}`)
    broadcastSend(this.mainWindow, 'session-file:error', terminalId, message)
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
    if (state.filePollTimer) {
      clearInterval(state.filePollTimer)
      state.filePollTimer = null
    }
    this.watchers.delete(terminalId)
  }

  destroy(): void {
    for (const [id] of this.watchers) {
      this.unwatch(id)
    }
  }
}
