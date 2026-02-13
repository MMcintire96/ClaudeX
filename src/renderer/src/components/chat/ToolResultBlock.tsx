import React, { useState, useMemo } from 'react'
import type { UIToolResultMessage } from '../../stores/sessionStore'

interface Props {
  message: UIToolResultMessage
}

const MAX_LINES = 500

export default function ToolResultBlock({ message }: Props) {
  const [showAll, setShowAll] = useState(false)

  const { displayContent, isTruncated, totalLines } = useMemo(() => {
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
  }, [message.content, showAll])

  return (
    <div className={`tool-result-block ${message.isError ? 'tool-result-error' : ''}`}>
      <div className="tool-result-content">
        <pre>{displayContent}</pre>
      </div>
      {isTruncated && (
        <button className="btn btn-sm" onClick={() => setShowAll(true)}>
          Show all ({totalLines} lines)
        </button>
      )}
    </div>
  )
}
