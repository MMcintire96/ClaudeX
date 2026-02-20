import { BrowserWindow, Notification } from 'electron'
import * as pty from 'node-pty'
import { v4 as uuidv4 } from 'uuid'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'
import { TmuxSession } from './TmuxSession'
import { broadcastSend } from '../broadcast'

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
  tmuxWindow: string | null
}

type ClaudeStatus = 'running' | 'idle' | 'attention' | 'done'

interface ClaudeMeta {
  lastDataTimestamp: number
  status: ClaudeStatus
  silenceTimer: ReturnType<typeof setTimeout> | null
  windowCheckTimer: ReturnType<typeof setInterval> | null
  hasBeenRunning: boolean
  autoRenamed: boolean
  idleCycleCount: number
}

const ATTENTION_PATTERNS = /\b(allow|approve|permission|accept|trust|confirm|proceed)\b|\(y\/n\)|\(yes\/no\)|do you want|would you like|Enter to confirm|Esc to cancel|Tab to amend/i

/** Patterns that indicate a Claude CLI permission prompt specifically */
const PERMISSION_PROMPT_PATTERNS = /do you want to proceed|do you want to allow|Enter to confirm|Esc to cancel|Tab to amend|trust this folder|safety check|\(y\/n\)|\(yes\/no\)|wants to (?:run|execute|read|write|delete|create|modify|access)/i

