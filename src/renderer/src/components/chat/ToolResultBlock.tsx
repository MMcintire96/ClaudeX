import React, { useState, useMemo } from 'react'
import type { UIToolResultMessage } from '../../stores/sessionStore'

interface Props {
  message: UIToolResultMessage
}

const MAX_LINES = 500

export default function ToolResultBlock({ message }: Props) {
  const [showAll, setShowAll] = useState(false)

  const hasImages = message.imageData && message.imageData.length > 0
  const hasText = message.content.length > 0

  const { displayContent, isTruncated, totalLines } = useMemo(() => {
    if (!hasText) return { displayContent: '', isTruncated: false, totalLines: 0 }
    const lines = message.content.split('\n')
    const total = lines.length
    if (total <= MAX_LINES || showAll) {
      return { displayContent: message.content, isTruncated: false, totalLines: total }
    }
    return {
      displayContent: lines.slice(0, MAX_LINES).join('\n'),
      isTruncated: true,
      totalLines: total
    }
  }, [message.content, showAll, hasText])

  return (
    <div className={`tool-result-block ${message.isError ? 'tool-result-error' : ''}`}>
      {hasImages && (
        <div className="tool-result-images">
          {message.imageData!.map((img, i) => (
            <img
              key={i}
              src={`data:${img.mimeType};base64,${img.data}`}
              alt="Screenshot"
              className="tool-result-image"
            />
          ))}
        </div>
      )}
      {hasText && (
        <div className="tool-result-content">
          <pre>{displayContent}</pre>
        </div>
      )}
      {isTruncated && (
        <button className="btn btn-sm" onClick={() => setShowAll(true)}>
          Show all ({totalLines} lines)
        </button>
      )}
    </div>
  )
}
