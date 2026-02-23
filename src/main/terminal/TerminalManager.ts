import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import { v4 as uuidv4 } from 'uuid'
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
}

/**
 * Manages per-project PTY terminal instances (shell only).
 * Each project can have multiple terminals.
 */
export class TerminalManager {
  private terminals: Map<string, Map<string, ManagedTerminal>> = new Map()
  private mainWindow: BrowserWindow | null = null
  private terminalNames: Map<string, string> = new Map()
  private createdAt: Map<string, number> = new Map()

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  async init(): Promise<void> {
    // No-op — kept for API compatibility
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

  setTerminalName(id: string, name: string): void {
    this.terminalNames.set(id, name)
  }

  getTerminalName(id: string): string | null {
    return this.terminalNames.get(id) || null
  }

  getCreatedAt(terminalId: string): number {
    return this.createdAt.get(terminalId) || Date.now()
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

    let projectTerminals = this.terminals.get(projectPath)
    if (!projectTerminals) {
      projectTerminals = new Map()
      this.terminals.set(projectPath, projectTerminals)
    }
    projectTerminals.set(id, managed)

    ptyProcess.onData((data: string) => {
      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          broadcastSend(this.mainWindow, 'terminal:data', id, data)
        }
      } catch {
        // Window destroyed during shutdown
      }
      this._processOutput(managed, data)
    })

    ptyProcess.onExit(({ exitCode }) => {
      try {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          broadcastSend(this.mainWindow, 'terminal:exit', id, exitCode)
        }
      } catch {
        // Window destroyed during shutdown
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

  private _processOutput(managed: ManagedTerminal, data: string): void {
    managed.partialLine += data
    const lines = managed.partialLine.split('\n')
    managed.partialLine = lines.pop()!
    for (const line of lines) {
      managed.outputBuffer.push(this.stripAnsi(line))
      if (managed.outputBuffer.length > 1000) {
        managed.outputBuffer.shift()
      }
    }
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
