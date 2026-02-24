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
  const [submitted, setSubmitted] = useState(alreadyAnswered || false)
  // Per-question answers: index -> selected label(s) or custom text
  const [answers, setAnswers] = useState<Record<number, string>>({})
  // Per-question multi-select state
  const [multiSelections, setMultiSelections] = useState<Record<number, Set<number>>>({})
  // Per-question "other" mode
  const [otherActive, setOtherActive] = useState<Record<number, boolean>>({})
  const [otherTexts, setOtherTexts] = useState<Record<number, string>>({})

  const questions: Question[] = message.input?.questions as Question[] || []

  const resumeAgent = useCallback(async (response: string) => {
    useSessionStore.getState().setProcessing(sessionId, true)
    await window.api.agent.send(sessionId, response)
  }, [sessionId])

  const handleSelect = useCallback((qi: number, optionIdx: number, question: Question) => {
    if (submitted) return

    if (question.multiSelect) {
      setMultiSelections(prev => {
        const current = new Set(prev[qi] || [])
        if (current.has(optionIdx)) current.delete(optionIdx)
        else current.add(optionIdx)
        return { ...prev, [qi]: current }
      })
      return
    }

    // Single select — record the answer for this question
    const selected = question.options[optionIdx]
    setAnswers(prev => ({ ...prev, [qi]: selected?.label ?? String(optionIdx) }))
  }, [submitted])

  const handleConfirmMulti = useCallback((qi: number, question: Question) => {
    const selected = multiSelections[qi]
    if (!selected || selected.size === 0) return
    const sorted = Array.from(selected).sort((a, b) => a - b)
    const labels = sorted.map(idx => question.options[idx]?.label).filter(Boolean)
    setAnswers(prev => ({ ...prev, [qi]: labels.join(', ') }))
  }, [multiSelections])

  const handleOther = useCallback((qi: number) => {
    const text = (otherTexts[qi] || '').trim()
    if (!text) return
    setAnswers(prev => ({ ...prev, [qi]: text }))
    setOtherActive(prev => ({ ...prev, [qi]: false }))
  }, [otherTexts])

  const handleSubmitAll = useCallback(async () => {
    if (submitted) return
    setSubmitted(true)

    if (questions.length === 1) {
      await resumeAgent(answers[0] || '')
    } else {
      // Format: "Q1: answer\nQ2: answer\n..."
      const parts = questions.map((q, qi) => {
        const header = q.header || `Q${qi + 1}`
        return `${header}: ${answers[qi] || '(no answer)'}`
      })
      await resumeAgent(parts.join('\n'))
    }
  }, [submitted, questions, answers, resumeAgent])

  // For single-question blocks, auto-submit when answered
  const allAnswered = questions.length > 0 && questions.every((_, qi) => qi in answers)

  // Auto-submit for single-question single-select
  const handleSelectAndMaybeSubmit = useCallback(async (qi: number, optionIdx: number, question: Question) => {
    if (submitted) return

    if (question.multiSelect) {
      handleSelect(qi, optionIdx, question)
      return
    }

    // Single select
    const selected = question.options[optionIdx]
    const label = selected?.label ?? String(optionIdx)
    const newAnswers = { ...answers, [qi]: label }
    setAnswers(newAnswers)

    // If single question, auto-submit immediately
    if (questions.length === 1) {
      setSubmitted(true)
      await resumeAgent(label)
    }
  }, [submitted, answers, questions, handleSelect, resumeAgent])

  const handleOtherAndMaybeSubmit = useCallback(async (qi: number) => {
    const text = (otherTexts[qi] || '').trim()
    if (!text || submitted) return

    setAnswers(prev => ({ ...prev, [qi]: text }))

    // If single question, auto-submit immediately
    if (questions.length === 1) {
      setSubmitted(true)
      await resumeAgent(text)
    }
  }, [otherTexts, submitted, questions, resumeAgent])

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

  const isQuestionAnswered = (qi: number) => qi in answers
  const isMultiQuestion = questions.length > 1

  return (
    <div className="ask-user-block">
      {questions.map((q, qi) => {
        const qAnswered = isQuestionAnswered(qi)
        const qDisabled = submitted
        const qMultiSel = multiSelections[qi] || new Set()

        return (
          <div key={qi} className={`ask-user-question${qAnswered && !submitted ? ' ask-user-question-answered' : ''}`}>
            {q.header && <div className="ask-user-header">{q.header}</div>}
            <div className="ask-user-text">{q.question}</div>
            <div className="ask-user-options">
              {q.options.map((opt, oi) => {
                const isSelected = q.multiSelect
                  ? qMultiSel.has(oi)
                  : answers[qi] === opt.label
                return (
                  <button
                    key={oi}
                    className={`ask-user-option ${isSelected ? 'selected' : ''} ${qDisabled ? 'disabled' : ''}`}
                    onClick={() => handleSelectAndMaybeSubmit(qi, oi, q)}
                    disabled={qDisabled}
                  >
                    <span className="ask-user-option-label">{opt.label}</span>
                    {opt.description && (
                      <span className="ask-user-option-desc">{opt.description}</span>
                    )}
                  </button>
                )
              })}
              {/* Other option */}
              {!qDisabled && !qAnswered && !otherActive[qi] && (
                <button
                  className="ask-user-option ask-user-option-other"
                  onClick={() => setOtherActive(prev => ({ ...prev, [qi]: true }))}
                >
                  <span className="ask-user-option-label">Other...</span>
                </button>
              )}
            </div>
            {otherActive[qi] && (
              <div className={`ask-user-other${qAnswered ? ' ask-user-other-answered' : ''}`}>
                <input
                  type="text"
                  className={`ask-user-other-input${qAnswered ? ' selected' : ''}`}
                  placeholder="Type your answer..."
                  value={otherTexts[qi] || ''}
                  onChange={e => setOtherTexts(prev => ({ ...prev, [qi]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleOtherAndMaybeSubmit(qi) }}
                  readOnly={qAnswered || qDisabled}
                  autoFocus={!qAnswered}
                />
                {!qAnswered && !qDisabled && (
                  <button
                    className="btn btn-sm btn-primary"
                    onClick={() => handleOtherAndMaybeSubmit(qi)}
                    disabled={!(otherTexts[qi] || '').trim()}
                  >
                    Send
                  </button>
                )}
              </div>
            )}
            {q.multiSelect && !qDisabled && !qAnswered && qMultiSel.size > 0 && (
              <button
                className="btn btn-sm btn-primary ask-user-submit"
                onClick={() => handleConfirmMulti(qi, q)}
              >
                Confirm ({qMultiSel.size} selected)
              </button>
            )}
            {qAnswered && (
              <div className="ask-user-answered">{answers[qi]}</div>
            )}
          </div>
        )
      })}

      {/* Submit all button for multi-question blocks */}
      {isMultiQuestion && !submitted && (
        <button
          className="btn btn-primary ask-user-submit-all"
          onClick={handleSubmitAll}
          disabled={!allAnswered}
        >
          {allAnswered ? 'Submit answers' : `Answer all questions (${Object.keys(answers).length}/${questions.length})`}
        </button>
      )}
      {submitted && (
        <div className="ask-user-answered">Submitted</div>
      )}
    </div>
  )
}
