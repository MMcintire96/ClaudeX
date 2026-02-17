import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { v4 as uuidv4 } from 'uuid'
import * as os from 'os'

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

  registerClaudeTerminal(id: string): void {
    this.claudeMeta.set(id, {
      lastDataTimestamp: Date.now(),
      status: 'idle',
      silenceTimer: null,
      hasBeenRunning: false,
      autoRenamed: false,
      idleCycleCount: 0
    })
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
    // Strategy: scan backwards for a line that looks like a user prompt (starts with > or ❯),
    // then take the text after the prompt character as the task name.
    const promptPattern = /^[>❯]\s*(.+)/
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

    // Fallback: skip banner lines and take first substantive line
    const skipPatterns = /^[\s│╭╮╰╯─┌┐└┘├┤┬┴┼━┃┏┓┗┛┣┫┳┻╋\-=_.*~#]*$|^\s*$|^[\s*✻>]+\s*(Welcome|Type|Tips|Claude Code|\/help)/i
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.length < 3) continue
      if (skipPatterns.test(line)) continue
      if (/^[>❯$%#]\s*$/.test(trimmed)) continue
      if (/^[-─━=~*]{2,}/.test(trimmed) && /[-─━=~*]{2,}$/.test(trimmed)) continue
      if (/^(v\d|claude\s+code|model:|session:)/i.test(trimmed)) continue
      let name = trimmed.replace(/^[>❯$%#]\s*/, '').replace(/^[-─━=~*\s]+|[-─━=~*\s]+$/g, '')
      if (!name || name.length < 3) continue
      if (name.length > 40) {
        name = name.slice(0, 37) + '...'
      }
      return name
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
