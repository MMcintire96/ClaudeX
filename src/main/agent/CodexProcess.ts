// @openai/codex-sdk is ESM-only — must use dynamic import() in CJS Electron main process
import { EventEmitter } from 'events'
import { v4 as uuidv4 } from 'uuid'
import type {
  AgentEvent,
  SystemInitEvent,
  StreamEvent,
  AssistantMessageEvent,
  ToolResultEvent,
  ResultEvent
} from './types'

// Lazy-loaded SDK module reference
let CodexClass: any = null

async function getCodexClass(): Promise<any> {
  if (!CodexClass) {
    const mod = await import('@openai/codex-sdk')
    CodexClass = mod.Codex
  }
  return CodexClass
}

export interface CodexProcessOptions {
  projectPath: string
  sessionId?: string
  model?: string | null
}

/**
 * Manages a single OpenAI Codex agent session using the Codex SDK.
 * Mirrors AgentProcess's interface: extends EventEmitter, emits the same
 * AgentEvent types so the renderer needs zero changes.
 */
export class CodexProcess extends EventEmitter {
  private _codex: any = null
  private _thread: any = null
  private _abortController: AbortController | null = null
  private _sessionId: string
  private _threadId: string | null = null
  private _projectPath: string
  private _model: string | null
  private _isRunning = false
  private _hasCompletedFirstTurn = false
  private _turnGeneration = 0
  private _blockIndex = 0
  private _lastTextLength: Map<string, number> = new Map()

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

  constructor(options: CodexProcessOptions) {
    super()
    this._sessionId = options.sessionId ?? uuidv4()
    this._projectPath = options.projectPath
    this._model = options.model ?? null
  }

  setModel(model: string | null): void {
    this._model = model
  }

  updateDisallowedTools(_tools: string[] | null): void {
    // No-op: Codex manages its own tool permissions
  }

  start(initialPrompt: string): void {
    if (this._isRunning) {
      throw new Error('Codex process already running')
    }
    this._emitSyntheticSystemInit()
    this._startAsync(initialPrompt)
  }

  resume(message: string): void {
    if (this._isRunning) {
      throw new Error('Codex process already running')
    }
    this._emitSyntheticSystemInit()
    this._resumeAsync(message)
  }

  stop(): void {
    this._abortController?.abort()
    this._abortController = null
    this._isRunning = false
  }

  // --- Private ---

  private async _startAsync(initialPrompt: string): Promise<void> {
    try {
      await this._initCodex()
      this._thread = this._codex.startThread({
        model: this._model ?? undefined,
        workingDirectory: this._projectPath,
        skipGitRepoCheck: true,
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
      })
      this._runTurn(initialPrompt)
    } catch (err: any) {
      console.error('[CodexProcess] Failed to start:', err?.message || err)
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
    }
  }

  private async _resumeAsync(message: string): Promise<void> {
    try {
      if (!this._thread) {
        await this._initCodex()
        if (this._threadId) {
          this._thread = this._codex.resumeThread(this._threadId, {
            model: this._model ?? undefined,
            workingDirectory: this._projectPath,
            skipGitRepoCheck: true,
            sandboxMode: 'danger-full-access',
            approvalPolicy: 'never',
          })
        } else {
          this._thread = this._codex.startThread({
            model: this._model ?? undefined,
            workingDirectory: this._projectPath,
            skipGitRepoCheck: true,
            sandboxMode: 'danger-full-access',
            approvalPolicy: 'never',
          })
        }
      }
      this._runTurn(message)
    } catch (err: any) {
      console.error('[CodexProcess] Failed to resume:', err?.message || err)
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
    }
  }

  private async _initCodex(): Promise<void> {
    const Ctor = await getCodexClass()
    this._codex = new Ctor()
  }

  private _emitSyntheticSystemInit(): void {
    const initEvent: SystemInitEvent = {
      type: 'system',
      subtype: 'init',
      session_id: this._sessionId,
      tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
      model: this._model ?? undefined,
    }
    this.emit('event', initEvent)
  }

