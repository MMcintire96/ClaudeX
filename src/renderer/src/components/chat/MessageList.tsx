import React, { useEffect, useRef } from 'react'
import { useSessionStore, UIMessage } from '../../stores/sessionStore'
import MessageBubble from './MessageBubble'
import ToolUseBlock from './ToolUseBlock'
import ToolResultBlock from './ToolResultBlock'
import StreamingText from './StreamingText'

const EMPTY_MESSAGES: UIMessage[] = []

interface MessageListProps {
  sessionId: string | null
}

export default function MessageList({ sessionId }: MessageListProps) {
  const messages = useSessionStore(s =>
    sessionId ? s.sessions[sessionId]?.messages ?? EMPTY_MESSAGES : EMPTY_MESSAGES
  )
  const isStreaming = useSessionStore(s =>
    sessionId ? s.sessions[sessionId]?.isStreaming ?? false : false
  )
  const streamingText = useSessionStore(s =>
    sessionId ? s.sessions[sessionId]?.streamingText ?? '' : ''
  )
  const containerRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom on new messages or streaming
  useEffect(() => {
    const el = containerRef.current
    if (el) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages, isStreaming, streamingText])

  function renderMessage(msg: UIMessage) {
    switch (msg.type) {
      case 'text':
        return <MessageBubble key={msg.id} message={msg} />
      case 'tool_use':
        return <ToolUseBlock key={msg.id} message={msg} />
      case 'tool_result':
        return <ToolResultBlock key={msg.id} message={msg} />
      default:
        return null
    }
  }

  const hasMessages = messages.length > 0 || isStreaming

  return (
    <div className="message-list" ref={containerRef}>
      {!hasMessages && (
        <div className="empty-state">
          <div className="empty-state-icon">&#9672;</div>
          <h2>Let's build</h2>
          <div className="empty-state-model-badge">
            &#9672; Claude
          </div>
        </div>
      )}
      {hasMessages && (
        <div className="messages-container">
          {messages.map(renderMessage)}
          {isStreaming && <StreamingText sessionId={sessionId} />}
        </div>
      )}
    </div>
  )
}
