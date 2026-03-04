import React, { useMemo, useState, useEffect, useCallback } from 'react'
import type { UIMessage, UITextMessage, UIToolUseMessage, UIToolResultMessage } from '../../stores/sessionStore'

interface KeyMoment {
  id: string
  msgIndex: number
  kind: 'user' | 'assistant' | 'error' | 'question' | 'todo'
  label: string
}

interface KeyMomentsRailProps {
  messages: UIMessage[]
  listRef: React.RefObject<HTMLDivElement | null>
  visibleCount: number
  setVisibleCount: React.Dispatch<React.SetStateAction<number>>
}

const MESSAGES_PER_PAGE = 50

export default function KeyMomentsRail({ messages, listRef, visibleCount, setVisibleCount }: KeyMomentsRailProps) {
  const [activeMomentId, setActiveMomentId] = useState<string | null>(null)

  const keyMoments = useMemo<KeyMoment[]>(() => {
    const moments: KeyMoment[] = []

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]

      if (msg.type === 'text') {
        const textMsg = msg as UITextMessage
        const content = textMsg.content
        const label = content.slice(0, 40) + (content.length > 40 ? '...' : '')
        moments.push({
          id: msg.id,
          msgIndex: i,
          kind: textMsg.role === 'user' ? 'user' : 'assistant',
          label
        })
        continue
      }

      if (msg.type === 'tool_result' && (msg as UIToolResultMessage).isError) {
        moments.push({
          id: msg.id,
          msgIndex: i,
          kind: 'error',
          label: 'Error'
        })
        continue
      }

      if (msg.type === 'tool_use') {
        const toolMsg = msg as UIToolUseMessage
        if (toolMsg.toolName === 'AskUserQuestion') {
          const questions = toolMsg.input?.questions as Array<{ question: string }> | undefined
          const text = questions?.[0]?.question || 'Question'
          moments.push({
            id: msg.id,
            msgIndex: i,
            kind: 'question',
            label: text.slice(0, 40) + (text.length > 40 ? '...' : '')
          })
        } else if (toolMsg.toolName === 'ExitPlanMode') {
          moments.push({
            id: msg.id,
            msgIndex: i,
            kind: 'question',
            label: 'Plan Review'
          })
        } else if (toolMsg.toolName === 'TodoWrite') {
          const todos = toolMsg.input?.todos as Array<{ content: string }> | undefined
          moments.push({
            id: msg.id,
            msgIndex: i,
            kind: 'todo',
            label: `Tasks (${todos?.length || 0})`
          })
        }
      }
    }

    return moments
  }, [messages])

  // Scroll spy: highlight the moment currently in view
  useEffect(() => {
    const scrollContainer = listRef.current
    if (!scrollContainer || keyMoments.length === 0) return

    const momentIds = new Set(keyMoments.map(m => m.id))

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)

        if (visible.length > 0) {
          const topId = visible[0].target.getAttribute('data-msg-id')
          if (topId && momentIds.has(topId)) {
            setActiveMomentId(topId)
          }
        }
      },
      {
        root: scrollContainer,
        rootMargin: '-10% 0px -70% 0px',
        threshold: 0
      }
    )

    keyMoments.forEach(m => {
      const el = scrollContainer.querySelector(`[data-msg-id="${m.id}"]`)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [keyMoments, listRef, visibleCount])

  const handleMomentClick = useCallback((moment: KeyMoment) => {
    const startIdx = Math.max(0, messages.length - visibleCount)
    if (moment.msgIndex < startIdx) {
      setVisibleCount(messages.length - moment.msgIndex + MESSAGES_PER_PAGE)
    }

    requestAnimationFrame(() => {
      const el = listRef.current?.querySelector(`[data-msg-id="${moment.id}"]`)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }
    })
  }, [messages.length, visibleCount, setVisibleCount, listRef])

  if (keyMoments.length === 0) return null

  return (
    <div className="key-moments-rail">
      <div className="key-moments-rail-header">Key Moments</div>
      {keyMoments.map(moment => (
        <button
          key={moment.id}
          className={`key-moment-item${activeMomentId === moment.id ? ' active' : ''}`}
          onClick={() => handleMomentClick(moment)}
          title={moment.label}
        >
          <span className={`key-moment-dot ${moment.kind}`} />
          <span className="key-moment-label">{moment.label}</span>
        </button>
      ))}
    </div>
  )
}
