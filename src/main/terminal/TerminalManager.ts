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
}

/**
 * Manages per-project PTY terminal instances.
 * Each project can have multiple terminals.
 */
export class TerminalManager {
  private terminals: Map<string, Map<string, ManagedTerminal>> = new Map()
  private mainWindow: BrowserWindow | null = null

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

    const managed: ManagedTerminal = {
      id,
      projectPath,
      pty: ptyProcess
    }

    // Get or create project terminal map
    let projectTerminals = this.terminals.get(projectPath)
    if (!projectTerminals) {
      projectTerminals = new Map()
      this.terminals.set(projectPath, projectTerminals)
    }
    projectTerminals.set(id, managed)

    // Forward PTY output to renderer
    ptyProcess.onData((data: string) => {
      this.mainWindow?.webContents.send('terminal:data', id, data)
    })

    // Handle PTY exit
    ptyProcess.onExit(({ exitCode }) => {
      this.mainWindow?.webContents.send('terminal:exit', id, exitCode)
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

    managed.pty.kill()
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

  private findTerminal(id: string): ManagedTerminal | null {
    for (const [, projectTerminals] of this.terminals) {
      const t = projectTerminals.get(id)
      if (t) return t
    }
    return null
  }
}
