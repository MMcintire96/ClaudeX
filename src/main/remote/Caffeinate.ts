import { ChildProcess, spawn } from 'child_process'

/**
 * Prevent the laptop from sleeping while a phone client is connected.
 *
 * On Linux, uses `systemd-inhibit --what=sleep:idle` wrapped around a long
 * sleep — exactly the pattern systemd's docs recommend. The inhibit lock
 * is released when the child process exits.
 *
 * Refcounted: incrementing for each connected client; the inhibit lock
 * stays alive while count > 0.
 */
export class Caffeinate {
  private count = 0
  private proc: ChildProcess | null = null
  private enabled = true

  setEnabled(on: boolean): void {
    this.enabled = on
    if (!on) this.releaseProc()
  }

  acquire(): void {
    this.count++
    if (this.count === 1 && this.enabled) this.spawnInhibit()
  }

  release(): void {
    if (this.count > 0) this.count--
    if (this.count === 0) this.releaseProc()
  }

  destroy(): void {
    this.count = 0
    this.releaseProc()
  }

  private spawnInhibit(): void {
    if (this.proc) return
    if (process.platform !== 'linux') {
      // macOS would use `caffeinate -dimsu`; Windows would use SetThreadExecutionState.
      // Out of scope for v1 (Linux-first per CLAUDE.md).
      return
    }
    try {
      this.proc = spawn('systemd-inhibit', [
        '--what=sleep:idle',
        '--who=ClaudeX',
        '--why=Phone client connected',
        'sleep', 'infinity'
      ], { stdio: 'ignore', detached: false })
      this.proc.on('exit', () => { this.proc = null })
      this.proc.on('error', err => {
        console.warn('[Caffeinate] failed to start systemd-inhibit:', err)
        this.proc = null
      })
    } catch (err) {
      console.warn('[Caffeinate] spawn error:', err)
    }
  }

  private releaseProc(): void {
    if (this.proc && !this.proc.killed) {
      try { this.proc.kill('SIGTERM') } catch { /* ignore */ }
    }
    this.proc = null
  }
}
