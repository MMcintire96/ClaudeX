import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { broadcastSend } from '../broadcast'

export interface NeovimInfo {
  projectPath: string
  pid: number
}

interface ManagedNeovim {
  projectPath: string
  pty: pty.IPty
}

/**
 * Manages per-project Neovim PTY instances.
 * Each project gets at most one nvim process.
 */
export class NeovimManager {
  private instances: Map<string, ManagedNeovim> = new Map()
  private mainWindow: BrowserWindow | null = null

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  private findNvim(): string {
    // Prefer nvim on PATH; could be extended to check common install locations
    return 'nvim'
  }

  create(projectPath: string, filePath?: string): NeovimInfo {
    // If already running for this project, return existing
    const existing = this.instances.get(projectPath)
    if (existing) {
      return { projectPath, pid: existing.pty.pid }
    }

    const args: string[] = []
    if (filePath) {
      args.push(filePath)
    }

    const ptyProcess = pty.spawn(this.findNvim(), args, {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: projectPath,
      env: {
        ...process.env as Record<string, string>,
        // Ensure nvim knows it's inside a real terminal
        TERM: 'xterm-256color'
      }
    })

    const managed: ManagedNeovim = {
      projectPath,
      pty: ptyProcess
    }

    this.instances.set(projectPath, managed)

    ptyProcess.onData((data: string) => {
      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          broadcastSend(this.mainWindow, 'neovim:data', projectPath, data)
        }
      } catch {
        // Window destroyed during shutdown
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          broadcastSend(this.mainWindow, 'neovim:exit', projectPath, exitCode)
        }
      } catch {
        // Window destroyed during shutdown
      }
      this.instances.delete(projectPath)
    })

    return { projectPath, pid: ptyProcess.pid }
  }

  write(projectPath: string, data: string): void {
    this.instances.get(projectPath)?.pty.write(data)
  }

  resize(projectPath: string, cols: number, rows: number): void {
    try {
      this.instances.get(projectPath)?.pty.resize(cols, rows)
    } catch {
      // Ignore resize errors for dead PTYs
    }
  }

  openFile(projectPath: string, filePath: string): void {
    const instance = this.instances.get(projectPath)
    if (!instance) return
    // Send Escape first to ensure we're in normal mode, then :e <file>
    instance.pty.write(`\x1b:e ${filePath}\r`)
  }

  isRunning(projectPath: string): boolean {
    return this.instances.has(projectPath)
  }

  close(projectPath: string): void {
    const managed = this.instances.get(projectPath)
    if (!managed) return
    // Send :qa! to quit nvim gracefully, then kill if needed
    managed.pty.write('\x1b:qa!\r')
    setTimeout(() => {
      // If still alive after 500ms, force kill
      if (this.instances.has(projectPath)) {
        try {
          managed.pty.kill()
        } catch {
          // Already dead
        }
        this.instances.delete(projectPath)
      }
    }, 500)
  }

  destroy(): void {
    this.mainWindow = null
    for (const [, managed] of this.instances) {
      try {
        managed.pty.write('\x1b:qa!\r')
        setTimeout(() => {
          try {
            managed.pty.kill()
          } catch {
            // Ignore
          }
        }, 200)
      } catch {
        // Ignore kill errors during cleanup
      }
    }
    this.instances.clear()
  }
}
