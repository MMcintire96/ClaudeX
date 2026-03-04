import React, { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { useSessionStore, sessionNeedsInput, type UITextMessage } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import type { HistoryPreviewEntry } from '../../hooks/useSessionPreview'

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

interface SessionPreviewCardProps {
  sessionId: string | null
  historyEntry: HistoryPreviewEntry | null
  triggerRect: DOMRect
  onMouseEnter: () => void
  onMouseLeave: () => void
}

const CARD_WIDTH = 320
const CARD_GAP = 8
const CARD_MAX_HEIGHT = 400

export default function SessionPreviewCard({
  sessionId,
  historyEntry,
  triggerRect,
  onMouseEnter,
  onMouseLeave
}: SessionPreviewCardProps) {
  const sidebarWidth = useUIStore(s => s.sidebarWidth)
  // Subscribe to the live session from the store so we get real-time updates
  const session = useSessionStore(s => sessionId ? s.sessions[sessionId] ?? null : null)

  const previewMessages = useMemo(() => {
    if (!session) return []
    return session.messages
      .filter((m): m is UITextMessage => m.type === 'text')
      .slice(-5)
  }, [session])

  const style = useMemo(() => {
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight

    let left = sidebarWidth + CARD_GAP
    if (left + CARD_WIDTH > viewportW - CARD_GAP) {
      left = triggerRect.left - CARD_WIDTH - CARD_GAP
    }

    let top = triggerRect.top
    if (top + CARD_MAX_HEIGHT > viewportH - CARD_GAP) {
      top = viewportH - CARD_MAX_HEIGHT - CARD_GAP
    }
    top = Math.max(CARD_GAP, top)

    return { position: 'fixed' as const, left, top, width: CARD_WIDTH, zIndex: 999 }
  }, [triggerRect, sidebarWidth])

  const statusLabel = useMemo(() => {
    if (!session) return null
    const needsInput = sessionNeedsInput(session)
    if (needsInput) return { text: 'Needs input', className: 'needs-input' }
    if (session.isProcessing) return { text: 'Running', className: 'running' }
    return { text: 'Idle', className: 'idle' }
  }, [session])

  // History entry preview
  if (historyEntry) {
    return createPortal(
      <div
        className="session-preview-card"
        style={style}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className="session-preview-history">
          <div className="session-preview-name">
            {historyEntry.name.replace(/^[^\w\s]+\s*/, '') || historyEntry.name}
          </div>
          <div className="session-preview-history-time">
            Ended {timeAgo(historyEntry.endedAt)}
          </div>
          <div className="session-preview-history-hint">
            Click to resume
          </div>
        </div>
      </div>,
      document.body
    )
  }

  // Active session preview
  if (!session) return null

  const displayName = session.name || 'Session'
  const modelStr = session.model?.replace('claude-', '').split('-20')[0] || null

  return createPortal(
    <div
      className="session-preview-card"
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {/* Header */}
      <div className="session-preview-header">
        <span className="session-preview-name">{displayName}</span>
        {statusLabel && (
          <span className={`session-preview-status ${statusLabel.className}`}>
            {statusLabel.text}
          </span>
        )}
      </div>

      {/* Metadata */}
      {(modelStr || session.numTurns > 0) && (
        <div className="session-preview-meta">
          {modelStr && (
            <span className="session-preview-meta-item">{modelStr}</span>
          )}
          {session.numTurns > 0 && (
            <span className="session-preview-meta-item">
              {session.numTurns} {session.numTurns === 1 ? 'turn' : 'turns'}
            </span>
          )}
        </div>
      )}

      {/* Messages */}
      {previewMessages.length > 0 ? (
        <div className="session-preview-messages">
          {previewMessages.map(msg => (
            <div key={msg.id} className={`preview-message preview-message-${msg.role}`}>
              <span className="preview-message-role">
                {msg.role === 'user' ? 'You' : 'Claude'}
              </span>
              <span className="preview-message-text">
                {msg.content.slice(0, 200)}
              </span>
            </div>
          ))}
          {session.isStreaming && session.streamingText && (
            <div className="preview-message preview-message-assistant">
              <span className="preview-message-role">Claude</span>
              <span className="preview-message-text preview-streaming">
                {session.streamingText.slice(0, 200)}
              </span>
            </div>
          )}
        </div>
      ) : (
        <div className="session-preview-empty">
          {session.isProcessing ? 'Thinking...' : 'No messages yet'}
        </div>
      )}
    </div>,
    document.body
  )
}
