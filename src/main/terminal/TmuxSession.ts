import { execFileSync, execSync } from 'child_process'
import * as pty from 'node-pty'

/**
 * Encapsulates all tmux CLI interactions.
 * Stateless wrapper around execFileSync for one-shot commands,
 * node-pty for persistent attachment.
 *
 * All window targeting uses tmux window IDs (@N) which are immutable,
 * rather than window names which can change via rename or automatic-rename.
 */
export class TmuxSession {
  readonly sessionName: string

  constructor(sessionName: string) {
    this.sessionName = sessionName
  }

  /** Check if tmux is installed and accessible */
  static isAvailable(): boolean {
    try {
      execFileSync('which', ['tmux'], { stdio: 'pipe' })
      return true
    } catch {
      return false
    }
  }

  /** Create a new detached tmux session with sensible defaults (single exec call) */
  init(): void {
    // Use -n to name the initial window (avoids base-index issues with rename-by-index)
    execFileSync('tmux', [
      'new-session', '-d', '-s', this.sessionName, '-n', 'claudex-init', '-x', '80', '-y', '24', ';',
      'set-option', '-t', this.sessionName, 'aggressive-resize', 'on', ';',
      'set-option', '-t', this.sessionName, 'remain-on-exit', 'off', ';',
      'set-option', '-t', this.sessionName, 'default-terminal', 'xterm-256color', ';',
      'set-option', '-t', this.sessionName, 'history-limit', '10000', ';',
      'set-option', '-t', this.sessionName, 'mouse', 'on'
    ], { stdio: 'pipe' })
  }

  /** Create a new tmux window running the user's shell. Returns the window ID (@N). */
  createShellWindow(name: string, cwd: string, env?: Record<string, string>): string {
    const args = ['new-window', '-t', this.sessionName, '-n', name, '-c', cwd, '-P', '-F', '#{window_id}']
    const output = execFileSync('tmux', args, {
      stdio: 'pipe',
      encoding: 'utf-8',
      env: { ...process.env, ...env }
    })
    return output.trim()
  }

  /** Create a new tmux window running a specific command. Returns the window ID (@N). */
  createCommandWindow(
    name: string,
    cwd: string,
    command: string,
    cmdArgs: string[],
    env?: Record<string, string>
  ): string {
    // Build the shell command. We use env vars via the environment, not inline.
    const fullCmd = [command, ...cmdArgs].map(a => this.shellEscape(a)).join(' ')
    const args = ['new-window', '-t', this.sessionName, '-n', name, '-c', cwd, '-P', '-F', '#{window_id}', fullCmd]
    const output = execFileSync('tmux', args, {
      stdio: 'pipe',
      encoding: 'utf-8',
      env: { ...process.env, ...env }
    })
    return output.trim()
  }

  /** Attach to a specific tmux window via node-pty (bidirectional stream).
   *  target can be a window ID (@N) or name. */
  attachWindow(target: string, cols = 80, rows = 24): pty.IPty {
    return pty.spawn('tmux', ['attach-session', '-t', `${this.sessionName}:${target}`], {
      name: 'xterm-256color',
      cols,
      rows,
      env: process.env as Record<string, string>
    })
  }

  /** Send literal keys to a tmux window. target can be a window ID (@N) or name. */
  sendKeys(target: string, keys: string): void {
    execFileSync('tmux', ['send-keys', '-t', `${this.sessionName}:${target}`, '-l', '--', keys], {
      stdio: 'pipe'
    })
  }

  /** Paste text into a tmux window using load-buffer + paste-buffer.
   *  This respects the terminal's bracket paste mode, so CLI programs like
   *  Claude Code treat multi-line input as a single paste rather than
   *  executing each newline as Enter. Also avoids ARG_MAX limits. */
  pasteText(target: string, text: string): void {
    const bufferName = 'claudex-paste'
    // load-buffer reads from stdin with '-'
    execSync(`tmux load-buffer -b ${bufferName} -`, {
      input: text,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    execFileSync('tmux', [
      'paste-buffer', '-b', bufferName, '-t', `${this.sessionName}:${target}`, '-p'
    ], { stdio: 'pipe' })
    // Clean up the buffer
    try {
      execFileSync('tmux', ['delete-buffer', '-b', bufferName], { stdio: 'pipe' })
    } catch {
      // Buffer may already be gone
    }
  }

  /** Rename a tmux window. target can be a window ID (@N) or name. */
  renameWindow(target: string, newName: string): void {
    try {
      execFileSync('tmux', ['rename-window', '-t', `${this.sessionName}:${target}`, newName], {
        stdio: 'pipe'
      })
    } catch {
      // Window may have been killed already
    }
  }

  /** Kill a specific tmux window. target can be a window ID (@N) or name. */
  killWindow(target: string): void {
    try {
      execFileSync('tmux', ['kill-window', '-t', `${this.sessionName}:${target}`], {
        stdio: 'pipe'
      })
    } catch {
      // Window may already be gone
    }
  }

  /** Check if a tmux window exists. target can be a window ID (@N) or name. */
  windowExists(target: string): boolean {
    try {
      // For window IDs (@N), check against #{window_id}; for names, check #{window_name}
      const isId = target.startsWith('@')
      const fmt = isId ? '#{window_id}' : '#{window_name}'
      const output = execFileSync('tmux', [
        'list-windows', '-t', this.sessionName, '-F', fmt
      ], { stdio: 'pipe', encoding: 'utf-8' })
      return output.split('\n').some(line => line.trim() === target)
    } catch {
      return false
    }
  }

  /** Set a per-window option. target can be a window ID (@N) or name. */
  setWindowOption(target: string, option: string, value: string): void {
    try {
      execFileSync('tmux', [
        'set-option', '-w', '-t', `${this.sessionName}:${target}`, option, value
      ], { stdio: 'pipe' })
    } catch {
      // Window may not exist
    }
  }

  /** Check if a window's pane process has exited (pane is dead). target can be a window ID (@N) or name. */
  paneIsDead(target: string): boolean {
    try {
      const output = execFileSync('tmux', [
        'list-panes', '-t', `${this.sessionName}:${target}`, '-F', '#{pane_dead}'
      ], { stdio: 'pipe', encoding: 'utf-8' })
      // If any pane is dead, return true (command windows have a single pane)
      return output.split('\n').some(line => line.trim() === '1')
    } catch {
      // Window doesn't exist — treat as dead
      return true
    }
  }

  /** Get the current display name of a window by its ID */
  getWindowName(target: string): string | null {
    try {
      const output = execFileSync('tmux', [
        'display-message', '-t', `${this.sessionName}:${target}`, '-p', '#{window_name}'
      ], { stdio: 'pipe', encoding: 'utf-8' })
      return output.trim() || null
    } catch {
      return null
    }
  }

  /** Kill the entire tmux session */
  killSession(): void {
    try {
      execFileSync('tmux', ['kill-session', '-t', this.sessionName], {
        stdio: 'pipe'
      })
    } catch {
      // Session may already be gone
    }
  }

  getSessionName(): string {
    return this.sessionName
  }

  /** Shell-escape a string for safe use in tmux new-window commands */
  private shellEscape(s: string): string {
    if (s === '') return "''"
    if (/^[a-zA-Z0-9._\-/=:@]+$/.test(s)) return s
    return "'" + s.replace(/'/g, "'\\''") + "'"
  }
}
