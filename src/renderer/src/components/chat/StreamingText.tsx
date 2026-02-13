import React from 'react'
import { useStreamingMessage } from '../../hooks/useStreamingMessage'
import MarkdownRenderer from '../common/MarkdownRenderer'

interface StreamingTextProps {
  sessionId: string | null
}

export default function StreamingText({ sessionId }: StreamingTextProps) {
  const text = useStreamingMessage(sessionId)

  if (!text) return null

  return (
    <div className="message-bubble assistant streaming">
      <MarkdownRenderer content={text} />
      <span className="cursor-blink" />
    </div>
  )
}
