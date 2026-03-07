import React, { useState } from 'react'
import type { UITextMessage } from '../../stores/sessionStore'
import MarkdownRenderer from '../common/MarkdownRenderer'

interface Props {
  message: UITextMessage
  searchQuery?: string
  projectPath?: string
  modelLabel?: string
}

/** Highlight search matches within plain text */
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query) return <p style={{ whiteSpace: 'pre-wrap' }}>{text}</p>
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
  return <p style={{ whiteSpace: 'pre-wrap' }}>{parts}</p>
}

/** Strip @/path/to/image.png references from display text */
function stripImageRefs(text: string, images: Array<{ path: string }>): string {
  let result = text
  for (const img of images) {
    result = result.replace('@' + img.path, '')
  }
  return result.trim()
}

export default function MessageBubble({ message, searchQuery = '', projectPath, modelLabel }: Props) {
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)
  const hasImages = message.role === 'user' && message.images && message.images.length > 0
  const displayText = hasImages ? stripImageRefs(message.content, message.images!) : message.content

  return (
    <div className={`message-bubble ${message.role}`}>
      {message.role === 'assistant' && <div className="message-role">{modelLabel ?? 'Claude'}</div>}
      <div className="message-content">
        {hasImages && (
          <div className="user-image-cards">
            {message.images!.map((img, i) => (
              <div key={i} className="user-image-card" onClick={() => setLightboxSrc(img.previewUrl)}>
                <img
                  src={img.previewUrl}
                  alt={img.path.split('/').pop() || 'Image'}
                  className="user-image-card-img"
                />
              </div>
            ))}
          </div>
        )}
        {message.role === 'assistant' ? (
          <MarkdownRenderer content={message.content} projectPath={projectPath} />
        ) : displayText ? (
          <HighlightedText text={displayText} query={searchQuery} />
        ) : null}
      </div>
      {lightboxSrc && (
        <div className="image-lightbox-overlay" onClick={() => setLightboxSrc(null)}>
          <img
            src={lightboxSrc}
            className="image-lightbox-img"
            onClick={e => e.stopPropagation()}
            alt=""
          />
        </div>
      )}
    </div>
  )
}
