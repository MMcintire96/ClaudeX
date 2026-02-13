import { EventEmitter } from 'events'
import type { AgentEvent } from './types'

/**
 * Line-buffered JSONL parser for Claude CLI stdout.
 * Handles partial chunks from the stream and emits parsed events.
 */
export class StreamParser extends EventEmitter {
  private buffer = ''

  feed(chunk: string): void {
    this.buffer += chunk
    const lines = this.buffer.split('\n')
    // Keep last potentially incomplete line in buffer
    this.buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue

      try {
        const event = JSON.parse(trimmed) as AgentEvent
        this.emit('event', event)
      } catch {
        this.emit('parse-error', trimmed)
      }
    }
  }

  flush(): void {
    if (this.buffer.trim()) {
      try {
        const event = JSON.parse(this.buffer.trim()) as AgentEvent
        this.emit('event', event)
      } catch {
        this.emit('parse-error', this.buffer.trim())
      }
    }
    this.buffer = ''
  }

  reset(): void {
    this.buffer = ''
  }
}