  private async _runTurn(prompt: string): Promise<void> {
    this._isRunning = true
    this._abortController = new AbortController()
    this._blockIndex = 0
    this._lastTextLength.clear()
    const generation = ++this._turnGeneration
    const turnStart = Date.now()

    try {
      const { events } = await this._thread!.runStreamed(prompt, {
        signal: this._abortController.signal,
      })

      // Emit message_start to trigger the streaming UI
      this._emitStreamEvent({
        type: 'message_start',
        message: {
          id: `codex-msg-${Date.now()}`,
          type: 'message',
          role: 'assistant',
          model: this._model ?? 'codex',
          usage: { input_tokens: 0, output_tokens: 0 },
        }
      })

      for await (const event of events) {
        if (this._turnGeneration !== generation) return
        this._mapAndEmit(event, generation)
      }

      if (this._turnGeneration !== generation) return

      // If no explicit turn.completed was received, emit a synthetic result
      this._emitStreamEvent({ type: 'message_stop' })
      this._emitResult(true, null, Date.now() - turnStart, null)
      this._finalizeTurn(null)
    } catch (err: any) {
      if (this._turnGeneration !== generation) return

      if (err?.name === 'AbortError' || this._abortController?.signal.aborted) {
        this._hasCompletedFirstTurn = true
        this._isRunning = false
        console.log('[CodexProcess] Turn aborted')
        this.emit('close', 0)
        return
      }

      console.error('[CodexProcess] Turn error:', err?.message || err)
      this._emitResult(false, err?.message ?? String(err), Date.now() - turnStart, null)
      this._finalizeTurn(err instanceof Error ? err : new Error(String(err)))
    }
  }

  private _mapAndEmit(event: any, _generation: number): void {
    switch (event.type) {
      case 'thread.started':
        this._threadId = event.thread_id
        console.log(`[CodexProcess] Thread started: ${event.thread_id}`)
        break

      case 'turn.started':
        // Already emitted message_start before the loop
        break

      case 'item.started':
        this._handleItemStarted(event.item)
        break

      case 'item.updated':
        this._handleItemUpdated(event.item)
        break

      case 'item.completed':
        this._handleItemCompleted(event.item)
        break

      case 'turn.completed': {
        this._emitStreamEvent({ type: 'message_stop' })
        const usage = event.usage
        this._emitResult(true, null, 0, usage)
        break
      }

      case 'turn.failed':
        this._emitStreamEvent({ type: 'message_stop' })
        this._emitResult(false, event.error?.message ?? 'Turn failed', 0, null)
        break

      case 'error':
        console.error('[CodexProcess] Stream error:', event.message)
        this.emit('error', new Error(event.message))
        break
    }
  }

  private _handleItemStarted(item: any): void {
    if (item.type === 'agent_message') {
      this._emitStreamEvent({
        type: 'content_block_start',
        index: this._blockIndex,
        content_block: { type: 'text', text: '' },
      })
    }
    // Tool items emit as complete blocks on item.completed
  }

  private _handleItemUpdated(item: any): void {
    if (item.type === 'agent_message') {
      const newText = item.text ?? ''
      const prevLen = this._lastTextLength.get(item.id) ?? 0
      if (newText.length > prevLen) {
        const delta = newText.slice(prevLen)
        this._lastTextLength.set(item.id, newText.length)
        this._emitStreamEvent({
          type: 'content_block_delta',
          index: this._blockIndex,
          delta: { type: 'text_delta', text: delta },
        })
      }
    }
  }

