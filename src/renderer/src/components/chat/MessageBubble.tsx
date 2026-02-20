import React from 'react'
import type { UITextMessage } from '../../stores/sessionStore'
import MarkdownRenderer from '../common/MarkdownRenderer'

interface Props {
  message: UITextMessage
  searchQuery?: string
}

/** Highlight search matches within plain text */
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <p>{text}</p>
  const parts: React.ReactNode[] = []
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  let lastIndex = 0
  let idx = lower.indexOf(q, lastIndex)
  let key = 0
  while (idx !== -1) {
    if (idx > lastIndex) parts.push(text.slice(lastIndex, idx))
    parts.push(<mark key={key++} className="search-highlight">{text.slice(idx, idx + query.length)}</mark>)
    lastIndex = idx + query.length
    idx = lower.indexOf(q, lastIndex)
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex))
  return <p>{parts}</p>
}

export default function MessageBubble({ message, searchQuery = '' }: Props) {
  return (
    <div className={`message-bubble ${message.role}`}>
      <div className="message-role">{message.role === 'user' ? 'You' : 'Claude'}</div>
      <div className="message-content">
        {message.role === 'assistant' ? (
          <MarkdownRenderer content={message.content} />
        ) : (
          <HighlightedText text={message.content} query={searchQuery} />
        )}
      </div>
    </div>
  )
}
