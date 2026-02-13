import { useState, useEffect, useRef } from 'react'
import { useSessionStore } from '../stores/sessionStore'

/**
 * Batches streaming text updates via requestAnimationFrame for performance.
 * Returns the current displayed text at ~60fps.
 */
export function useStreamingMessage(sessionId: string | null): string {
  const streamingText = useSessionStore(s =>
    sessionId ? s.sessions[sessionId]?.streamingText ?? '' : ''
  )
  const [displayText, setDisplayText] = useState('')
  const rafRef = useRef<number>(0)
  const latestText = useRef(streamingText)

  latestText.current = streamingText

  useEffect(() => {
    const update = () => {
      setDisplayText(latestText.current)
      rafRef.current = requestAnimationFrame(update)
    }
    rafRef.current = requestAnimationFrame(update)
    return () => cancelAnimationFrame(rafRef.current)
  }, [])

  return displayText
}