  private _handleItemCompleted(item: any): void {
    switch (item.type) {
      case 'agent_message': {
        // Close the streaming block
        this._emitStreamEvent({
          type: 'content_block_stop',
          index: this._blockIndex++,
        })
        // Emit the full assistant message
        const assistantEvent: AssistantMessageEvent = {
          type: 'assistant',
          session_id: this._sessionId,
          message: {
            id: item.id,
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: item.text ?? '' }],
            model: this._model ?? 'codex',
            stop_reason: 'end_turn',
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }
        this.emit('event', assistantEvent)
        this._lastTextLength.delete(item.id)
        break
      }

      case 'command_execution': {
        const toolId = `tool-${item.id}`
        const toolAssistant: AssistantMessageEvent = {
          type: 'assistant',
          session_id: this._sessionId,
          message: {
            id: `msg-${item.id}`,
            type: 'message',
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: toolId,
              name: 'Bash',
              input: { command: item.command ?? '', description: '' },
            }],
            model: this._model ?? 'codex',
            stop_reason: 'tool_use',
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }
        this.emit('event', toolAssistant)

        const toolResult: ToolResultEvent = {
          type: 'tool_result',
          tool_use_id: toolId,
          content: item.aggregated_output ?? `Exit code: ${item.exit_code ?? 'unknown'}`,
          is_error: (item.exit_code ?? 0) !== 0,
          session_id: this._sessionId,
        }
        this.emit('event', toolResult)
        break
      }

      case 'file_change': {
        const toolId = `tool-${item.id}`
        const changes = item.changes ?? []
        const filePaths = changes.map((c: any) => c.path).join(', ')
        const toolAssistant: AssistantMessageEvent = {
          type: 'assistant',
          session_id: this._sessionId,
          message: {
            id: `msg-${item.id}`,
            type: 'message',
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: toolId,
              name: 'Edit',
              input: { file_path: filePaths, old_string: '', new_string: '' },
            }],
            model: this._model ?? 'codex',
            stop_reason: 'tool_use',
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }
        this.emit('event', toolAssistant)

        const resultText = item.status === 'completed'
          ? `File changes applied: ${filePaths}`
          : `File change failed: ${filePaths}`
        const toolResult: ToolResultEvent = {
          type: 'tool_result',
          tool_use_id: toolId,
          content: resultText,
          is_error: item.status !== 'completed',
          session_id: this._sessionId,
        }
        this.emit('event', toolResult)
        break
      }

      case 'mcp_tool_call': {
        const toolId = `tool-${item.id}`
        const toolName = item.tool ?? 'mcp_tool'
        const toolAssistant: AssistantMessageEvent = {
          type: 'assistant',
          session_id: this._sessionId,
          message: {
            id: `msg-${item.id}`,
            type: 'message',
            role: 'assistant',
            content: [{
              type: 'tool_use',
              id: toolId,
              name: toolName,
              input: item.arguments ?? {},
            }],
            model: this._model ?? 'codex',
            stop_reason: 'tool_use',
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        }
        this.emit('event', toolAssistant)

        const resultContent = item.error
          ? `Error: ${item.error.message}`
          : JSON.stringify(item.result ?? 'completed')
        const toolResult: ToolResultEvent = {
          type: 'tool_result',
          tool_use_id: toolId,
          content: resultContent,
          is_error: !!item.error,
          session_id: this._sessionId,
        }
        this.emit('event', toolResult)
        break
      }

      case 'reasoning':
        // Skip reasoning items for now — could map to thinking blocks later
        break

      case 'todo_list':
      case 'web_search':
      case 'error':
        // Skip non-critical item types
        break
    }
  }

  private _emitResult(
    success: boolean,
    error: string | null,
    durationMs: number,
    _usage: any
  ): void {
    const resultEvent: ResultEvent = {
      type: 'result',
      subtype: success ? 'success' : 'error',
      session_id: this._sessionId,
      is_error: !success,
      error: error ?? undefined,
      total_cost_usd: 0,
      cost_usd: 0,
      num_turns: 1,
      duration_ms: durationMs,
      duration_api_ms: 0,
    }
    this.emit('event', resultEvent)
  }

  private _finalizeTurn(error: Error | null): void {
    this._isRunning = false
    this._hasCompletedFirstTurn = true

    if (error) {
      this.emit('error', error)
    }
    this.emit('close', error ? 1 : 0)
  }

  private _emitStreamEvent(sub: any): void {
    const streamEvent: StreamEvent = {
      type: 'stream_event',
      event: sub,
      session_id: this._sessionId,
    }
    this.emit('event', streamEvent)
  }
}
