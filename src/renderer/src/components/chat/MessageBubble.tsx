import React from 'react'
import type { UITextMessage } from '../../stores/sessionStore'
import MarkdownRenderer from '../common/MarkdownRenderer'

interface Props {
  message: UITextMessage
}

export default function MessageBubble({ message }: Props) {
  return (
    <div className={`message-bubble ${message.role}`}>
      <div className="message-role">{message.role === 'user' ? 'You' : 'Claude'}</div>
      <div className="message-content">
        {message.role === 'assistant' ? (
          <MarkdownRenderer content={message.content} />
        ) : (
          <p>{message.content}</p>
        )}
      </div>
    </div>
  )
}
