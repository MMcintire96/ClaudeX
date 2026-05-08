/**
 * Shared session-event types and reducer used by both the desktop renderer
 * and the mobile PWA. The desktop renderer uses its own Zustand-flavoured
 * reducer in src/renderer/src/stores/sessionStore.ts; this module is the
 * minimum needed for a thin client (mobile) that only renders the message
 * stream and tracks streaming text.
 */

// --- UI message types ---

export interface UITextMessage {
  id: string
  role: 'user' | 'assistant'
  type: 'text'
  content: string
  images?: Array<{ path: string; previewUrl: string }>
  timestamp: number
}

export interface UIToolUseMessage {
  id: string
  role: 'assistant'
  type: 'tool_use'
  toolName: string
  toolId: string
  input: Record<string, unknown>
  timestamp: number
}

export interface UIToolResultMessage {
  id: string
  role: 'tool'
  type: 'tool_result'
  toolUseId: string
  content: string
  imageData?: Array<{ data: string; mimeType: string }>
  isError: boolean
  timestamp: number
}

export interface UISystemMessage {
  id: string
  role: 'system'
  type: 'system'
  content: string
  timestamp: number
}

export interface UIThinkingMessage {
  id: string
  role: 'assistant'
  type: 'thinking'
  content: string
  timestamp: number
}

export type UIMessage =
  | UITextMessage
  | UIToolUseMessage
  | UIToolResultMessage
  | UISystemMessage
  | UIThinkingMessage

// --- Slim per-session state for the mobile reducer ---

export interface SlimSessionState {
  messages: UIMessage[]
  streamingText: string
  isStreaming: boolean
  isProcessing: boolean
  /** Model id selected for this session (mirrors desktop). */
  selectedModel: string | null
  /** Reasoning effort for this session (mirrors desktop). */
  selectedEffort: string | null
  /** Suggested next message (from agent:suggestion). null when consumed/cleared. */
  suggestion: string | null
}

export function emptySlimState(): SlimSessionState {
  return {
    messages: [],
    streamingText: '',
    isStreaming: false,
    isProcessing: false,
    selectedModel: null,
    selectedEffort: null,
    suggestion: null
  }
}

/**
 * Apply a single agent event to a SlimSessionState.
 * Pure: returns a new state, never mutates. Designed for the mobile client
 * which doesn't need cost/turn tracking, fork metadata, or thinking deltas.
 */
export function reduceAgentEvent(state: SlimSessionState, rawEvent: unknown): SlimSessionState {
  const event = rawEvent as Record<string, unknown>
  if (!event || typeof event !== 'object') return state

  switch (event.type) {
    case 'system': {
      if (event.subtype === 'init') {
        // Clear stale suggestion when the agent starts a new turn.
        return { ...state, isProcessing: true, suggestion: null }
      }
      return state
    }

    case 'stream_event': {
      const streamEvent = event.event as Record<string, unknown> | undefined
      if (!streamEvent) return state
      switch (streamEvent.type) {
        case 'message_start':
          return { ...state, isStreaming: true, streamingText: '' }
        case 'content_block_delta': {
          const delta = streamEvent.delta as Record<string, unknown> | undefined
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            return { ...state, streamingText: state.streamingText + delta.text }
          }
          return state
        }
        case 'message_stop':
          return { ...state, isStreaming: false }
        default:
          return state
      }
    }

    case 'assistant': {
      const msg = event.message as Record<string, unknown> | undefined
      if (!msg) return state
      const content = msg.content as Array<Record<string, unknown>> | undefined
      if (!content) return state

      const now = Date.now()
      const newMessages: UIMessage[] = []
      let fullText = ''

      for (const block of content) {
        if (block.type === 'thinking' && block.thinking) {
          if (fullText) {
            newMessages.push({
              id: `text-${msg.id}-${now}-${newMessages.length}`,
              role: 'assistant',
              type: 'text',
              content: fullText,
              timestamp: now
            })
            fullText = ''
          }
          newMessages.push({
            id: `thinking-${msg.id}-${now}-${newMessages.length}`,
            role: 'assistant',
            type: 'thinking',
            content: block.thinking as string,
            timestamp: now
          })
        } else if (block.type === 'text') {
          fullText += typeof block.text === 'string' ? block.text : ''
        } else if (block.type === 'tool_use') {
          if (fullText) {
            newMessages.push({
              id: `text-${msg.id}-${now}-${newMessages.length}`,
              role: 'assistant',
              type: 'text',
              content: fullText,
              timestamp: now
            })
            fullText = ''
          }
          newMessages.push({
            id: block.id as string,
            role: 'assistant',
            type: 'tool_use',
            toolName: block.name as string,
            toolId: block.id as string,
            input: (block.input as Record<string, unknown>) ?? {},
            timestamp: now
          })
        }
      }

      if (fullText) {
        newMessages.push({
          id: `text-${msg.id}-${now}-${newMessages.length}`,
          role: 'assistant',
          type: 'text',
          content: fullText,
          timestamp: now
        })
      }

      // Dedup against existing IDs (replay safety).
      const newIds = new Set(newMessages.map(m => m.id))
      const filtered = state.messages.filter(m => !newIds.has(m.id))

      return {
        ...state,
        messages: [...filtered, ...newMessages],
        streamingText: '',
        isStreaming: false
      }
    }

    case 'tool_result': {
      const toolContent = event.content
      let textContent: string
      let imageData: Array<{ data: string; mimeType: string }> | undefined

      if (typeof toolContent === 'string') {
        textContent = toolContent
      } else if (Array.isArray(toolContent)) {
        const textParts: string[] = []
        const images: Array<{ data: string; mimeType: string }> = []
        for (const block of toolContent as Array<Record<string, unknown>>) {
          if (block.type === 'text') textParts.push(block.text as string)
          else if (block.type === 'image') {
            images.push({
              data: block.data as string,
              mimeType: (block.mimeType as string) || 'image/jpeg'
            })
          }
        }
        textContent = textParts.join('\n')
        if (images.length > 0) imageData = images
      } else {
        textContent = String(toolContent)
      }

      const resultMsg: UIToolResultMessage = {
        id: `result-${event.tool_use_id}-${Date.now()}`,
        role: 'tool',
        type: 'tool_result',
        toolUseId: event.tool_use_id as string,
        content: textContent,
        ...(imageData ? { imageData } : {}),
        isError: (event.is_error as boolean) ?? false,
        timestamp: Date.now()
      }
      return { ...state, messages: [...state.messages, resultMsg] }
    }

    case 'result': {
      return { ...state, isStreaming: false, isProcessing: false }
    }

    default:
      return state
  }
}

/**
 * Returns true if the session's last unanswered tool_use is an
 * AskUserQuestion or ExitPlanMode (i.e. needs human input).
 */
export function sessionNeedsInput(state: SlimSessionState): boolean {
  if (state.isProcessing) return false
  const msgs = state.messages
  if (msgs.length === 0) return false

  const answeredToolIds = new Set<string>()
  for (const m of msgs) {
    if (m.type === 'tool_result') answeredToolIds.add((m as UIToolResultMessage).toolUseId)
  }

  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.role === 'user' && m.type === 'text') return false
    if (m.type !== 'tool_use') continue
    const tu = m as UIToolUseMessage
    if (answeredToolIds.has(tu.toolId)) return false
    if (tu.toolName === 'AskUserQuestion' || tu.toolName === 'ExitPlanMode') return true
  }
  return false
}
