import React, { useState, useCallback } from 'react'
import type { UIToolUseMessage } from '../../stores/sessionStore'

interface Props {
  message: UIToolUseMessage
  terminalId: string
  answered?: boolean
}

/**
 * Renders ExitPlanMode tool calls with Approve / Give Feedback / Reject buttons.
 * Claude CLI's ExitPlanMode presents a plan for user approval — the terminal
 * expects Enter to approve, Esc to reject, or typed text for feedback.
 */
export default function PlanModeBlock({ message, terminalId, answered: alreadyAnswered }: Props) {
  const [answered, setAnswered] = useState(alreadyAnswered || false)
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')

  const handleApprove = useCallback(async () => {
    if (answered) return
    setAnswered(true)
    // Enter to approve the plan
    await window.api.terminal.write(terminalId, '\r')
  }, [answered, terminalId])

  const handleReject = useCallback(async () => {
    if (answered) return
    setAnswered(true)
    // Esc to reject the plan
    await window.api.terminal.write(terminalId, '\x1b')
  }, [answered, terminalId])

  const handleSendFeedback = useCallback(async () => {
    if (answered || !feedbackText.trim()) return
    setAnswered(true)
    // Type feedback text then Enter — Claude CLI reads it as user response
    const text = feedbackText.trim()
    if (text.includes('\n') || text.includes('\r')) {
      await window.api.terminal.write(terminalId, `\x1b[200~${text}\x1b[201~`)
      await new Promise(r => setTimeout(r, 50))
      await window.api.terminal.write(terminalId, '\r')
    } else {
      await window.api.terminal.write(terminalId, text)
      await new Promise(r => setTimeout(r, 50))
      await window.api.terminal.write(terminalId, '\r')
    }
  }, [answered, feedbackText, terminalId])

  // Extract any allowed prompts info from the tool input
  const allowedPrompts = message.input?.allowedPrompts as Array<{ tool: string; prompt: string }> | undefined

  return (
    <div className="plan-mode-block">
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
