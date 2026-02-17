import { create } from 'zustand'

// UI message types for rendering
export interface UITextMessage {
  id: string
  role: 'user' | 'assistant'
  type: 'text'
  content: string
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
  isError: boolean
  timestamp: number
}

export type UIMessage = UITextMessage | UIToolUseMessage | UIToolResultMessage

export interface SessionState {
  sessionId: string
  projectPath: string
  name: string
  messages: UIMessage[]
  streamingText: string
  isStreaming: boolean
  isProcessing: boolean
  costUsd: number
  totalCostUsd: number
  numTurns: number
  model: string | null
  claudeVersion: string | null
  error: string | null
  selectedModel: string | null
  createdAt: number
}

function createSessionState(sessionId: string, projectPath: string): SessionState {
  return {
    sessionId,
    projectPath,
    name: `Session`,
    messages: [],
    streamingText: '',
    isStreaming: false,
    isProcessing: false,
    costUsd: 0,
    totalCostUsd: 0,
    numTurns: 0,
    model: null,
    claudeVersion: null,
    error: null,
    selectedModel: null,
    createdAt: Date.now()
  }
}

interface SessionStore {
  sessions: Record<string, SessionState>
  activeSessionId: string | null

  // Per-project memory: remembers last active session per project
  projectSessionMemory: Record<string, string>

  createSession: (projectPath: string, sessionId: string) => void
  removeSession: (sessionId: string) => void
  setActiveSession: (sessionId: string | null) => void
  getLastSessionForProject: (projectPath: string) => string | null
  processEvent: (sessionId: string, event: unknown) => void
  addUserMessage: (sessionId: string, content: string) => void
  setProcessing: (sessionId: string, processing: boolean) => void
  setError: (sessionId: string, error: string | null) => void
  setSelectedModel: (sessionId: string, model: string | null) => void
  renameSession: (sessionId: string, name: string) => void
  getSessionsForProject: (projectPath: string) => SessionState[]
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: {},
  activeSessionId: null,
  projectSessionMemory: {},

  createSession: (projectPath: string, sessionId: string): void => {
    set(state => ({
      sessions: {
        ...state.sessions,
        [sessionId]: createSessionState(sessionId, projectPath)
      },
      activeSessionId: sessionId,
      projectSessionMemory: { ...state.projectSessionMemory, [projectPath]: sessionId }
    }))
  },

  removeSession: (sessionId: string): void => {
    set(state => {
      const { [sessionId]: _, ...rest } = state.sessions
      return {
        sessions: rest,
        activeSessionId: state.activeSessionId === sessionId ? null : state.activeSessionId
      }
    })
  },

  setActiveSession: (sessionId: string | null): void => {
    set(state => {
      if (!sessionId) return { activeSessionId: null }
      const session = state.sessions[sessionId]
      const memory = session
        ? { ...state.projectSessionMemory, [session.projectPath]: sessionId }
        : state.projectSessionMemory
      return { activeSessionId: sessionId, projectSessionMemory: memory }
    })
  },

  getLastSessionForProject: (projectPath: string): string | null => {
    const state = get()
    const memorized = state.projectSessionMemory[projectPath]
    if (memorized && state.sessions[memorized]) return memorized
    // Fallback: find most recent session for this project
    const projectSessions = Object.values(state.sessions)
      .filter(s => s.projectPath === projectPath)
      .sort((a, b) => b.createdAt - a.createdAt)
    return projectSessions[0]?.sessionId ?? null
  },

