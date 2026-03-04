import { useState, useRef, useCallback, useEffect } from 'react'

export interface HistoryPreviewEntry {
  name: string
  createdAt: number
  endedAt: number
}

export interface PreviewTarget {
  sessionId: string | null
  historyEntry: HistoryPreviewEntry | null
  triggerRect: DOMRect
}

export interface UseSessionPreviewReturn {
  previewTarget: PreviewTarget | null
  onSessionMouseEnter: (
    e: React.MouseEvent,
    sessionId: string | null,
    historyEntry: HistoryPreviewEntry | null
  ) => void
  onSessionMouseLeave: () => void
  onPreviewMouseEnter: () => void
  onPreviewMouseLeave: () => void
  dismiss: () => void
}

export function useSessionPreview(): UseSessionPreviewReturn {
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(null)
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback(() => {
    if (showTimerRef.current) { clearTimeout(showTimerRef.current); showTimerRef.current = null }
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null }
  }, [])

  const dismiss = useCallback(() => {
    clearTimers()
    setPreviewTarget(null)
  }, [clearTimers])

  const onSessionMouseEnter = useCallback((
    e: React.MouseEvent,
    sessionId: string | null,
    historyEntry: HistoryPreviewEntry | null
  ) => {
    clearTimers()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    showTimerRef.current = setTimeout(() => {
      setPreviewTarget({ sessionId, historyEntry, triggerRect: rect })
    }, 300)
  }, [clearTimers])

  const onSessionMouseLeave = useCallback(() => {
    if (showTimerRef.current) { clearTimeout(showTimerRef.current); showTimerRef.current = null }
    hideTimerRef.current = setTimeout(() => setPreviewTarget(null), 150)
  }, [])

  const onPreviewMouseEnter = useCallback(() => {
    if (hideTimerRef.current) { clearTimeout(hideTimerRef.current); hideTimerRef.current = null }
  }, [])

  const onPreviewMouseLeave = useCallback(() => {
    hideTimerRef.current = setTimeout(() => setPreviewTarget(null), 150)
  }, [])

  // Dismiss on drag or resize
  useEffect(() => {
    const handleDismiss = () => { clearTimers(); setPreviewTarget(null) }
    window.addEventListener('dragstart', handleDismiss)
    window.addEventListener('resize', handleDismiss)
    return () => {
      window.removeEventListener('dragstart', handleDismiss)
      window.removeEventListener('resize', handleDismiss)
    }
  }, [clearTimers])

  // Cleanup timers on unmount
  useEffect(() => {
    return () => clearTimers()
  }, [clearTimers])

  return { previewTarget, onSessionMouseEnter, onSessionMouseLeave, onPreviewMouseEnter, onPreviewMouseLeave, dismiss }
}