/** Detect whether this is an Esc-to-cancel / numbered-option style prompt (vs y/n) */
const ESC_CANCEL_PATTERN = /Esc to cancel|Tab to amend/i

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
  private pinnedSessionIds: Set<string> = new Set() // resumed sessions — don't clear on screen-clear
  private createdAt: Map<string, number> = new Map()
  private lastNotificationTime: Map<string, number> = new Map()
  private contextUsage: Map<string, number> = new Map()
  private settingsManager: { get(): { notificationSounds?: boolean } } | null = null
  private tmuxSession: TmuxSession | null = null
  private tmuxAvailable = false
  private claudeStatusCallbacks: Array<(id: string, status: string) => void> = []

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  setSettingsManager(sm: { get(): { notificationSounds?: boolean } }): void {
    this.settingsManager = sm
  }

  /** Register a callback for Claude terminal status changes (used for sleep prevention) */
  onClaudeStatusChange(callback: (id: string, status: string) => void): void {
    this.claudeStatusCallbacks.push(callback)
  }

  /** Initialize tmux session if tmux is available. Call at startup. */
  async init(): Promise<void> {
    this.tmuxAvailable = TmuxSession.isAvailable()
    if (!this.tmuxAvailable) {
      console.log('[TerminalManager] tmux not found, using direct pty mode')
      return
    }
    const sessionName = `claudex-${process.pid}`
    this.tmuxSession = new TmuxSession(sessionName)
    try {
      this.tmuxSession.init()
      console.log(`[TerminalManager] tmux session created: ${sessionName}`)
    } catch (err) {
      console.error('[TerminalManager] Failed to create tmux session, falling back to direct pty:', err)
      this.tmuxSession = null
      this.tmuxAvailable = false
    }
  }

  getTmuxSessionName(): string | null {
    return this.tmuxSession?.getSessionName() ?? null
  }

  getTmuxWindowName(id: string): string | null {
    const managed = this.findTerminal(id)
    if (!managed?.tmuxWindow || !this.tmuxSession) return null
    // Return the display name, not the internal window ID
    return this.tmuxSession.getWindowName(managed.tmuxWindow) ?? managed.tmuxWindow
  }

  isTmuxEnabled(): boolean {
    return this.tmuxSession !== null
  }

  /** Build a sanitized tmux window name from project path and label */
  private tmuxWindowName(projectPath: string, label: string): string {
    const project = projectPath.split('/').pop() || 'project'
    const raw = `${project}:${label}`
    return raw.replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 60)
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

    if (this.tmuxSession) {
      const windowName = this.tmuxWindowName(projectPath, `shell-${id.slice(0, 6)}`)
      const windowId = this.tmuxSession.createShellWindow(windowName, projectPath)
      const attachPty = this.tmuxSession.attachWindow(windowId)
      return this._registerPty(id, projectPath, attachPty, windowId)
    }

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

    if (this.tmuxSession) {
      const windowName = this.tmuxWindowName(projectPath, `Claude-${id.slice(0, 6)}`)
      const windowId = this.tmuxSession.createCommandWindow(windowName, projectPath, command, args, mergedEnv)
      // Keep window alive after command exits so the tmux client doesn't silently
      // switch to another window (which would cause writes to go to the wrong place).
      // We detect the dead pane state and clean up explicitly.
      this.tmuxSession.setWindowOption(windowId, 'remain-on-exit', 'on')
      this.tmuxSession.setWindowOption(windowId, 'automatic-rename', 'off')
      const attachPty = this.tmuxSession.attachWindow(windowId)
      if (onExit) {
        attachPty.onExit(() => onExit())
      }
      return this._registerPty(id, projectPath, attachPty, windowId)
    }

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
    // Don't rename the tmux window — it causes name drift issues and breaks targeting.
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
        broadcastSend(this.mainWindow,'terminal:claude-session-id', terminalId, sessionId)
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
        broadcastSend(this.mainWindow,'terminal:context-usage', id, percent)
      }
    } catch {
      // Window destroyed
    }
  }

  registerClaudeTerminal(id: string, knownSessionId?: string): void {
    const managed = this.findTerminal(id)

    // Periodic dead-pane check for tmux Claude terminals.
    // With remain-on-exit on, when Claude exits the pane becomes "dead" but
    // the window persists (preventing the tmux client from switching to another
    // window). We poll for this state and trigger cleanup.
    let windowCheckTimer: ReturnType<typeof setInterval> | null = null
    if (managed?.tmuxWindow && this.tmuxSession) {
      windowCheckTimer = setInterval(() => {
        // Use managed.tmuxWindow (current value, survives renames) not a captured const
        if (managed.tmuxWindow && this.tmuxSession?.paneIsDead(managed.tmuxWindow)) {
          console.log(`[TerminalManager] dead pane detected for Claude terminal ${id}, cleaning up`)
          this.killDeadTmuxTerminal(managed, id)
        }
      }, 5000)
    }

    this.claudeMeta.set(id, {
      lastDataTimestamp: Date.now(),
      status: 'idle',
      silenceTimer: null,
      windowCheckTimer,
      hasBeenRunning: false,
      autoRenamed: false,
      idleCycleCount: 0
    })

    if (knownSessionId) {
      // Session ID already known (e.g. resumed session) — emit immediately.
      // Pin it so screen-clear during startup doesn't wipe it.
      this.claudeSessionIds.set(id, knownSessionId)
      this.pinnedSessionIds.add(id)
      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          broadcastSend(this.mainWindow,'terminal:claude-session-id', id, knownSessionId)
        }
      } catch { /* window destroyed */ }
    } else {
      // Proactively detect session ID by watching for new .jsonl files
      this.detectSessionIdFromDir(id)
    }
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

    const projectHash = projectPath.replace(/[/_.~]/g, '-')
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
    // Notify sleep prevention callbacks
    for (const cb of this.claudeStatusCallbacks) {
      try { cb(id, status) } catch { /* ignore */ }
    }
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        broadcastSend(this.mainWindow,'terminal:claude-status', id, status)
      }
    } catch {
      // Window destroyed during shutdown
    }
    // Desktop notification when Claude finishes or needs attention
    const shouldNotify =
      (status === 'attention') ||
      (prevStatus === 'running' && status === 'idle' && meta.hasBeenRunning)
    const windowFocused = this.mainWindow && !this.mainWindow.isDestroyed() && this.mainWindow.isFocused()
    if (shouldNotify && !windowFocused) {
      const now = Date.now()
      const lastTime = this.lastNotificationTime.get(id) || 0
      if (now - lastTime > 10000) {
        this.lastNotificationTime.set(id, now)
        const termName = this.terminalNames.get(id) || 'Claude Code'
        const managed = this.findTerminal(id)
        const projectName = managed?.projectPath.split('/').pop() || ''
        const title = status === 'attention' ? 'Claude needs your attention' : 'Claude finished working'
        const body = projectName ? `${termName} — ${projectName}` : termName
        const notification = new Notification({
          title,
          body
        })
        notification.on('click', () => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            if (this.mainWindow.isMinimized()) this.mainWindow.restore()
            this.mainWindow.focus()
          }
        })
        notification.show()
        // Play notification sound if enabled
        if (this.settingsManager?.get().notificationSounds !== false) {
          try {
            const sound = spawn('paplay', ['/usr/share/sounds/freedesktop/stereo/complete.oga'], {
              stdio: 'ignore',
              detached: true
            })
            sound.unref()
          } catch { /* no sound available */ }
        }
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
    this.setTerminalName(id, taskName)
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        broadcastSend(this.mainWindow,'terminal:claude-rename', id, taskName)
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
      // Read last 10 lines and check for attention patterns
      const lines = this.readOutput(id, 10)
      const text = lines.join('\n')
      if (ATTENTION_PATTERNS.test(text)) {
        this.emitClaudeStatus(id, 'attention')
        // If it looks like a permission prompt, emit structured permission request
        if (PERMISSION_PROMPT_PATTERNS.test(text)) {
          this.emitPermissionRequest(id, lines)
        }
      } else {
        this.emitClaudeStatus(id, 'idle')
      }
    }, 3000)
  }

  private emitPermissionRequest(id: string, _lines: string[]): void {
    // Extract permission context from the output — grab more lines for context
    const contextLines = this.readOutput(id, 15)
    const permissionText = contextLines
      .filter(l => l.trim().length > 0)
      .join('\n')

    // Detect prompt type: Esc-to-cancel (numbered options) vs y/n
    const promptType = ESC_CANCEL_PATTERN.test(permissionText) ? 'enter' : 'yn'

    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        broadcastSend(this.mainWindow, 'terminal:permission-request', id, permissionText, promptType)
      }
    } catch {
      // Window destroyed
    }
  }

  private _registerPty(id: string, projectPath: string, ptyProcess: pty.IPty, tmuxWindow: string | null = null): TerminalInfo {
    const managed: ManagedTerminal = {
      id,
      projectPath,
      pty: ptyProcess,
      outputBuffer: [],
      partialLine: '',
      tmuxWindow
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
          broadcastSend(this.mainWindow,'terminal:data', id, data)
        }
      } catch {
        // Window destroyed during shutdown — ignore
      }

      this._processOutput(managed, data)
    })

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode }) => {
      // Tmux re-attach: if the attachment pty exits but the tmux window still exists
      // with a live pane, this is a transient detach (e.g. external client stole the
      // attachment). Re-attach automatically instead of treating it as a terminal exit.
      // Do NOT re-attach to a dead pane — that means the command exited.
      if (managed.tmuxWindow && this.tmuxSession) {
        if (this.tmuxSession.windowExists(managed.tmuxWindow) && !this.tmuxSession.paneIsDead(managed.tmuxWindow)) {
          try {
            const newPty = this.tmuxSession.attachWindow(managed.tmuxWindow)
            managed.pty = newPty
            // Re-register data and exit handlers on the new pty
            this._reattachHandlers(managed)
            return
          } catch {
            // Re-attach failed, fall through to normal exit handling
          }
        }
        // Kill the tmux window if it's still around (dead pane with remain-on-exit on)
        if (this.tmuxSession.windowExists(managed.tmuxWindow)) {
          this.tmuxSession.killWindow(managed.tmuxWindow)
        }
      }

      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          broadcastSend(this.mainWindow,'terminal:exit', id, exitCode)
        }
      } catch {
        // Window destroyed during shutdown — ignore
      }

      // Claude cleanup
      const meta = this.claudeMeta.get(id)
      if (meta) {
        if (meta.silenceTimer) clearTimeout(meta.silenceTimer)
        if (meta.windowCheckTimer) clearInterval(meta.windowCheckTimer)
        this.emitClaudeStatus(id, 'done')
        this.claudeMeta.delete(id)
        this.pinnedSessionIds.delete(id)
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
    const managed = this.findTerminal(id)
    if (!managed) return

    // For tmux Claude terminals, use send-keys targeted at the specific window
    // instead of writing to the PTY. The PTY (tmux attach-session) writes to
    // whatever window the client is currently viewing, which can be wrong if the
    // user switched windows externally or if Claude exited and the client moved.
    // send-keys -t session:window always targets the correct window.
    if (managed.tmuxWindow && this.tmuxSession && this.claudeMeta.has(id)) {
      if (this.tmuxSession.paneIsDead(managed.tmuxWindow)) {
        console.log(`[TerminalManager] write blocked: pane dead for Claude terminal ${id}`)
        this.killDeadTmuxTerminal(managed, id)
        return
      }
      this.tmuxSession.sendKeys(managed.tmuxWindow, data)
      return
    }

    managed.pty.write(data)
  }

  /** Kill a tmux terminal whose pane is dead — destroy the window then kill the PTY */
  private killDeadTmuxTerminal(managed: ManagedTerminal, id: string): void {
    // Kill the tmux window first (it persists because of remain-on-exit on)
    if (managed.tmuxWindow && this.tmuxSession) {
      this.tmuxSession.killWindow(managed.tmuxWindow)
    }
    // Kill the PTY to trigger onExit → cleanup chain
    try {
      managed.pty.kill()
    } catch {
      // PTY may already be dead
    }
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
      if (meta.windowCheckTimer) clearInterval(meta.windowCheckTimer)
      this.claudeMeta.delete(id)
      this.pinnedSessionIds.delete(id)
    }

    // Kill tmux window first (this will cause the attachment pty to exit too)
    if (managed.tmuxWindow && this.tmuxSession) {
      this.tmuxSession.killWindow(managed.tmuxWindow)
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

  listAll(): TerminalInfo[] {
    const result: TerminalInfo[] = []
    for (const pt of this.terminals.values()) {
      for (const t of pt.values()) {
        result.push({ id: t.id, projectPath: t.projectPath, pid: t.pty.pid })
      }
    }
    return result
  }

  destroy(): void {
    this.mainWindow = null
    // Clear all claude timers
    for (const [, meta] of this.claudeMeta) {
      if (meta.silenceTimer) clearTimeout(meta.silenceTimer)
      if (meta.windowCheckTimer) clearInterval(meta.windowCheckTimer)
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
    // Kill the entire tmux session (atomic cleanup of all windows)
    if (this.tmuxSession) {
      this.tmuxSession.killSession()
      this.tmuxSession = null
    }
  }

  /** Process output data — shared between _registerPty and _reattachHandlers */
  private _processOutput(managed: ManagedTerminal, data: string): void {
    const id = managed.id

    // Detect OSC title sequences (e.g. from Claude /rename)
    const titleMatch = data.match(/\x1b\](?:0|2);([^\x07\x1b]*?)(?:\x07|\x1b\\)/)
    if (titleMatch && titleMatch[1] && this.claudeMeta.has(id)) {
      const title = titleMatch[1].trim()
      if (title) {
        this.setTerminalName(id, title)
        try {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            broadcastSend(this.mainWindow,'terminal:claude-rename', id, title)
          }
        } catch {
          // Window destroyed
        }
      }
    }

    // Detect /clear: Claude CLI sends screen-clear escape sequences when starting a new session.
    // When detected, drop the old session ID so we can pick up the new one,
    // clear the output buffer, and notify the renderer to clear the chat.
    // Skip for pinned (resumed) sessions — their startup screen-clear is not a /clear command.
    if (this.claudeMeta.has(id) && this.claudeSessionIds.has(id) && !this.pinnedSessionIds.has(id)) {
      // \x1b[2J = clear entire screen, \x1b[H = cursor home — Claude CLI sends both on /clear
      if (data.includes('\x1b[2J') || data.includes('\x1b[3J')) {
        console.log(`[TerminalManager] Screen clear detected for ${id}, resetting session ID`)
        this.claudeSessionIds.delete(id)
        managed.outputBuffer.length = 0
        managed.partialLine = ''
        this.contextUsage.delete(id)
        // Re-run directory-based session ID detection for the new file
        this.detectSessionIdFromDir(id)
      }
    }

    // Detect Claude session ID from output
    if (this.claudeMeta.has(id) && !this.claudeSessionIds.has(id)) {
      const sessionMatch = data.match(/session[_ ]?id:?\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
        || data.match(/Session:\s*([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)
      if (sessionMatch && sessionMatch[1]) {
        this.claudeSessionIds.set(id, sessionMatch[1])
        this.emitClaudeSessionId(id, sessionMatch[1])
      }
    }

    // Fallback rename detection
    if (this.claudeMeta.has(id)) {
      const renameMatch = data.match(/Session renamed to:?\s*(.+?)(?:\r|\n|$)/)
        || data.match(/Renamed (?:session|to):?\s*(.+?)(?:\r|\n|$)/)
      if (renameMatch && renameMatch[1]) {
        const renamedTitle = renameMatch[1].trim()
        if (renamedTitle) {
          this.setTerminalName(id, renamedTitle)
          try {
            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
              broadcastSend(this.mainWindow,'terminal:claude-rename', id, renamedTitle)
            }
          } catch {
            // Window destroyed
          }
        }
      }
    }

    // Detect /compact output — Claude CLI prints a compaction message
    if (this.claudeMeta.has(id)) {
      const stripped = this.stripAnsi(data)
      if (/compact(ed|ing)/i.test(stripped) && /conversation/i.test(stripped)) {
        try {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            broadcastSend(this.mainWindow,'terminal:system-message', id, 'Conversation compacted')
          }
        } catch {
          // Window destroyed
        }
      }
    }

    // Accumulate output in ring buffer
    managed.partialLine += data
    const lines = managed.partialLine.split('\n')
    managed.partialLine = lines.pop()!
    for (const line of lines) {
      managed.outputBuffer.push(this.stripAnsi(line))
      if (managed.outputBuffer.length > 1000) {
        managed.outputBuffer.shift()
      }
    }

    // Agent sub-task detection
    if (this.claudeMeta.has(id)) {
      const stripped = this.stripAnsi(data)
      const spawnMatch = stripped.match(/(?:Task\(|Launching agent|⏳\s*)(.*?)(?:\)|$)/m)
        || stripped.match(/╭─+\s*(.*?agent.*?)(?:\s*─|$)/im)
      if (spawnMatch && spawnMatch[1] && spawnMatch[1].trim().length >= 3) {
        const agentName = spawnMatch[1].trim().slice(0, 60)
        const agentId = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
        try {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            broadcastSend(this.mainWindow,'terminal:agent-spawned', id, {
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
      const completeMatch = stripped.match(/(?:Task completed|✓\s*Agent|agent.*?completed|Result:)/im)
      if (completeMatch) {
        try {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            broadcastSend(this.mainWindow,'terminal:agent-completed', id)
          }
        } catch {
          // Window destroyed
        }
      }
    }

    // Context usage detection
    if (this.claudeMeta.has(id)) {
      const strippedData = this.stripAnsi(data)
      const ctxMatch = strippedData.match(/(\d{1,3})%\s*(?:context|remaining)/i)
        || strippedData.match(/context[:\s]+(\d{1,3})%/i)
      if (ctxMatch) {
        const pct = parseInt(ctxMatch[1], 10)
        if (pct >= 0 && pct <= 100) {
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
  }

  /** Re-register onData and onExit handlers after tmux re-attach */
  private _reattachHandlers(managed: ManagedTerminal): void {
    const id = managed.id
    const projectPath = managed.projectPath

    managed.pty.onData((data: string) => {
      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          broadcastSend(this.mainWindow,'terminal:data', id, data)
        }
      } catch {
        // Window destroyed
      }

      // All the same parsing logic from _registerPty — delegate to shared method
      this._processOutput(managed, data)
    })

    managed.pty.onExit(({ exitCode }) => {
      if (managed.tmuxWindow && this.tmuxSession) {
        if (this.tmuxSession.windowExists(managed.tmuxWindow) && !this.tmuxSession.paneIsDead(managed.tmuxWindow)) {
          try {
            const newPty = this.tmuxSession.attachWindow(managed.tmuxWindow)
            managed.pty = newPty
            this._reattachHandlers(managed)
            return
          } catch {
            // Fall through
          }
        }
        // Kill the tmux window if it's still around (dead pane with remain-on-exit on)
        if (this.tmuxSession.windowExists(managed.tmuxWindow)) {
          this.tmuxSession.killWindow(managed.tmuxWindow)
        }
      }

      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          broadcastSend(this.mainWindow,'terminal:exit', id, exitCode)
        }
      } catch {
        // Window destroyed
      }

      const meta = this.claudeMeta.get(id)
      if (meta) {
        if (meta.silenceTimer) clearTimeout(meta.silenceTimer)
        if (meta.windowCheckTimer) clearInterval(meta.windowCheckTimer)
        this.emitClaudeStatus(id, 'done')
        this.claudeMeta.delete(id)
        this.pinnedSessionIds.delete(id)
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
