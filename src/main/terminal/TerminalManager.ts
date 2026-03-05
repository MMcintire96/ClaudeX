import { BrowserWindow } from 'electron'
import * as pty from 'node-pty'
import * as net from 'net'
import { spawn, ChildProcess } from 'child_process'
import { unlinkSync, writeFileSync, chmodSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { v4 as uuidv4 } from 'uuid'
import { broadcastSend } from '../broadcast'

const CONNECT_SCRIPT = `#!/usr/bin/env node
const net = require('net')
const socketPath = process.argv[2]
if (!socketPath) { process.stderr.write('Usage: popout-connect.js <socket-path>\\n'); process.exit(1) }
const client = net.connect(socketPath)
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.resume()
function sendResize() {
  const cols = process.stdout.columns || 80, rows = process.stdout.rows || 24
  const buf = Buffer.alloc(6)
  buf[0] = 0x00; buf[1] = 0x52
  buf.writeUInt16BE(cols, 2); buf.writeUInt16BE(rows, 4)
  client.write(buf)
}
sendResize()
process.stdout.on('resize', sendResize)
process.stdin.pipe(client)
client.pipe(process.stdout)
function cleanup() {
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false) } catch {}
  client.destroy(); process.exit(0)
}
client.on('end', cleanup)
client.on('error', cleanup)
process.on('SIGINT', cleanup)
process.on('SIGTERM', cleanup)
process.on('SIGHUP', cleanup)
`

interface TerminalInfo {
  id: string
  projectPath: string
  pid: number
}

interface PopoutState {
  server: net.Server
  clients: Set<net.Socket>
  socketPath: string
  externalProcess: ChildProcess | null
  dataDisposable: pty.IDisposable | null
}

interface ManagedTerminal {
  id: string
  projectPath: string
  pty: pty.IPty
  outputBuffer: string[]
  partialLine: string
  rawBuffer: string
  popout?: PopoutState
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

  private _registerPty(id: string, projectPath: string, ptyProcess: pty.IPty): TerminalInfo {
    const managed: ManagedTerminal = {
      id,
      projectPath,
      pty: ptyProcess,
      outputBuffer: [],
      partialLine: '',
      rawBuffer: ''
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

    this.closePopout(id)
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
    for (const [, projectTerminals] of this.terminals) {
      for (const [id, managed] of projectTerminals) {
        this.closePopout(id)
        try {
          managed.pty.kill()
        } catch {
          // Ignore kill errors during cleanup
        }
      }
    }
    this.terminals.clear()
  }

  private static readonly MAX_RAW_BUFFER = 200_000 // ~200KB of raw PTY output

  private _processOutput(managed: ManagedTerminal, data: string): void {
    // Store raw output for replay when terminal view remounts
    managed.rawBuffer += data
    if (managed.rawBuffer.length > TerminalManager.MAX_RAW_BUFFER) {
      managed.rawBuffer = managed.rawBuffer.slice(-TerminalManager.MAX_RAW_BUFFER)
    }

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

  getRawBuffer(id: string): string {
    const managed = this.findTerminal(id)
    if (!managed) return ''
    return managed.rawBuffer
  }

  private stripAnsi(text: string): string {
    // eslint-disable-next-line no-control-regex
    return text.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b\].*?(?:\x07|\x1b\\)|\x1b[()][0-9A-B]|\x1b[>=<]|\x1b\[[\?]?[0-9;]*[hlm]/g, '')
  }

  popout(id: string): { socketPath: string } {
    const managed = this.findTerminal(id)
    if (!managed) throw new Error('Terminal not found')
    if (managed.popout) throw new Error('Terminal already popped out')

    const socketPath = `/tmp/claudex-term-${id}.sock`

    // Clean up stale socket file
    try { unlinkSync(socketPath) } catch { /* ignore */ }

    const clients = new Set<net.Socket>()

    const server = net.createServer((client) => {
      clients.add(client)

      // Replay raw buffer so external terminal gets full history
      if (managed.rawBuffer) {
        client.write(managed.rawBuffer)
      }

      // Forward client input to PTY, handling resize messages
      let pendingBuf = Buffer.alloc(0)
      client.on('data', (data: Buffer) => {
        pendingBuf = Buffer.concat([pendingBuf, data])

        // Process resize markers: \x00 + R + uint16BE cols + uint16BE rows = 6 bytes
        while (pendingBuf.length > 0) {
          if (pendingBuf[0] === 0x00 && pendingBuf.length >= 6 && pendingBuf[1] === 0x52) {
            const cols = pendingBuf.readUInt16BE(2)
            const rows = pendingBuf.readUInt16BE(4)
            // Only resize if coming from a popped-out terminal (no IDE viewer conflict)
            try { managed.pty.resize(cols, rows) } catch { /* ignore */ }
            pendingBuf = pendingBuf.subarray(6)
          } else if (pendingBuf[0] === 0x00) {
            // Incomplete resize marker, wait for more data
            if (pendingBuf.length < 6) break
            // Not a resize marker, treat as regular data
            managed.pty.write(pendingBuf.subarray(0, 1).toString())
            pendingBuf = pendingBuf.subarray(1)
          } else {
            // Find next potential marker
            const markerIdx = pendingBuf.indexOf(0x00, 1)
            if (markerIdx === -1) {
              managed.pty.write(pendingBuf.toString())
              pendingBuf = Buffer.alloc(0)
            } else {
              managed.pty.write(pendingBuf.subarray(0, markerIdx).toString())
              pendingBuf = pendingBuf.subarray(markerIdx)
            }
          }
        }
      })

      client.on('close', () => {
        clients.delete(client)
      })
      client.on('error', () => {
        clients.delete(client)
      })
    })

    server.listen(socketPath)

    // Subscribe to PTY output and fan-out to all socket clients
    const dataDisposable = managed.pty.onData((data: string) => {
      for (const client of clients) {
        try { client.write(data) } catch { /* ignore */ }
      }
    })

    managed.popout = { server, clients, socketPath, externalProcess: null, dataDisposable }

    // Write connector script to temp file
    const connectScript = join(tmpdir(), `claudex-popout-connect-${id}.js`)
    writeFileSync(connectScript, CONNECT_SCRIPT)
    chmodSync(connectScript, 0o755)

    // Detect and launch external terminal emulator
    const termCmd = this.detectTerminalEmulator()
    if (termCmd) {
      const args = termCmd.wrapArgs(['node', connectScript, socketPath])
      const child = spawn(termCmd.command, args, {
        detached: true,
        stdio: 'ignore'
      })
      child.unref()
      managed.popout.externalProcess = child

      // Clean up popout when external terminal exits
      child.on('exit', () => {
        this.closePopout(id)
      })
    }

    return { socketPath }
  }

  closePopout(id: string): void {
    const managed = this.findTerminal(id)
    if (!managed?.popout) return

    const { server, clients, socketPath, externalProcess, dataDisposable } = managed.popout

    dataDisposable?.dispose()

    for (const client of clients) {
      try { client.destroy() } catch { /* ignore */ }
    }
    clients.clear()

    try { server.close() } catch { /* ignore */ }
    try { unlinkSync(socketPath) } catch { /* ignore */ }
    try { unlinkSync(join(tmpdir(), `claudex-popout-connect-${id}.js`)) } catch { /* ignore */ }

    if (externalProcess && !externalProcess.killed) {
      try { externalProcess.kill() } catch { /* ignore */ }
    }

    managed.popout = undefined

    // Notify renderer that popout closed
    try {
      if (this.mainWindow && !this.mainWindow.isDestroyed()) {
        broadcastSend(this.mainWindow, 'terminal:popout-closed', id)
      }
    } catch { /* ignore */ }
  }

  isPopout(id: string): boolean {
    return !!this.findTerminal(id)?.popout
  }

  private detectTerminalEmulator(): { command: string; wrapArgs: (cmd: string[]) => string[] } | null {
    const { execSync } = require('child_process')
    const which = (cmd: string): boolean => {
      try {
        execSync(`which ${cmd}`, { stdio: 'ignore' })
        return true
      } catch { return false }
    }

    // Check $TERMINAL env var first
    const envTerminal = process.env.TERMINAL
    if (envTerminal && which(envTerminal)) {
      // Most terminals use -e, gnome-terminal uses --
      if (envTerminal.includes('gnome-terminal')) {
        return { command: envTerminal, wrapArgs: (cmd) => ['--', ...cmd] }
      }
      return { command: envTerminal, wrapArgs: (cmd) => ['-e', ...cmd] }
    }

    // Probe common terminal emulators in preference order
    const terminals: Array<{ name: string; wrapArgs: (cmd: string[]) => string[] }> = [
      { name: 'kitty', wrapArgs: (cmd) => cmd },
      { name: 'alacritty', wrapArgs: (cmd) => ['-e', ...cmd] },
      { name: 'wezterm', wrapArgs: (cmd) => ['start', '--', ...cmd] },
      { name: 'foot', wrapArgs: (cmd) => cmd },
      { name: 'ghostty', wrapArgs: (cmd) => ['-e', ...cmd] },
      { name: 'gnome-terminal', wrapArgs: (cmd) => ['--', ...cmd] },
      { name: 'konsole', wrapArgs: (cmd) => ['-e', ...cmd] },
      { name: 'xfce4-terminal', wrapArgs: (cmd) => ['-e', cmd.join(' ')] },
      { name: 'tilix', wrapArgs: (cmd) => ['-e', cmd.join(' ')] },
      { name: 'terminator', wrapArgs: (cmd) => ['-e', cmd.join(' ')] },
      { name: 'xterm', wrapArgs: (cmd) => ['-e', ...cmd] },
    ]

    for (const t of terminals) {
      if (which(t.name)) {
        return { command: t.name, wrapArgs: t.wrapArgs }
      }
    }

    return null
  }

  private findTerminal(id: string): ManagedTerminal | null {
    for (const [, projectTerminals] of this.terminals) {
      const t = projectTerminals.get(id)
      if (t) return t
    }
    return null
  }
}
