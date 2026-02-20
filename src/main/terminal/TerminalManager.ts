import { BrowserWindow, Notification } from 'electron'
import * as pty from 'node-pty'
import { v4 as uuidv4 } from 'uuid'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'

export interface TerminalInfo {
  id: string
  projectPath: string
  pid: number
}

interface ManagedTerminal {
  id: string
  projectPath: string
  pty: pty.IPty
  outputBuffer: string[]
  partialLine: string
}

type ClaudeStatus = 'running' | 'idle' | 'attention' | 'done'

interface ClaudeMeta {
  lastDataTimestamp: number
  status: ClaudeStatus
  silenceTimer: ReturnType<typeof setTimeout> | null
  hasBeenRunning: boolean
  autoRenamed: boolean
  idleCycleCount: number
}

const ATTENTION_PATTERNS = /\b(allow|approve|permission|accept)\b|\(y\/n\)|\(yes\/no\)|do you want|would you like/i

/**
 * Manages per-project PTY terminal instances.
 * Each project can have multiple terminals.
 */
export class TerminalManager {
  private terminals: Map<string, Map<string, ManagedTerminal>> = new Map()
  private mainWindow: BrowserWindow | null = null
  private claudeMeta: Map<string, ClaudeMeta> = new Map()
  private terminalNames: Map<string, string> = new Map()
  private claudeSessionIds: Map<string, string> = new Map()
  private createdAt: Map<string, number> = new Map()
  private lastNotificationTime: Map<string, number> = new Map()
  private contextUsage: Map<string, number> = new Map()

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  private getDefaultShell(): string {
    if (process.platform === 'win32') {
      return process.env.COMSPEC || 'cmd.exe'
    }
    return process.env.SHELL || '/bin/bash'
  }

