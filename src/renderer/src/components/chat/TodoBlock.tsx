import React, { useState, useMemo, useEffect } from 'react'
import type { UIToolUseMessage } from '../../stores/sessionStore'

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

interface Props {
  message: UIToolUseMessage
  isLatest: boolean
  allTodoMessages: UIToolUseMessage[]
}

const STATUS_ICONS: Record<string, string> = {
  completed: '\u2714',
  in_progress: '\u25B6',
  pending: '\u25CB',
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const secs = seconds % 60
  if (minutes < 60) return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const mins = minutes % 60
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

interface ItemTiming {
  startedAt: number | null
  completedAt: number | null
  duration: number | null
}

/** Compute per-item timing by diffing consecutive TodoWrite snapshots. */
function computeTimings(allTodoMessages: UIToolUseMessage[]): Map<string, ItemTiming> {
  const timings = new Map<string, ItemTiming>()

  for (const msg of allTodoMessages) {
    const todos = (msg.input?.todos as TodoItem[]) || []
    for (const todo of todos) {
      const key = todo.content
      let timing = timings.get(key)
      if (!timing) {
        timing = { startedAt: null, completedAt: null, duration: null }
        timings.set(key, timing)
      }

      if (todo.status === 'in_progress' && timing.startedAt === null) {
        timing.startedAt = msg.timestamp
      }
      if (todo.status === 'completed' && timing.completedAt === null) {
        timing.completedAt = msg.timestamp
        if (timing.startedAt !== null) {
          timing.duration = timing.completedAt - timing.startedAt
        }
      }
    }
  }

  return timings
}

export default function TodoBlock({ message, isLatest, allTodoMessages }: Props) {
  const todos: TodoItem[] = (message.input?.todos as TodoItem[]) || []
  const [collapsed, setCollapsed] = useState(!isLatest)
  const [now, setNow] = useState(Date.now())

  const timings = useMemo(() => computeTimings(allTodoMessages), [allTodoMessages])

  // Tick every second for live elapsed time on in_progress items
  const hasInProgress = isLatest && todos.some(t => t.status === 'in_progress')
  useEffect(() => {
    if (!hasInProgress) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [hasInProgress])

  if (todos.length === 0) return null

  const completedCount = todos.filter(t => t.status === 'completed').length
  const inProgressItem = todos.find(t => t.status === 'in_progress')
  const allDone = completedCount === todos.length
  const progress = Math.round((completedCount / todos.length) * 100)

  // Total elapsed: from first in_progress to last completed (or now)
  let totalElapsed: number | null = null
  const allTimingValues = [...timings.values()]
  const firstStart = allTimingValues.reduce<number | null>((min, t) => {
    if (t.startedAt === null) return min
    return min === null ? t.startedAt : Math.min(min, t.startedAt)
  }, null)
  if (firstStart !== null) {
    const lastEnd = allTimingValues.reduce<number | null>((max, t) => {
      if (t.completedAt === null) return max
      return max === null ? t.completedAt : Math.max(max, t.completedAt)
    }, null)
    totalElapsed = (allDone && lastEnd !== null ? lastEnd : now) - firstStart
  }

  return (
    <div className={`todo-block${allDone ? ' todo-block-done' : ''}`}>
      <button className="todo-block-header" onClick={() => setCollapsed(!collapsed)}>
        <div className="todo-block-title">
          <svg className="todo-block-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 11l3 3L22 4" />
            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
          <span>
            {allDone
              ? 'All tasks complete'
              : inProgressItem
                ? inProgressItem.activeForm || inProgressItem.content
                : `${completedCount}/${todos.length} tasks`
            }
          </span>
        </div>
        <div className="todo-block-meta">
          {totalElapsed !== null && (
            <span className="todo-total-time">{formatDuration(totalElapsed)}</span>
          )}
          <div className="todo-progress-bar">
            <div className="todo-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="todo-block-chevron">{collapsed ? '\u25B8' : '\u25BE'}</span>
        </div>
      </button>
      {!collapsed && (
        <div className="todo-block-body">
          {todos.map((todo, i) => {
            const timing = timings.get(todo.content)
            let timeLabel: string | null = null

            if (todo.status === 'completed' && timing?.duration !== null && timing?.duration !== undefined) {
              timeLabel = formatDuration(timing.duration)
            } else if (todo.status === 'in_progress' && timing?.startedAt !== null && timing?.startedAt !== undefined) {
              timeLabel = formatDuration(now - timing.startedAt)
            }

            return (
              <div key={i} className={`todo-item todo-item-${todo.status}`}>
                <span className={`todo-status todo-status-${todo.status}`}>
                  {STATUS_ICONS[todo.status] || STATUS_ICONS.pending}
                </span>
                <span className="todo-content">{todo.content}</span>
                {timeLabel && (
                  <span className={`todo-time todo-time-${todo.status}`}>
                    {timing?.startedAt ? formatTime(timing.startedAt) : ''}
                    {' · '}
                    {timeLabel}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
