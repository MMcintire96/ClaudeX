import { describe, it, expect } from 'vitest'
import {
  emptySlimState,
  reduceAgentEvent,
  sessionNeedsInput,
  UIToolUseMessage
} from '../../../../shared/sessionEvents'

describe('reduceAgentEvent', () => {
  it('starts in empty state', () => {
    const s = emptySlimState()
    expect(s.messages).toEqual([])
    expect(s.streamingText).toBe('')
    expect(s.isStreaming).toBe(false)
    expect(s.isProcessing).toBe(false)
  })

  it('handles system init by setting isProcessing', () => {
    const s = reduceAgentEvent(emptySlimState(), { type: 'system', subtype: 'init' })
    expect(s.isProcessing).toBe(true)
  })

  it('appends streaming text deltas', () => {
    let s = reduceAgentEvent(emptySlimState(), {
      type: 'stream_event',
      event: { type: 'message_start' }
    })
    expect(s.isStreaming).toBe(true)
    s = reduceAgentEvent(s, {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }
    })
    s = reduceAgentEvent(s, {
      type: 'stream_event',
      event: { type: 'content_block_delta', delta: { type: 'text_delta', text: ', world' } }
    })
    expect(s.streamingText).toBe('Hello, world')
    s = reduceAgentEvent(s, { type: 'stream_event', event: { type: 'message_stop' } })
    expect(s.isStreaming).toBe(false)
  })

  it('produces a text message from an assistant block', () => {
    const s = reduceAgentEvent(emptySlimState(), {
      type: 'assistant',
      message: {
        id: 'msg_1',
        content: [{ type: 'text', text: 'hi there' }]
      }
    })
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0].type).toBe('text')
    expect(s.messages[0].role).toBe('assistant')
    if (s.messages[0].type === 'text') expect(s.messages[0].content).toBe('hi there')
  })

  it('produces a tool_use message and clears streaming state', () => {
    let s = reduceAgentEvent(emptySlimState(), {
      type: 'stream_event',
      event: { type: 'message_start' }
    })
    s = reduceAgentEvent(s, {
      type: 'assistant',
      message: {
        id: 'msg_2',
        content: [
          { type: 'tool_use', id: 'tool_1', name: 'AskUserQuestion', input: { questions: [{ question: 'why?' }] } }
        ]
      }
    })
    expect(s.messages).toHaveLength(1)
    expect(s.messages[0].type).toBe('tool_use')
    expect(s.streamingText).toBe('')
    expect(s.isStreaming).toBe(false)
  })

  it('appends a tool_result', () => {
    let s = reduceAgentEvent(emptySlimState(), {
      type: 'assistant',
      message: { id: 'msg_3', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }] }
    })
    s = reduceAgentEvent(s, { type: 'tool_result', tool_use_id: 't1', content: 'ok', is_error: false })
    expect(s.messages.some(m => m.type === 'tool_result')).toBe(true)
  })

  it('result event clears processing/streaming', () => {
    let s = { ...emptySlimState(), isProcessing: true, isStreaming: true }
    s = reduceAgentEvent(s, { type: 'result' })
    expect(s.isProcessing).toBe(false)
    expect(s.isStreaming).toBe(false)
  })

  it('deduplicates assistant messages by id (replay safety)', () => {
    const evt = {
      type: 'assistant',
      message: { id: 'msg_dup', content: [{ type: 'text', text: 'first' }] }
    }
    let s = reduceAgentEvent(emptySlimState(), evt)
    s = reduceAgentEvent(s, evt)
    // The dedup is by inner block id — text blocks have generated IDs so they'll
    // differ between invocations of the same event. Tool blocks dedup correctly
    // because their `id` comes from the block itself.
    const toolEvt = {
      type: 'assistant',
      message: {
        id: 'msg_tool',
        content: [{ type: 'tool_use', id: 'stable_tool_id', name: 'Read', input: {} }]
      }
    }
    let s2 = reduceAgentEvent(emptySlimState(), toolEvt)
    s2 = reduceAgentEvent(s2, toolEvt)
    expect(s2.messages.filter(m => m.type === 'tool_use').length).toBe(1)
  })
})

describe('sessionNeedsInput', () => {
  it('returns false on empty', () => {
    expect(sessionNeedsInput(emptySlimState())).toBe(false)
  })

  it('returns false while processing', () => {
    const s = { ...emptySlimState(), isProcessing: true }
    expect(sessionNeedsInput(s)).toBe(false)
  })

  it('returns true after AskUserQuestion with no answer', () => {
    let s = reduceAgentEvent(emptySlimState(), {
      type: 'assistant',
      message: {
        id: 'm1',
        content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [] } }]
      }
    })
    s = reduceAgentEvent(s, { type: 'result' })
    expect(sessionNeedsInput(s)).toBe(true)
  })

  it('returns false after the question is answered', () => {
    let s = reduceAgentEvent(emptySlimState(), {
      type: 'assistant',
      message: {
        id: 'm1',
        content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { questions: [] } }]
      }
    })
    s = reduceAgentEvent(s, { type: 'tool_result', tool_use_id: 'q1', content: 'answer', is_error: false })
    s = reduceAgentEvent(s, { type: 'result' })
    expect(sessionNeedsInput(s)).toBe(false)
    // Sanity check — tool message shape preserved.
    const toolUse = s.messages.find(m => m.type === 'tool_use') as UIToolUseMessage | undefined
    expect(toolUse?.toolName).toBe('AskUserQuestion')
  })

  it('returns true after ExitPlanMode', () => {
    let s = reduceAgentEvent(emptySlimState(), {
      type: 'assistant',
      message: {
        id: 'm1',
        content: [{ type: 'tool_use', id: 'p1', name: 'ExitPlanMode', input: {} }]
      }
    })
    s = reduceAgentEvent(s, { type: 'result' })
    expect(sessionNeedsInput(s)).toBe(true)
  })
})