  create(projectPath: string): TerminalInfo {
    const id = uuidv4()
    const shell = this.getDefaultShell()

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: projectPath,
      env: process.env as Record<string, string>
    })

    return this._registerPty(id, projectPath, ptyProcess)
  }

  createWithCommand(
    projectPath: string,
    command: string,
    args: string[],
    env?: Record<string, string>,
    onExit?: () => void,
    predefinedId?: string
  ): TerminalInfo {
    const id = predefinedId || uuidv4()

    const mergedEnv = { ...(process.env as Record<string, string>), ...env }

    const ptyProcess = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: projectPath,
      env: mergedEnv
    })

    if (onExit) {
      ptyProcess.onExit(() => onExit())
    }

    return this._registerPty(id, projectPath, ptyProcess)
  }

  setTerminalName(id: string, name: string): void {
    this.terminalNames.set(id, name)
  }

  getTerminalName(id: string): string | null {
    return this.terminalNames.get(id) || null
  }

  getClaudeSessionId(terminalId: string): string | null {
    return this.claudeSessionIds.get(terminalId) || null
  }

  getCreatedAt(terminalId: string): number {
    return this.createdAt.get(terminalId) || Date.now()
  }

  getContextUsage(terminalId: string): number {
    return this.contextUsage.get(terminalId) || 0
  }

  private emitClaudeSessionId(terminalId: string, sessionId: string): void {
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('terminal:claude-session-id', terminalId, sessionId)
      }
    } catch {
      // Window destroyed
    }
  }

  private emitContextUsage(id: string, percent: number): void {
    const prev = this.contextUsage.get(id)
    if (prev === percent) return
    this.contextUsage.set(id, percent)
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('terminal:context-usage', id, percent)
      }
    } catch {
      // Window destroyed
    }
  }

  registerClaudeTerminal(id: string): void {
    this.claudeMeta.set(id, {
      lastDataTimestamp: Date.now(),
      status: 'idle',
      silenceTimer: null,
      hasBeenRunning: false,
      autoRenamed: false,
      idleCycleCount: 0
    })

    // Proactively detect session ID by watching for new .jsonl files
    this.detectSessionIdFromDir(id)
  }

  /**
   * Scan the project's Claude session directory for new JSONL files.
   * When a Claude terminal starts, it creates a new session file within a few seconds.
   * We poll the directory to detect it and associate it with this terminal.
   */
  private detectSessionIdFromDir(terminalId: string): void {
    // Find the project path for this terminal
    let projectPath: string | null = null
    for (const [pp, termMap] of this.terminals) {
      if (termMap.has(terminalId)) {
        projectPath = pp
        break
      }
    }
    if (!projectPath) return

    const projectHash = projectPath.replace(/[/_]/g, '-')
    const sessionDir = path.join(os.homedir(), '.claude', 'projects', projectHash)
    const startTime = Date.now()

    // Get existing files before the terminal started
    let existingFiles: Set<string>
    try {
      existingFiles = new Set(
        fs.readdirSync(sessionDir).filter(f => f.endsWith('.jsonl'))
      )
    } catch {
      existingFiles = new Set()
    }

    // Poll for new files (up to 30 seconds)
    let attempts = 0
    const maxAttempts = 30
    const timer = setInterval(() => {
      attempts++

      // Stop if session ID already found (e.g. from regex match)
      if (this.claudeSessionIds.has(terminalId) || attempts >= maxAttempts) {
        clearInterval(timer)
        return
      }

      // Stop if terminal was removed
      if (!this.claudeMeta.has(terminalId)) {
        clearInterval(timer)
        return
      }

      try {
        if (!fs.existsSync(sessionDir)) return

        const currentFiles = fs.readdirSync(sessionDir).filter(f => f.endsWith('.jsonl'))
        const claimedSessions = new Set(this.claudeSessionIds.values())

        // Strategy 1: Look for entirely new files (didn't exist when terminal started)
        for (const file of currentFiles) {
          if (existingFiles.has(file)) continue

          const filePath = path.join(sessionDir, file)
          const stat = fs.statSync(filePath)
          if (stat.mtimeMs >= startTime - 2000) {
            const sessionId = file.replace(/\.jsonl$/, '')
            if (claimedSessions.has(sessionId)) continue
            console.log(`[TerminalManager] Detected session ID for ${terminalId}: ${sessionId} (new file)`)
            this.claudeSessionIds.set(terminalId, sessionId)
            this.emitClaudeSessionId(terminalId, sessionId)
            clearInterval(timer)
            return
          }
        }

        // Strategy 2: If no new file, look for recently modified unclaimed files.
        // This handles cases where Claude reuses a session file or it was created
        // just before our snapshot.
        if (attempts >= 5) {
          const candidates = currentFiles
            .map(f => {
              const filePath = path.join(sessionDir, f)
              const stat = fs.statSync(filePath)
              return { file: f, mtime: stat.mtimeMs }
            })
            .filter(f => f.mtime >= startTime - 5000) // Modified around terminal start
            .filter(f => !claimedSessions.has(f.file.replace(/\.jsonl$/, '')))
            .sort((a, b) => b.mtime - a.mtime)

          if (candidates.length > 0) {
            const sessionId = candidates[0].file.replace(/\.jsonl$/, '')
            console.log(`[TerminalManager] Detected session ID for ${terminalId}: ${sessionId} (recently modified unclaimed)`)
            this.claudeSessionIds.set(terminalId, sessionId)
            this.emitClaudeSessionId(terminalId, sessionId)
            clearInterval(timer)
            return
          }
        }
      } catch {
        // Ignore filesystem errors
      }
    }, 1000)
  }

  private emitClaudeStatus(id: string, status: ClaudeStatus): void {
    const meta = this.claudeMeta.get(id)
    if (!meta || meta.status === status) return
    const prevStatus = meta.status
    meta.status = status
    if (status === 'running') {
      meta.hasBeenRunning = true
    }
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('terminal:claude-status', id, status)
      }
    } catch {
      // Window destroyed during shutdown
    }
    // Desktop notification when attention is needed and window is not focused
    if (status === 'attention' && this.mainWindow && !this.mainWindow.isDestroyed() && !this.mainWindow.isFocused()) {
      const now = Date.now()
      const lastTime = this.lastNotificationTime.get(id) || 0
      if (now - lastTime > 30000) {
        this.lastNotificationTime.set(id, now)
        const termName = this.terminalNames.get(id) || 'Claude Code'
        const notification = new Notification({
          title: 'Claude needs your attention',
          body: termName
        })
        notification.on('click', () => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            if (this.mainWindow.isMinimized()) this.mainWindow.restore()
            this.mainWindow.focus()
          }
        })
        notification.show()
      }
    }
    // Track idle cycles (running → idle/attention transitions)
    if (meta.hasBeenRunning && prevStatus === 'running' && (status === 'idle' || status === 'attention')) {
      meta.idleCycleCount++
    }
    // Auto-rename after second idle cycle (skip the startup banner cycle)
    if (!meta.autoRenamed && meta.idleCycleCount >= 2) {
      meta.autoRenamed = true
      this.tryAutoRename(id)
    }
  }

  private tryAutoRename(id: string): void {
    const lines = this.readOutput(id, 100)
    const taskName = this.extractTaskName(lines)
    if (!taskName) return
    this.terminalNames.set(id, taskName)
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        this.mainWindow.webContents.send('terminal:claude-rename', id, taskName)
      }
    } catch {
      // Window destroyed
    }
  }

  private extractTaskName(lines: string[]): string | null {
    // Scan backwards for the user's prompt line (❯ prefix from Claude Code CLI).
    // Only match ❯ — regular > is too broad (matches markdown blockquotes in output).
    const promptPattern = /^❯\s+(.+)/
    for (let i = lines.length - 1; i >= 0; i--) {
      const trimmed = lines[i].trim()
      const match = trimmed.match(promptPattern)
      if (match && match[1] && match[1].trim().length >= 3) {
        let name = match[1].trim()
        // Remove leading/trailing decoration
        name = name.replace(/^[-─━=~*\s]+|[-─━=~*\s]+$/g, '')
        if (!name) continue
        if (name.length > 40) {
          name = name.slice(0, 37) + '...'
        }
        return name
      }
    }

    return null
  }

  private startSilenceTimer(id: string): void {
    const meta = this.claudeMeta.get(id)
    if (!meta) return
    if (meta.silenceTimer) clearTimeout(meta.silenceTimer)
    meta.silenceTimer = setTimeout(() => {
      // Read last 5 lines and check for attention patterns
      const lines = this.readOutput(id, 5)
      const text = lines.join('\n')
      if (ATTENTION_PATTERNS.test(text)) {
        this.emitClaudeStatus(id, 'attention')
      } else {
        this.emitClaudeStatus(id, 'idle')
      }
    }, 3000)
  }

  private _registerPty(id: string, projectPath: string, ptyProcess: pty.IPty): TerminalInfo {
    const managed: ManagedTerminal = {
      id,
      projectPath,
      pty: ptyProcess,
      outputBuffer: [],
      partialLine: ''
    }

    this.createdAt.set(id, Date.now())

    // Get or create project terminal map
    let projectTerminals = this.terminals.get(projectPath)
    if (!projectTerminals) {
      projectTerminals = new Map()
      this.terminals.set(projectPath, projectTerminals)
    }
    projectTerminals.set(id, managed)

    // Forward PTY output to renderer and accumulate in ring buffer
    ptyProcess.onData((data: string) => {
      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('terminal:data', id, data)
        }
      } catch {
        // Window destroyed during shutdown — ignore
      }

      // Detect OSC title sequences (e.g. from Claude /rename)
      // Matches \x1b]0;title\x07 or \x1b]2;title\x07 or BEL-terminated
      const titleMatch = data.match(/\x1b\](?:0|2);([^\x07\x1b]*?)(?:\x07|\x1b\\)/)
      if (titleMatch && titleMatch[1] && this.claudeMeta.has(id)) {
        const title = titleMatch[1].trim()
        if (title) {
          this.terminalNames.set(id, title)
          try {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('terminal:claude-rename', id, title)
            }
          } catch {
            // Window destroyed
          }
        }
      }

      // Detect Claude session ID from output (e.g. "session_id: <uuid>" or "Session: <uuid>")
      if (this.claudeMeta.has(id) && !this.claudeSessionIds.has(id)) {
        const sessionMatch = data.match(/session[_ ]?id:?\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
          || data.match(/Session:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
        if (sessionMatch && sessionMatch[1]) {
          this.claudeSessionIds.set(id, sessionMatch[1])
          this.emitClaudeSessionId(id, sessionMatch[1])
        }
      }

      // Fallback rename detection: match "Session renamed to: <name>" text from Claude /rename
      if (this.claudeMeta.has(id)) {
        const renameMatch = data.match(/Session renamed to:?\s*(.+?)(?:\r|\n|$)/)
          || data.match(/Renamed (?:session|to):?\s*(.+?)(?:\r|\n|$)/)
        if (renameMatch && renameMatch[1]) {
          const renamedTitle = renameMatch[1].trim()
          if (renamedTitle) {
            this.terminalNames.set(id, renamedTitle)
            try {
              if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('terminal:claude-rename', id, renamedTitle)
              }
            } catch {
              // Window destroyed
            }
          }
        }
      }

      // Accumulate output in ring buffer
      managed.partialLine += data
      const lines = managed.partialLine.split('\n')
      // Last element is the incomplete line (or '' if data ended with \n)
      managed.partialLine = lines.pop()!
      for (const line of lines) {
        managed.outputBuffer.push(this.stripAnsi(line))
        if (managed.outputBuffer.length > 1000) {
          managed.outputBuffer.shift()
        }
      }

      // Agent sub-task detection (best-effort output parsing)
      if (this.claudeMeta.has(id)) {
        const stripped = this.stripAnsi(data)
        // Detect agent spawn patterns
        const spawnMatch = stripped.match(/(?:Task\(|Launching agent|⏳\s*)(.*?)(?:\)|$)/m)
          || stripped.match(/╭─+\s*(.*?agent.*?)(?:\s*─|$)/im)
        if (spawnMatch && spawnMatch[1] && spawnMatch[1].trim().length >= 3) {
          const agentName = spawnMatch[1].trim().slice(0, 60)
          const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
          try {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('terminal:agent-spawned', id, {
                id: agentId,
                name: agentName,
                status: 'running',
                startedAt: Date.now()
              })
            }
          } catch {
            // Window destroyed
          }
        }
        // Detect agent completion patterns
        const completeMatch = stripped.match(/(?:Task completed|✓\s*Agent|agent.*?completed|Result:)/im)
        if (completeMatch) {
          try {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              this.mainWindow.webContents.send('terminal:agent-completed', id)
            }
          } catch {
            // Window destroyed
          }
        }
      }

      // Context usage detection — parse percentage from Claude CLI output
      // Claude Code shows context usage like "XX% context" or "context: XX%" or "XX% remaining"
      if (this.claudeMeta.has(id)) {
        const strippedData = this.stripAnsi(data)
        const ctxMatch = strippedData.match(/(\d{1,3})%\s*(?:context|remaining)/i)
          || strippedData.match(/context[:\s]+(\d{1,3})%/i)
        if (ctxMatch) {
          const pct = parseInt(ctxMatch[1], 10)
          if (pct >= 0 && pct <= 100) {
            // Claude shows "remaining" so we track usage as 100 - remaining
            const isRemaining = /remaining/i.test(ctxMatch[0])
            this.emitContextUsage(id, isRemaining ? 100 - pct : pct)
          }
        }
      }

      // Claude status detection
      if (this.claudeMeta.has(id)) {
        const meta = this.claudeMeta.get(id)!
        meta.lastDataTimestamp = Date.now()
        this.emitClaudeStatus(id, 'running')
        this.startSilenceTimer(id)
      }
    })

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode }) => {
      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.webContents.send('terminal:exit', id, exitCode)
        }
      } catch {
        // Window destroyed during shutdown — ignore
      }

      // Claude cleanup
      const meta = this.claudeMeta.get(id)
      if (meta) {
        if (meta.silenceTimer) clearTimeout(meta.silenceTimer)
        this.emitClaudeStatus(id, 'done')
        this.claudeMeta.delete(id)
        this.lastNotificationTime.delete(id)
      }

      const pt = this.terminals.get(projectPath)
      if (pt) {
        pt.delete(id)
        if (pt.size === 0) {
          this.terminals.delete(projectPath)
        }
      }
    })

    return { id, projectPath, pid: ptyProcess.pid }
  }

  write(id: string, data: string): void {
    this.findTerminal(id)?.pty.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    try {
      this.findTerminal(id)?.pty.resize(cols, rows)
    } catch {
      // Ignore resize errors for dead PTYs
    }
  }

  close(id: string): void {
    const managed = this.findTerminal(id)
    if (!managed) return

    // Clean up claude meta
    const meta = this.claudeMeta.get(id)
    if (meta) {
      if (meta.silenceTimer) clearTimeout(meta.silenceTimer)
      this.claudeMeta.delete(id)
    }

    managed.pty.kill()
    this.terminalNames.delete(id)
    this.createdAt.delete(id)
    this.lastNotificationTime.delete(id)
    const pt = this.terminals.get(managed.projectPath)
    if (pt) {
      pt.delete(id)
      if (pt.size === 0) {
        this.terminals.delete(managed.projectPath)
      }
    }
  }

  list(projectPath: string): TerminalInfo[] {
    const pt = this.terminals.get(projectPath)
    if (!pt) return []
    return Array.from(pt.values()).map(t => ({
      id: t.id,
      projectPath: t.projectPath,
      pid: t.pty.pid
    }))
  }

  destroy(): void {
    this.mainWindow = null
    // Clear all claude timers
    for (const [, meta] of this.claudeMeta) {
      if (meta.silenceTimer) clearTimeout(meta.silenceTimer)
    }
    this.claudeMeta.clear()
    this.lastNotificationTime.clear()
    for (const [, projectTerminals] of this.terminals) {
      for (const [, managed] of projectTerminals) {
        try {
          managed.pty.kill()
        } catch {
          // Ignore kill errors during cleanup
        }
      }
    }
    this.terminals.clear()
  }

  readOutput(id: string, lines = 50): string[] {
    const managed = this.findTerminal(id)
    if (!managed) return []
    const buf = managed.outputBuffer
    return buf.slice(Math.max(0, buf.length - lines))
  }

  private stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[>=<]|\x1b\[[\?]?[0-9;]*[hlm]/g, '')
  }

  private findTerminal(id: string): ManagedTerminal | null {
    for (const [, projectTerminals] of this.terminals) {
      const t = projectTerminals.get(id)
      if (t) return t
    }
    return null
  }
}
