import React, { useState, useCallback } from 'react'
import { useSessionStore, type UIToolUseMessage } from '../../stores/sessionStore'

interface Option {
  label: string
  description?: string
}

interface Question {
  question: string
  header?: string
  options: Option[]
  multiSelect?: boolean
}

interface Props {
  message: UIToolUseMessage
  sessionId: string
  answered?: boolean
}

export default function AskUserQuestionBlock({ message, sessionId, answered: alreadyAnswered }: Props) {
  const [answered, setAnswered] = useState(alreadyAnswered || false)
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const [otherText, setOtherText] = useState('')
  const [showOther, setShowOther] = useState(false)

  const questions: Question[] = message.input?.questions as Question[] || []

  const resumeAgent = useCallback(async (response: string) => {
    useSessionStore.getState().setProcessing(sessionId, true)
    await window.api.agent.send(sessionId, response)
  }, [sessionId])

  const handleSelect = useCallback(async (_questionIdx: number, optionIdx: number, question: Question) => {
    if (answered) return

    if (question.multiSelect) {
      setSelectedIndices(prev => {
        const next = new Set(prev)
        if (next.has(optionIdx)) next.delete(optionIdx)
        else next.add(optionIdx)
        return next
      })
      return
    }

    // Single select — send the selected option's label as the response
    setAnswered(true)
    const selected = question.options[optionIdx]
    await resumeAgent(selected?.label ?? String(optionIdx))
  }, [answered, resumeAgent])

  const handleSubmitMulti = useCallback(async (question: Question) => {
    if (answered || selectedIndices.size === 0) return
    setAnswered(true)
    // Send all selected option labels joined together
    const sorted = Array.from(selectedIndices).sort((a, b) => a - b)
    const labels = sorted.map(idx => question.options[idx]?.label).filter(Boolean)
    await resumeAgent(labels.join(', '))
  }, [answered, selectedIndices, resumeAgent])

  const handleOther = useCallback(async () => {
    if (answered || !otherText.trim()) return
    setAnswered(true)
    await resumeAgent(otherText.trim())
  }, [answered, otherText, resumeAgent])

  if (questions.length === 0) {
    return (
      <div className="tool-use-block">
        <div className="tool-use-header">
          <span className="tool-icon">&#9881;</span>
          <span className="tool-name">AskUserQuestion</span>
        </div>
      </div>
    )
  }

  return (
    <div className="ask-user-block">
      {questions.map((q, qi) => (
        <div key={qi} className="ask-user-question">
          {q.header && <div className="ask-user-header">{q.header}</div>}
          <div className="ask-user-text">{q.question}</div>
          <div className="ask-user-options">
            {q.options.map((opt, oi) => {
              const isSelected = selectedIndices.has(oi)
              return (
                <button
                  key={oi}
                  className={`ask-user-option ${isSelected ? 'selected' : ''} ${answered ? 'disabled' : ''}`}
                  onClick={() => handleSelect(qi, oi, q)}
                  disabled={answered}
                >
                  <span className="ask-user-option-label">{opt.label}</span>
                  {opt.description && (
                    <span className="ask-user-option-desc">{opt.description}</span>
                  )}
                </button>
              )
            })}
            {/* Other option */}
            {!answered && !showOther && (
              <button
                className="ask-user-option ask-user-option-other"
                onClick={() => setShowOther(true)}
              >
                <span className="ask-user-option-label">Other...</span>
              </button>
            )}
          </div>
          {showOther && !answered && (
            <div className="ask-user-other">
              <input
                type="text"
                className="ask-user-other-input"
                placeholder="Type your answer..."
                value={otherText}
                onChange={e => setOtherText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleOther() }}
                autoFocus
              />
              <button
                className="btn btn-sm btn-primary"
                onClick={handleOther}
                disabled={!otherText.trim()}
              >
                Send
              </button>
            </div>
          )}
          {q.multiSelect && !answered && selectedIndices.size > 0 && (
            <button
              className="btn btn-sm btn-primary ask-user-submit"
              onClick={() => handleSubmitMulti(q)}
            >
              Confirm ({selectedIndices.size} selected)
            </button>
          )}
          {answered && (
            <div className="ask-user-answered">Answered</div>
          )}
        </div>
      ))}
    </div>
  )
}
