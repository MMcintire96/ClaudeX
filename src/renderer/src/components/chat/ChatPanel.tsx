import React from 'react'
import MessageList from './MessageList'
import InputBar from './InputBar'
import { useSessionStore } from '../../stores/sessionStore'

interface ChatPanelProps {
  sessionId: string | null
}

export default function ChatPanel({ sessionId }: ChatPanelProps) {
  const error = useSessionStore(s =>
    sessionId ? s.sessions[sessionId]?.error ?? null : null
  )

  return (
    <div className="chat-panel">
      {error && (
        <div className="error-banner">
          {error}
          <button
            className="btn-dismiss"
            onClick={() => {
              if (sessionId) {
                useSessionStore.getState().setError(sessionId, null)
              }
            }}
          >
            Dismiss
          </button>
        </div>
      )}
      <MessageList sessionId={sessionId} />
      <InputBar sessionId={sessionId} />
    </div>
  )
}
