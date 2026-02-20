import React, { useState, useCallback } from 'react'
import type { UIToolUseMessage } from '../../stores/sessionStore'

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
  terminalId: string
  answered?: boolean
}

export default function AskUserQuestionBlock({ message, terminalId, answered: alreadyAnswered }: Props) {
  const [answered, setAnswered] = useState(alreadyAnswered || false)
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set())
  const [otherText, setOtherText] = useState('')
  const [showOther, setShowOther] = useState(false)

  const questions: Question[] = message.input?.questions as Question[] || []

  const handleSelect = useCallback(async (questionIdx: number, optionIdx: number, question: Question) => {
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

    // Single select — send the answer immediately
    setAnswered(true)
    // Claude Code TUI expects the option number (1-indexed)
    const answer = String(optionIdx + 1)
    await window.api.terminal.write(terminalId, answer)
    await new Promise(r => setTimeout(r, 50))
    await window.api.terminal.write(terminalId, '\r')
  }, [answered, terminalId])

  const handleSubmitMulti = useCallback(async (question: Question) => {
    if (answered || selectedIndices.size === 0) return
    setAnswered(true)
    // Send each selected option number separated by commas
    const answer = Array.from(selectedIndices).sort().map(i => i + 1).join(',')
    await window.api.terminal.write(terminalId, answer)
    await new Promise(r => setTimeout(r, 50))
    await window.api.terminal.write(terminalId, '\r')
  }, [answered, selectedIndices, terminalId])

  const handleOther = useCallback(async () => {
    if (answered || !otherText.trim()) return
    setAnswered(true)
    // Select "Other" option (last option + 1) and type the text
    const question = questions[0]
    const otherIdx = question ? question.options.length + 1 : 1
    await window.api.terminal.write(terminalId, String(otherIdx))
    await new Promise(r => setTimeout(r, 50))
    await window.api.terminal.write(terminalId, '\r')
    await new Promise(r => setTimeout(r, 200))
    await window.api.terminal.write(terminalId, otherText.trim())
    await new Promise(r => setTimeout(r, 50))
    await window.api.terminal.write(terminalId, '\r')
  }, [answered, otherText, questions, terminalId])

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
