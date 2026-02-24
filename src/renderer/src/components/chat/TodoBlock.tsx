import React, { useState } from 'react'
import type { UIToolUseMessage } from '../../stores/sessionStore'

interface TodoItem {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm?: string
}

interface Props {
  message: UIToolUseMessage
  isLatest: boolean
}

const STATUS_ICONS: Record<string, string> = {
  completed: '\u2714',
  in_progress: '\u25B6',
  pending: '\u25CB',
}

export default function TodoBlock({ message, isLatest }: Props) {
  const todos: TodoItem[] = (message.input?.todos as TodoItem[]) || []
  const [collapsed, setCollapsed] = useState(!isLatest)

  if (todos.length === 0) return null

  const completedCount = todos.filter(t => t.status === 'completed').length
  const inProgressItem = todos.find(t => t.status === 'in_progress')
  const allDone = completedCount === todos.length
  const progress = Math.round((completedCount / todos.length) * 100)

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
          <div className="todo-progress-bar">
            <div className="todo-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="todo-block-chevron">{collapsed ? '\u25B8' : '\u25BE'}</span>
        </div>
      </button>
      {!collapsed && (
        <div className="todo-block-body">
          {todos.map((todo, i) => (
            <div key={i} className={`todo-item todo-item-${todo.status}`}>
              <span className={`todo-status todo-status-${todo.status}`}>
                {STATUS_ICONS[todo.status] || STATUS_ICONS.pending}
              </span>
              <span className="todo-content">{todo.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
