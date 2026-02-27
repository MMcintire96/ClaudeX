import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useSessionStore, type UIToolUseMessage } from '../../stores/sessionStore'
import { playNotificationSound } from '../../lib/notificationSound'

interface Props {
  message: UIToolUseMessage
  sessionId: string
  answered?: boolean
}

/**
 * Renders ExitPlanMode tool calls with Approve / Give Feedback / Reject buttons.
 * Sends the user's response via the SDK agent API (agent.send) to resume the session.
 */
export default function PlanModeBlock({ message, sessionId, answered: alreadyAnswered }: Props) {
  const [answered, setAnswered] = useState(alreadyAnswered || false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')

  const resumeAgent = useCallback(async (response: string) => {
    useSessionStore.getState().setProcessing(sessionId, true)
    await window.api.agent.send(sessionId, response)
  }, [sessionId])

  const handleApprove = useCallback(async () => {
    if (answered) return
    setAnswered(true)
    await resumeAgent('yes')
  }, [answered, resumeAgent])

  const handleReject = useCallback(async () => {
    if (answered) return
    setAnswered(true)
    await resumeAgent('no')
  }, [answered, resumeAgent])

  const handleSendFeedback = useCallback(async () => {
    if (answered || !feedbackText.trim()) return
    setAnswered(true)
    await resumeAgent(feedbackText.trim())
  }, [answered, feedbackText, resumeAgent])

  // Extract any allowed prompts info from the tool input
  const allowedPrompts = message.input?.allowedPrompts as Array<{ tool: string; prompt: string }> | undefined

  const needsInput = !answered
  const notifiedRef = useRef(false)
  useEffect(() => {
    if (needsInput && !notifiedRef.current) {
      notifiedRef.current = true
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Claude needs your input', {
          body: 'A plan is ready for your review',
          silent: false
        })
      } else if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission()
      }
      playNotificationSound()
    }
  }, [needsInput])

  return (
    <div className={`plan-mode-block${needsInput ? ' needs-input' : ''}`}>
      {needsInput && <div className="needs-input-indicator" />}
      <div className="plan-mode-header">
        <svg className="plan-mode-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
        <span className="plan-mode-title">Plan Ready for Review</span>
      </div>

      {allowedPrompts && allowedPrompts.length > 0 && (
        <div className="plan-mode-permissions">
          <span className="plan-mode-permissions-label">Requested permissions:</span>
          {allowedPrompts.map((p, i) => (
            <span key={i} className="plan-mode-permission-tag">{p.prompt}</span>
          ))}
        </div>
      )}

      {!answered && !showFeedback && (
        <div className="plan-mode-actions">
          <button className="btn btn-sm btn-deny" onClick={handleReject}>
            Reject
          </button>
          <button className="btn btn-sm btn-feedback" onClick={() => setShowFeedback(true)}>
            Give Feedback
          </button>
          <button className="btn btn-sm btn-allow" onClick={handleApprove}>
            Approve Plan
          </button>
        </div>
      )}

      {!answered && showFeedback && (
        <div className="plan-mode-feedback">
          <textarea
            className="plan-mode-feedback-input"
            placeholder="Describe changes you'd like to the plan..."
            value={feedbackText}
            onChange={e => setFeedbackText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSendFeedback()
              }
              if (e.key === 'Escape') {
                setShowFeedback(false)
              }
            }}
            rows={3}
            autoFocus
          />
          <div className="plan-mode-feedback-actions">
            <button className="btn btn-sm btn-deny" onClick={() => setShowFeedback(false)}>
              Cancel
            </button>
            <button
              className="btn btn-sm btn-allow"
              onClick={handleSendFeedback}
              disabled={!feedbackText.trim()}
            >
              Send Feedback
            </button>
          </div>
        </div>
      )}

      {answered && (
        <div className="plan-mode-answered">
          {feedbackText ? 'Feedback sent' : 'Responded'}
        </div>
      )}
    </div>
  )
}
