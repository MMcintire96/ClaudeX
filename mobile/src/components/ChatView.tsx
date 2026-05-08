import { useEffect, useMemo, useRef } from 'react'
import { api } from '../api'
import { addUserMessage, getSlim, setProcessing, useSnapshot } from '../state/store'
import { sessionNeedsInput, UIMessage, UIToolUseMessage } from '@shared/sessionEvents'
import { MessageBubble } from './MessageBubble'
import { ChevronLeftIcon } from './Icons'
import { InputBar } from './InputBar'

interface Props {
  sessionId: string
  onBack: () => void
  /** When mounted inside the shell with the global app-bar, suppress the local chat header. */
  hideHeader?: boolean
}

export function ChatView({ sessionId, onBack, hideHeader }: Props): JSX.Element {
  // Resubscribe on every store update.
  useSnapshot(() => Date.now())
  const slim = getSlim(sessionId)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // Auto-scroll to bottom on new messages or streaming text.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [slim.messages.length, slim.streamingText])

  const needsInput = useMemo(() => sessionNeedsInput(slim), [slim])

  // For the "Approve" button: find the pending question/plan tool_use.
  const pendingTool: UIToolUseMessage | null = useMemo(() => {
    if (!needsInput) return null
    for (let i = slim.messages.length - 1; i >= 0; i--) {
      const m = slim.messages[i]
      if (m.type === 'tool_use') {
        const tu = m as UIToolUseMessage
        if (tu.toolName === 'AskUserQuestion' || tu.toolName === 'ExitPlanMode') return tu
      }
    }
    return null
  }, [slim.messages, needsInput])

  /** Inline answer for AskUserQuestion / ExitPlanMode option buttons — sends immediately. */
  const sendInline = async (answer: string): Promise<void> => {
    addUserMessage(sessionId, answer)
    setProcessing(sessionId, true)
    try { await api.send(sessionId, answer) } catch { /* surfaced by InputBar instead */ }
  }

  return (
    <div className="chat">
      {!hideHeader && (
        <header className="chat-header">
          <button className="icon-btn" onClick={onBack} aria-label="Back">
            <ChevronLeftIcon size={20} />
          </button>
          <div className="chat-title">{shortId(sessionId)}</div>
          {slim.isProcessing && <span className="badge streaming">running</span>}
        </header>
      )}
      <div className="messages" ref={scrollRef}>
        {slim.messages.map((m: UIMessage) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {slim.streamingText && (
          <MessageBubble
            message={{
              id: 'streaming',
              role: 'assistant',
              type: 'text',
              content: slim.streamingText,
              timestamp: Date.now()
            }}
            streaming
          />
        )}
        {pendingTool && (
          <PendingToolPrompt tool={pendingTool} onSend={(answer) => void sendInline(answer)} />
        )}
      </div>
      <InputBar sessionId={sessionId} />
    </div>
  )
}

function PendingToolPrompt({ tool, onSend }: { tool: UIToolUseMessage; onSend: (text: string) => void }): JSX.Element {
  if (tool.toolName === 'ExitPlanMode') {
    return (
      <div className="pending-tool">
        <div className="pending-label">Plan ready — approve?</div>
        <div className="pending-actions">
          <button className="btn-primary" onClick={() => onSend('approve')}>Approve plan</button>
          <button className="btn-secondary" onClick={() => onSend('reject')}>Reject</button>
        </div>
      </div>
    )
  }
  // AskUserQuestion: render the questions and any options.
  const questions = (tool.input?.questions as Array<{ question: string; options?: Array<{ label: string }> }>) ?? []
  return (
    <div className="pending-tool">
      <div className="pending-label">Question:</div>
      {questions.map((q, i) => (
        <div key={i} className="pending-q">
          <div className="pending-q-text">{q.question}</div>
          {q.options && (
            <div className="pending-options">
              {q.options.map((o, j) => (
                <button key={j} className="btn-secondary" onClick={() => onSend(o.label)}>{o.label}</button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function shortId(s: string): string {
  return s.length > 12 ? s.slice(0, 8) + '…' : s
}