  processEvent: (sessionId: string, rawEvent: unknown): void => {
    const event = rawEvent as Record<string, unknown>
    if (!event || typeof event !== 'object') return

    const state = get()
    const session = state.sessions[sessionId]
    if (!session) return

    switch (event.type) {
      case 'system': {
        if (event.subtype === 'init') {
          set(s => ({
            sessions: {
              ...s.sessions,
              [sessionId]: {
                ...s.sessions[sessionId],
                sessionId: (event.session_id as string) ?? sessionId,
                claudeVersion: (event.claude_code_version as string) ?? null,
                isProcessing: true
              }
            }
          }))
        }
        break
      }

      case 'stream_event': {
        const streamEvent = event.event as Record<string, unknown>
        if (!streamEvent) break

        switch (streamEvent.type) {
          case 'message_start': {
            set(s => ({
              sessions: {
                ...s.sessions,
                [sessionId]: { ...s.sessions[sessionId], isStreaming: true, streamingText: '' }
              }
            }))
            break
          }
          case 'content_block_delta': {
            const delta = streamEvent.delta as Record<string, unknown>
            if (delta?.type === 'text_delta') {
              set(s => ({
                sessions: {
                  ...s.sessions,
                  [sessionId]: {
                    ...s.sessions[sessionId],
                    streamingText: s.sessions[sessionId].streamingText + (delta.text as string)
                  }
                }
              }))
            }
            break
          }
          case 'message_stop': {
            set(s => ({
              sessions: {
                ...s.sessions,
                [sessionId]: { ...s.sessions[sessionId], isStreaming: false }
              }
            }))
            break
          }
        }
        break
      }

      case 'assistant': {
        const msg = event.message as Record<string, unknown>
        if (!msg) break

        const content = msg.content as Array<Record<string, unknown>>
        if (!content) break
        const now = Date.now()

        const newMessages: UIMessage[] = []
        let fullText = ''

        for (const block of content) {
          if (block.type === 'text') {
            fullText += block.text as string
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
              input: block.input as Record<string, unknown>,
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

        const model = msg.model as string | undefined

        set(s => ({
          sessions: {
            ...s.sessions,
            [sessionId]: {
              ...s.sessions[sessionId],
              messages: [...s.sessions[sessionId].messages, ...newMessages],
              streamingText: '',
              isStreaming: false,
              model: model ?? s.sessions[sessionId].model
            }
          }
        }))
        break
      }

      case 'tool_result': {
        const toolContent = event.content
        let textContent: string
        if (typeof toolContent === 'string') {
          textContent = toolContent
        } else if (Array.isArray(toolContent)) {
          textContent = (toolContent as Array<{ text: string }>)
            .map(c => c.text)
            .join('\n')
        } else {
          textContent = String(toolContent)
        }

        const resultMsg: UIToolResultMessage = {
          id: `result-${event.tool_use_id}-${Date.now()}`,
          role: 'tool',
          type: 'tool_result',
          toolUseId: event.tool_use_id as string,
          content: textContent,
          isError: (event.is_error as boolean) ?? false,
          timestamp: Date.now()
        }

        set(s => ({
          sessions: {
            ...s.sessions,
            [sessionId]: {
              ...s.sessions[sessionId],
              messages: [...s.sessions[sessionId].messages, resultMsg]
            }
          }
        }))
        break
      }

      case 'result': {
        set(s => ({
          sessions: {
            ...s.sessions,
            [sessionId]: {
              ...s.sessions[sessionId],
              isStreaming: false,
              costUsd: (event.cost_usd as number) ?? s.sessions[sessionId].costUsd,
              totalCostUsd: (event.total_cost_usd as number) ?? s.sessions[sessionId].totalCostUsd,
              numTurns: (event.num_turns as number) ?? s.sessions[sessionId].numTurns,
              error: event.is_error ? (event.error as string) ?? 'Unknown error' : null
            }
          }
        }))
        break
      }
    }
  },

  addUserMessage: (sessionId: string, content: string): void => {
    const msg: UITextMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      type: 'text',
      content,
      timestamp: Date.now()
    }
    set(s => ({
      sessions: {
        ...s.sessions,
        [sessionId]: {
          ...s.sessions[sessionId],
          messages: [...s.sessions[sessionId].messages, msg]
        }
      }
    }))
  },

  setProcessing: (sessionId: string, processing: boolean): void => {
    set(s => {
      if (!s.sessions[sessionId]) return s
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...s.sessions[sessionId], isProcessing: processing }
        }
      }
    })
  },

  setError: (sessionId: string, error: string | null): void => {
    set(s => {
      if (!s.sessions[sessionId]) return s
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...s.sessions[sessionId], error }
        }
      }
    })
  },

  setSelectedModel: (sessionId: string, model: string | null): void => {
    set(s => {
      if (!s.sessions[sessionId]) return s
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...s.sessions[sessionId], selectedModel: model }
        }
      }
    })
  },

  renameSession: (sessionId: string, name: string): void => {
    set(s => {
      if (!s.sessions[sessionId]) return s
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...s.sessions[sessionId], name }
        }
      }
    })
  },

  getSessionsForProject: (projectPath: string): SessionState[] => {
    const state = get()
    return Object.values(state.sessions)
      .filter(s => s.projectPath === projectPath)
      .sort((a, b) => a.createdAt - b.createdAt)
  }
}))
