import React, { useState, useEffect, useRef } from 'react'

interface ThinkingBlockProps {
  text: string
  isStreaming: boolean
  isComplete: boolean
  defaultExpanded?: boolean
}

export default function ThinkingBlock({ text, isStreaming, isComplete, defaultExpanded }: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? isStreaming)
  const contentRef = useRef<HTMLDivElement>(null)
  const wasStreamingRef = useRef(isStreaming)

  // Auto-collapse when thinking completes
  useEffect(() => {
    if (wasStreamingRef.current && isComplete) {
      const timer = setTimeout(() => setExpanded(false), 400)
      return () => clearTimeout(timer)
    }
    wasStreamingRef.current = isStreaming
  }, [isComplete, isStreaming])

  // Auto-scroll content to bottom while streaming
  useEffect(() => {
    if (expanded && isStreaming && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight
    }
  }, [text, expanded, isStreaming])

  const wordCount = text ? text.split(/\s+/).filter(Boolean).length : 0
  const summary = wordCount > 0 ? `Thought for ${wordCount} words` : 'Thinking...'

  return (
    <div className={`thinking-block${isStreaming ? ' thinking-block-streaming' : ''}`}>
      <button
        className="thinking-block-header"
        onClick={() => setExpanded(!expanded)}
      >
        {isStreaming ? (
          <div className="thinking-block-dots">
            <span className="thinking-dot" />
            <span className="thinking-dot" />
            <span className="thinking-dot" />
          </div>
        ) : (
          <svg className="thinking-block-icon" width="14" height="14" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>
          </svg>
        )}
        <span className="thinking-block-summary">
          {isStreaming ? 'Thinking...' : summary}
        </span>
        <span className="thinking-block-chevron">{expanded ? '\u25BE' : '\u25B8'}</span>
      </button>
      {expanded && (
        <div className="thinking-block-body" ref={contentRef}>
          <pre className="thinking-block-text">{text}</pre>
          {isStreaming && <span className="cursor-blink" />}
        </div>
      )}
    </div>
  )
}
