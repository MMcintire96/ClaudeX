import { query, type Query } from '@anthropic-ai/claude-agent-sdk'
import { EventEmitter } from 'events'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import { app } from 'electron'
import type { AgentEvent } from './types'

export interface AgentProcessOptions {
  projectPath: string
  sessionId?: string
  model?: string | null
  mcpServers?: Record<string, any> | null
  systemPromptAppend?: string | null
}

/**
 * Manages a single Claude agent session using the Claude Agent SDK.
 * Each call to start() or resume() runs a query() that yields typed messages
 * via an async iterator. The session is maintained via sessionId / resume options.
 */
export class AgentProcess extends EventEmitter {
  private _query: Query | null = null
  private abortController: AbortController | null = null
  private _sessionId: string
  private _projectPath: string
  private _model: string | null
  private _mcpServers: Record<string, any> | null
  private _systemPromptAppend: string | null
  private _isRunning = false
  private _hasCompletedFirstTurn = false

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
    this._mcpServers = options.mcpServers ?? null
    this._systemPromptAppend = options.systemPromptAppend ?? null
  }

  setModel(model: string | null): void {
    this._model = model
  }

  start(initialPrompt: string): void {
    if (this._query) {
      throw new Error('Agent process already running')
    }
    this._runQuery(initialPrompt, false)
  }

  resume(message: string): void {
    if (this._query) {
      throw new Error('Agent process already running')
    }
    this._runQuery(message, true)
  }

  stop(): void {
    if (this._query) {
      this._query.close()
      this._query = null
    }
    this.abortController?.abort()
  }

  private _runQuery(prompt: string, isResume: boolean): void {
    this.abortController = new AbortController()

    const options: Record<string, any> = {
      abortController: this.abortController,
      cwd: this._projectPath,
      permissionMode: 'bypassPermissions' as const,
      allowDangerouslySkipPermissions: true,
      includePartialMessages: true,
      persistSession: true,
    }

    // In packaged app, the SDK is loaded from app.asar but cli.js must be
    // spawned as a real file. Point to the asarUnpack'd copy.
    if (app.isPackaged) {
      options.pathToClaudeCodeExecutable = join(
        process.resourcesPath,
        'app.asar.unpacked',
        'node_modules',
        '@anthropic-ai',
        'claude-agent-sdk',
        'cli.js'
      )
      console.log(`[AgentProcess] Using unpacked CLI: ${options.pathToClaudeCodeExecutable}`)
    }

    if (isResume) {
      options.resume = this._sessionId
    } else {
      options.sessionId = this._sessionId
    }

    if (this._model) {
      options.model = this._model
    }

    if (this._mcpServers) {
      options.mcpServers = this._mcpServers
    }

    if (this._systemPromptAppend) {
      options.systemPrompt = {
        type: 'preset' as const,
        preset: 'claude_code' as const,
        append: this._systemPromptAppend
      }
    }

    console.log(`[AgentProcess] Starting SDK query (resume=${isResume})`)
    console.log(`[AgentProcess] CWD: ${this._projectPath}`)
    console.log(`[AgentProcess] Prompt length: ${prompt.length} chars`)

    this._isRunning = true

    const iter = query({ prompt, options })
    this._query = iter

    this._consumeIterator(iter)
  }

  private async _consumeIterator(iter: Query): Promise<void> {
    try {
      for await (const message of iter) {
        // The SDK yields typed messages — forward ones the renderer understands
        this._mapAndEmit(message)
      }

      // Iterator completed normally
      this._isRunning = false
      this._hasCompletedFirstTurn = true
      this._query = null
      console.log('[AgentProcess] Query completed')
      this.emit('close', 0)
    } catch (err: any) {
      this._isRunning = false
      this._query = null

      // AbortError is expected when stop() is called
      if (err?.name === 'AbortError' || this.abortController?.signal.aborted) {
        this._hasCompletedFirstTurn = true
        console.log('[AgentProcess] Query aborted')
        this.emit('close', 0)
        return
      }

      console.error('[AgentProcess] Query error:', err?.message || err)
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
    }
  }

  private _mapAndEmit(message: any): void {
    switch (message.type) {
      case 'system':
        // SDKSystemMessage — pass through, shapes match
        this.emit('event', message as AgentEvent)
        break

      case 'stream_event':
        // SDKPartialAssistantMessage — already has { type: 'stream_event', event: ... }
        // which matches our StreamEvent shape exactly
        this.emit('event', message as AgentEvent)
        break

      case 'assistant':
        // SDKAssistantMessage — { type: 'assistant', message: BetaMessage, session_id }
        // Matches our AssistantMessageEvent shape
        this.emit('event', message as AgentEvent)
        break

      case 'tool_result':
        // SDKToolResultMessage — matches our ToolResultEvent
        this.emit('event', message as AgentEvent)
        break

      case 'result': {
        // SDKResultMessage — map to our ResultEvent shape
        const resultEvent: AgentEvent = {
          type: 'result',
          subtype: message.subtype === 'success' ? 'success' : 'error',
          session_id: message.session_id,
          is_error: message.subtype !== 'success',
          total_cost_usd: message.total_cost_usd,
          cost_usd: message.total_cost_usd,
          num_turns: message.num_turns,
          duration_ms: message.duration_ms,
          duration_api_ms: message.duration_api_ms,
          result: message.result,
          error: message.errors?.join('\n'),
        }
        this.emit('event', resultEvent)
        break
      }

      default:
        // Other SDK message types (status, hook, etc.) — ignore for now
        break
    }
  }
}
