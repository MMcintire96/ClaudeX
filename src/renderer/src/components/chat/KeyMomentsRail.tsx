import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react'
import type { UIMessage, UITextMessage, UIToolUseMessage, UIToolResultMessage } from '../../stores/sessionStore'

type MomentKind = 'user' | 'assistant' | 'error' | 'question' | 'todo' | 'edit' | 'bash'

interface KeyMoment {
  id: string
  msgIndex: number
  kind: MomentKind
  label: string
  icon?: string
}

/** A turn = one user message + all assistant/tool messages until the next user message */
interface Turn {
  userLabel: string
  userMoment: KeyMoment
  moments: KeyMoment[] // assistant-side moments within this turn
}

interface KeyMomentsRailProps {
  messages: UIMessage[]
  listRef: React.RefObject<HTMLDivElement | null>
  visibleCount: number
  setVisibleCount: React.Dispatch<React.SetStateAction<number>>
}

const MESSAGES_PER_PAGE = 50
const MIN_RAIL_WIDTH = 180
const MAX_RAIL_WIDTH = 500
const DEFAULT_RAIL_WIDTH = 240

function extractFilename(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || path
}

export default function KeyMomentsRail({ messages, listRef, visibleCount, setVisibleCount }: KeyMomentsRailProps) {
  const [activeMomentId, setActiveMomentId] = useState<string | null>(null)
  const [collapsedTurns, setCollapsedTurns] = useState<Set<number>>(new Set())
  const [railWidth, setRailWidth] = useState(DEFAULT_RAIL_WIDTH)
  const isResizing = useRef(false)

  // Build flat list of all moments, then group into turns
  const turns = useMemo<Turn[]>(() => {
    const allMoments: KeyMoment[] = []

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]

      // Text messages (user + assistant)
      if (msg.type === 'text') {
        const textMsg = msg as UITextMessage
        const content = textMsg.content.trim()
        if (!content) continue
        const label = content.slice(0, 50) + (content.length > 50 ? '...' : '')
        allMoments.push({
          id: msg.id,
          msgIndex: i,
          kind: textMsg.role === 'user' ? 'user' : 'assistant',
          label
        })
        continue
      }

      // Error tool results
      if (msg.type === 'tool_result' && (msg as UIToolResultMessage).isError) {
        allMoments.push({
          id: msg.id,
          msgIndex: i,
          kind: 'error',
          label: 'Error'
        })
        continue
      }

      // Tool use messages
      if (msg.type === 'tool_use') {
        const toolMsg = msg as UIToolUseMessage

        if (toolMsg.toolName === 'AskUserQuestion') {
          const questions = toolMsg.input?.questions as Array<{ question: string }> | undefined
          const text = questions?.[0]?.question || 'Question'
          allMoments.push({
            id: msg.id,
            msgIndex: i,
            kind: 'question',
            label: text.slice(0, 50) + (text.length > 50 ? '...' : '')
          })
        } else if (toolMsg.toolName === 'ExitPlanMode') {
          allMoments.push({
            id: msg.id,
            msgIndex: i,
            kind: 'question',
            label: 'Plan Review'
          })
        } else if (toolMsg.toolName === 'TodoWrite') {
          const todos = toolMsg.input?.todos as Array<{ content: string }> | undefined
          allMoments.push({
            id: msg.id,
            msgIndex: i,
            kind: 'todo',
            label: `Tasks (${todos?.length || 0})`
          })
        } else if (toolMsg.toolName === 'Edit') {
          const filePath = toolMsg.input?.file_path as string | undefined
          allMoments.push({
            id: msg.id,
            msgIndex: i,
            kind: 'edit',
            label: filePath ? extractFilename(filePath) : 'Edit'
          })
        } else if (toolMsg.toolName === 'Write') {
          const filePath = toolMsg.input?.file_path as string | undefined
          allMoments.push({
            id: msg.id,
            msgIndex: i,
            kind: 'edit',
            label: filePath ? extractFilename(filePath) : 'Write'
          })
        } else if (toolMsg.toolName === 'Bash') {
          const cmd = toolMsg.input?.command as string | undefined
          if (cmd) {
            const label = cmd.slice(0, 40) + (cmd.length > 40 ? '...' : '')
            allMoments.push({
              id: msg.id,
              msgIndex: i,
              kind: 'bash',
              label
            })
          }
        }
      }
    }

    // Group moments into turns (a turn starts with a user moment)
    const result: Turn[] = []
    let currentTurn: Turn | null = null

    for (const moment of allMoments) {
      if (moment.kind === 'user') {
        // Start new turn
        currentTurn = {
          userLabel: moment.label,
          userMoment: moment,
          moments: []
        }
        result.push(currentTurn)
      } else if (currentTurn) {
        currentTurn.moments.push(moment)
      } else {
        // Moments before any user message — create a synthetic turn
        currentTurn = {
          userLabel: 'Start',
          userMoment: moment,
          moments: []
        }
        result.push(currentTurn)
      }
    }

    return result
  }, [messages])

  // Flat list of all moment IDs for the intersection observer
  const allMomentIds = useMemo(() => {
    const ids: KeyMoment[] = []
    for (const turn of turns) {
      ids.push(turn.userMoment)
      ids.push(...turn.moments)
    }
    return ids
  }, [turns])

  // Scroll spy: highlight the moment currently in view
  useEffect(() => {
    const scrollContainer = listRef.current
    if (!scrollContainer || allMomentIds.length === 0) return

    const momentIdSet = new Set(allMomentIds.map(m => m.id))

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter(e => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)

        if (visible.length > 0) {
          const topId = visible[0].target.getAttribute('data-msg-id')
          if (topId && momentIdSet.has(topId)) {
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

    allMomentIds.forEach(m => {
      const el = scrollContainer.querySelector(`[data-msg-id="${m.id}"]`)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [allMomentIds, listRef, visibleCount])

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

  const toggleTurn = useCallback((turnIdx: number) => {
    setCollapsedTurns(prev => {
      const next = new Set(prev)
      if (next.has(turnIdx)) next.delete(turnIdx)
      else next.add(turnIdx)
      return next
    })
  }, [])

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    isResizing.current = true
    const startX = e.clientX
    const startWidth = railWidth

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return
      // Dragging left = increasing width (rail is on the right)
      const delta = startX - ev.clientX
      const newWidth = Math.min(MAX_RAIL_WIDTH, Math.max(MIN_RAIL_WIDTH, startWidth + delta))
      setRailWidth(newWidth)
    }

    const onMouseUp = () => {
      isResizing.current = false
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)
  }, [railWidth])

  if (turns.length === 0) return null

  // Collect file edits within a turn into a deduplicated list
  const groupEdits = (moments: KeyMoment[]): { edits: KeyMoment[]; others: KeyMoment[] } => {
    const edits: KeyMoment[] = []
    const others: KeyMoment[] = []
    for (const m of moments) {
      if (m.kind === 'edit') edits.push(m)
      else others.push(m)
    }
    return { edits, others }
  }

  const kindIcon = (kind: MomentKind): string => {
    switch (kind) {
      case 'assistant': return '💬'
      case 'error': return '❌'
      case 'question': return '❓'
      case 'todo': return '✅'
      case 'edit': return '✏️'
      case 'bash': return '›_'
      default: return ''
    }
  }

  return (
    <div className="key-moments-rail" style={{ width: railWidth }}>
      <div className="km-resize-handle" onMouseDown={handleResizeStart} />
      <div className="key-moments-rail-header">Key Moments</div>
      {turns.map((turn, turnIdx) => {
        const isCollapsed = collapsedTurns.has(turnIdx)
        const { edits, others } = groupEdits(turn.moments)
        const hasContent = others.length > 0 || edits.length > 0
        const isActiveTurn = activeMomentId === turn.userMoment.id ||
          turn.moments.some(m => m.id === activeMomentId)

        return (
          <div key={turn.userMoment.id} className={`km-turn${isActiveTurn ? ' active' : ''}`}>
            {/* Turn header — user message */}
            <button
              className={`km-turn-header${activeMomentId === turn.userMoment.id ? ' active' : ''}`}
              onClick={() => handleMomentClick(turn.userMoment)}
              title={turn.userLabel}
            >
              <span className="km-turn-number">{turnIdx + 1}</span>
              <span className="km-turn-label">{turn.userLabel}</span>
              {hasContent && (
                <span
                  className={`km-turn-chevron${isCollapsed ? ' collapsed' : ''}`}
                  onClick={(e) => { e.stopPropagation(); toggleTurn(turnIdx) }}
                />
              )}
            </button>

            {/* Turn contents — only when expanded */}
            {!isCollapsed && hasContent && (
              <div className="km-turn-body">
                {/* File edits section */}
                {edits.length > 0 && (
                  <div className="km-section">
                    <div className="km-section-label">Edits</div>
                    {edits.map(m => (
                      <button
                        key={m.id}
                        className={`km-item edit${activeMomentId === m.id ? ' active' : ''}`}
                        onClick={() => handleMomentClick(m)}
                        title={m.label}
                      >
                        <span className="km-item-icon">✏️</span>
                        <span className="km-item-label">{m.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Other moments */}
                {others.map(m => (
                  <button
                    key={m.id}
                    className={`km-item ${m.kind}${activeMomentId === m.id ? ' active' : ''}`}
                    onClick={() => handleMomentClick(m)}
                    title={m.label}
                  >
                    <span className="km-item-icon">{kindIcon(m.kind)}</span>
                    <span className="km-item-label">{m.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
