import { spawn, ChildProcess, execSync } from 'child_process'
import { existsSync } from 'fs'
import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'
import { StreamParser } from './StreamParser'
import type { AgentEvent } from './types'

export interface AgentProcessOptions {
  projectPath: string
  sessionId?: string
  model?: string | null
  mcpConfigPath?: string | null
  systemPromptAppend?: string | null
}

/**
 * Resolve the absolute path to the `claude` binary.
 * Electron processes often have a stripped-down PATH that doesn't include
 * ~/.local/bin or other user dirs, so we search common locations.
 */
export function findClaudeBinary(): string {
  // 1. Try common install locations directly
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const candidates = [
    `${home}/.local/bin/claude`,
    `${home}/.claude/local/bin/claude`,
    '/usr/local/bin/claude',
    '/usr/bin/claude',
    `${home}/.nvm/versions/node/current/bin/claude`
  ]

  for (const p of candidates) {
    if (existsSync(p)) return p
  }

  // 2. Ask the user's default shell
  try {
    const resolved = execSync('bash -ilc "which claude" 2>/dev/null', {
      encoding: 'utf-8',
      timeout: 5000
    }).trim()
    if (resolved && existsSync(resolved)) return resolved
  } catch {
    // ignore
  }

  // 3. Fall back to bare name (will fail if not in Electron's PATH)
  return 'claude'
}

let _claudePath: string | null = null
function getClaudePath(): string {
  if (!_claudePath) {
    _claudePath = findClaudeBinary()
  }
  return _claudePath
}

/**
 * Build a PATH that includes common user binary directories.
 */
export function getEnhancedEnv(): NodeJS.ProcessEnv {
  const home = process.env.HOME || ''
  const extraPaths = [
    `${home}/.local/bin`,
    `${home}/.claude/local/bin`,
    '/usr/local/bin'
  ].filter(existsSync)

  const currentPath = process.env.PATH || ''
  const env = { ...process.env, PATH: [...extraPaths, currentPath].join(':') }

  // Remove env vars that would make the child claude think it's nested
  delete env.CLAUDECODE
  delete env.CLAUDE_CODE_ENTRYPOINT

  return env
}

/**
 * Manages a single Claude CLI process with stream-json protocol.
 * Each call to start() or resume() spawns a new `claude -p` process.
 * The session is maintained via --session-id / --resume flags.
 */
export class AgentProcess extends EventEmitter {
  private process: ChildProcess | null = null
  private parser: StreamParser
  private _sessionId: string
  private _projectPath: string
  private _model: string | null
  private _mcpConfigPath: string | null
  private _systemPromptAppend: string | null
  private _isRunning = false
  private _hasCompletedFirstTurn = false
  private stderrBuffer = ''

  get sessionId(): string {
    return this._sessionId
  }

  get isRunning(): boolean {
    return this._isRunning
  }

  get projectPath(): string {
    return this._projectPath
  }

  get hasCompletedFirstTurn(): boolean {
    return this._hasCompletedFirstTurn
  }

  constructor(options: AgentProcessOptions) {
    super()
    this._sessionId = options.sessionId ?? uuidv4()
    this._projectPath = options.projectPath
    this._model = options.model ?? null
    this._mcpConfigPath = options.mcpConfigPath ?? null
    this._systemPromptAppend = options.systemPromptAppend ?? null
    this.parser = new StreamParser()

    this.parser.on('event', (event: AgentEvent) => {
      this.emit('event', event)
    })

    this.parser.on('parse-error', (line: string) => {
      this.emit('parse-error', line)
    })
  }

  setModel(model: string | null): void {
    this._model = model
  }

  private _buildBaseArgs(prompt: string): string[] {
    const args = [
      '--dangerously-skip-permissions',
      '-p', prompt,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages'
    ]
    if (this._model) {
      args.push('--model', this._model)
    }
    if (this._mcpConfigPath) {
      args.push('--mcp-config', this._mcpConfigPath)
    }
    if (this._systemPromptAppend) {
      args.push('--append-system-prompt', this._systemPromptAppend)
    }
    return args
  }

  start(initialPrompt: string): void {
    if (this.process) {
      throw new Error('Agent process already running')
    }

    const args = [
      ...this._buildBaseArgs(initialPrompt),
      '--session-id', this._sessionId
    ]

    this._spawnProcess(args)
  }

  resume(message: string): void {
    if (this.process) {
      throw new Error('Agent process already running')
    }

    const args = [
      ...this._buildBaseArgs(message),
      '--resume', this._sessionId
    ]

    this._spawnProcess(args)
  }

  private _spawnProcess(args: string[]): void {
    this.parser.reset()
    this.stderrBuffer = ''

    const claudePath = getClaudePath()
    console.log(`[AgentProcess] Spawning: ${claudePath} ${args.join(' ')}`)
    console.log(`[AgentProcess] CWD: ${this._projectPath}`)

    this.process = spawn(claudePath, args, {
      cwd: this._projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: getEnhancedEnv()
    })

    this._isRunning = true

    this.process.stdout!.setEncoding('utf-8')
    this.process.stdout!.on('data', (chunk: string) => {
      this.parser.feed(chunk)
    })

    this.process.stderr!.setEncoding('utf-8')
    this.process.stderr!.on('data', (chunk: string) => {
      this.stderrBuffer += chunk
      this.emit('stderr', chunk)
    })

    this.process.on('close', (code: number | null) => {
      this.parser.flush()
      this._isRunning = false
      this._hasCompletedFirstTurn = true
      this.process = null
      console.log(`[AgentProcess] Closed with code ${code}`)
      this.emit('close', code)
    })

    this.process.on('error', (err: Error) => {
      this._isRunning = false
      this.process = null
      console.error(`[AgentProcess] Spawn error:`, err.message)
      this.emit('error', err)
    })
  }

  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM')
      setTimeout(() => {
        if (this.process) {
          this.process.kill('SIGKILL')
        }
      }, 5000)
    }
  }

  getStderrOutput(): string {
    return this.stderrBuffer
  }
}
