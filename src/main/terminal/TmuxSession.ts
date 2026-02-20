import { execFileSync } from 'child_process'
import * as pty from 'node-pty'

/**
 * Encapsulates all tmux CLI interactions.
 * Stateless wrapper around execFileSync for one-shot commands,
 * node-pty for persistent attachment.
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
      'new-session', '-d', '-s', this.sessionName, '-n', 'codex-init', '-x', '80', '-y', '24', ';',
      'set-option', '-t', this.sessionName, 'aggressive-resize', 'on', ';',
      'set-option', '-t', this.sessionName, 'remain-on-exit', 'off', ';',
      'set-option', '-t', this.sessionName, 'default-terminal', 'xterm-256color', ';',
      'set-option', '-t', this.sessionName, 'history-limit', '10000', ';',
      'set-option', '-t', this.sessionName, 'mouse', 'on'
    ], { stdio: 'pipe' })
  }

  /** Create a new tmux window running the user's shell */
  createShellWindow(name: string, cwd: string, env?: Record<string, string>): void {
    const args = ['new-window', '-t', this.sessionName, '-n', name, '-c', cwd]
    execFileSync('tmux', args, {
      stdio: 'pipe',
      env: { ...process.env, ...env }
    })
  }

  /** Create a new tmux window running a specific command */
  createCommandWindow(
    name: string,
    cwd: string,
    command: string,
    cmdArgs: string[],
    env?: Record<string, string>
  ): void {
    // Build the shell command. We use env vars via the environment, not inline.
    const fullCmd = [command, ...cmdArgs].map(a => this.shellEscape(a)).join(' ')
    const args = ['new-window', '-t', this.sessionName, '-n', name, '-c', cwd, fullCmd]
    execFileSync('tmux', args, {
      stdio: 'pipe',
      env: { ...process.env, ...env }
    })
  }

  /** Attach to a specific tmux window via node-pty (bidirectional stream) */
  attachWindow(name: string, cols = 80, rows = 24): pty.IPty {
    return pty.spawn('tmux', ['attach-session', '-t', `${this.sessionName}:${name}`], {
      name: 'xterm-256color',
      cols,
      rows,
      env: process.env as Record<string, string>
    })
  }

  /** Send literal keys to a tmux window */
  sendKeys(name: string, keys: string): void {
    execFileSync('tmux', ['send-keys', '-t', `${this.sessionName}:${name}`, '-l', '--', keys], {
      stdio: 'pipe'
    })
  }

  /** Rename a tmux window */
  renameWindow(oldName: string, newName: string): void {
    try {
      execFileSync('tmux', ['rename-window', '-t', `${this.sessionName}:${oldName}`, newName], {
        stdio: 'pipe'
      })
    } catch {
      // Window may have been killed already
    }
  }

  /** Kill a specific tmux window */
  killWindow(name: string): void {
    try {
      execFileSync('tmux', ['kill-window', '-t', `${this.sessionName}:${name}`], {
        stdio: 'pipe'
      })
    } catch {
      // Window may already be gone
    }
  }

  /** Check if a tmux window exists */
  windowExists(name: string): boolean {
    try {
      const output = execFileSync('tmux', [
        'list-windows', '-t', this.sessionName, '-F', '#{window_name}'
      ], { stdio: 'pipe', encoding: 'utf-8' })
      return output.split('\n').some(line => line.trim() === name)
    } catch {
      return false
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
