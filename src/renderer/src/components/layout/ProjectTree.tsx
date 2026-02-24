import React, { useCallback, useState, useRef, useEffect } from 'react'
import { sessionNeedsInput, type SessionState } from '../../stores/sessionStore'

interface InlineRenameProps {
  value: string
  onCommit: (name: string) => void
  onCancel: () => void
}

function InlineRename({ value, onCommit, onCancel }: InlineRenameProps) {
  const [text, setText] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const commit = () => {
    const trimmed = text.trim()
    if (trimmed && trimmed !== value) {
      onCommit(trimmed)
    } else {
      onCancel()
    }
  }

  return (
    <input
      ref={inputRef}
      className="tree-item-rename-input"
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') onCancel()
      }}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
    />
  )
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

interface DiffStats {
  additions: number
  deletions: number
}

interface ProjectTreeProps {
  projectPath: string
  projectName: string
  isCurrentProject: boolean
  isGitRepo: boolean
  sdkSessions: SessionState[]
  activeSessionId: string | null
  onSwitchToProject: () => void
  onSelectSession: (sessionId: string) => void
  onRenameSession: (sessionId: string, name: string) => void
  onCloseSession: (sessionId: string) => void
  onNewThread: () => void
  onRemoveProject: () => void
  onClearOldSessions: () => void
  onForkSession: (sessionId: string) => void
  historyEntries: Array<{ id: string; claudeSessionId?: string; projectPath: string; name: string; createdAt: number; endedAt: number; worktreePath?: string | null; isWorktree?: boolean }>
  onResumeHistory: (entry: { claudeSessionId?: string; projectPath: string; name: string; worktreePath?: string | null; isWorktree?: boolean }) => void
}

interface ContextMenuState {
  type: 'thread' | 'project'
  sessionId?: string
  x: number
  y: number
}

export default function ProjectTree({
  projectPath,
  projectName,
  isCurrentProject,
  isGitRepo,
  sdkSessions,
  activeSessionId,
  onSwitchToProject,
  onSelectSession,
  onRenameSession,
  onCloseSession,
  onNewThread,
  onRemoveProject,
  onClearOldSessions,
  onForkSession,
  historyEntries,
  onResumeHistory,
}: ProjectTreeProps) {
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [diffStats, setDiffStats] = useState<DiffStats | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [historyExpanded, setHistoryExpanded] = useState(false)

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const handler = () => setContextMenu(null)
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [contextMenu])

  // Fetch diff stats for the project
  useEffect(() => {
    if (!isGitRepo) return
    let cancelled = false

    const fetchStats = async () => {
      try {
        const result = await window.api.project.diff(projectPath)
        if (cancelled || !result.success || !result.diff) {
          if (!cancelled) setDiffStats(null)
          return
        }
        const lines = result.diff.split('\n')
        let additions = 0
        let deletions = 0
        for (const line of lines) {
          if (line.startsWith('+') && !line.startsWith('+++')) additions++
          if (line.startsWith('-') && !line.startsWith('---')) deletions++
        }
        setDiffStats({ additions, deletions })
      } catch {
        if (!cancelled) setDiffStats(null)
      }
    }

    fetchStats()
    const interval = setInterval(fetchStats, 15000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [projectPath, isGitRepo])

  const handleHeaderClick = useCallback(() => {
    if (!isCurrentProject) {
      onSwitchToProject()
    }
  }, [isCurrentProject, onSwitchToProject])

  // Sorted history: most recent first
  const sortedHistory = historyEntries.filter(e => !!e.claudeSessionId).slice().reverse()
  const HISTORY_COLLAPSED_LIMIT = 3
  const visibleHistory = historyExpanded ? sortedHistory : sortedHistory.slice(0, HISTORY_COLLAPSED_LIMIT)
  const hasMoreHistory = sortedHistory.length > HISTORY_COLLAPSED_LIMIT

  return (
    <div className="project-tree">
      {/* Project name row */}
      <button
        className={`project-tree-header ${isCurrentProject ? 'current' : ''}`}
        onClick={handleHeaderClick}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setContextMenu({ type: 'project', x: e.clientX, y: e.clientY })
        }}
      >
        <span className="project-tree-folder-icon">{'\uD83D\uDCC2'}</span>
        <span className="project-group-name">{projectName}</span>
        {diffStats && (diffStats.additions > 0 || diffStats.deletions > 0) && (
          <span className="project-diff-stats">
            {diffStats.additions > 0 && (
              <span className="diff-stat-add">+{diffStats.additions}</span>
            )}
            {diffStats.deletions > 0 && (
              <span className="diff-stat-del">-{diffStats.deletions}</span>
            )}
          </span>
        )}
      </button>

      <div className="project-tree-children">
        {/* Active SDK sessions */}
        {sdkSessions.map((s, i) => {
          const isActive = isCurrentProject && activeSessionId === s.sessionId
          const isRenaming = renamingSessionId === s.sessionId
          const displayName = s.name || `Claude Code ${i + 1}`
          const isRunning = s.isProcessing
          const needsInput = sessionNeedsInput(s)
          const status = needsInput ? 'needs-input' : isRunning ? 'running' : 'idle'
          return (
            <button
              key={s.sessionId}
              className={`tree-item tree-item-thread ${isActive ? 'active' : ''} status-${status}`}
              onClick={() => onSelectSession(s.sessionId)}
              onDoubleClick={() => setRenamingSessionId(s.sessionId)}
              onContextMenu={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setContextMenu({ type: 'thread', sessionId: s.sessionId, x: e.clientX, y: e.clientY })
              }}
            >
              <span
                className={`tree-item-status-indicator ${needsInput ? 'needs-input' : isRunning ? 'spinner' : ''}`}
                style={!isRunning && !needsInput ? { color: '#888' } : undefined}
              >
                {needsInput ? '\u25CF' : isRunning ? '' : '\u25CB'}
              </span>
              {isRenaming ? (
                <InlineRename
                  value={displayName}
                  onCommit={(name) => {
                    onRenameSession(s.sessionId, name)
                    setRenamingSessionId(null)
                  }}
                  onCancel={() => setRenamingSessionId(null)}
                />
              ) : (
                <span className="tree-item-label">
                  {displayName}
                </span>
              )}
              {s.isWorktree && !s.forkLabel && (
                <span className="worktree-badge" title="Running in worktree">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                </span>
              )}
              {s.forkLabel && (
                <span className="fork-badge" title={`Fork ${s.forkLabel}`}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="18" r="3"/>
                    <circle cx="6" cy="6" r="3"/>
                    <circle cx="18" cy="6" r="3"/>
                    <path d="M6 9v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9"/>
                    <line x1="12" y1="12" x2="12" y2="15"/>
                  </svg>
                  {s.forkLabel}
                </span>
              )}
              {s.isForkParent && (
                <span className="fork-parent-badge" title="Forked">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="18" r="3"/>
                    <circle cx="6" cy="6" r="3"/>
                    <circle cx="18" cy="6" r="3"/>
                    <path d="M6 9v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9"/>
                    <line x1="12" y1="12" x2="12" y2="15"/>
                  </svg>
                </span>
              )}
              <span className="thread-time"></span>
              {needsInput && (
                <span className="thread-needs-input-badge" title="Needs your input" />
              )}
            </button>
          )
        })}

        {/* Past threads (history) */}
        {sortedHistory.length > 0 && sdkSessions.length > 0 && (
          <div className="threads-separator" />
        )}
        {visibleHistory.map(entry => (
          <button
            key={entry.id}
            className="tree-item tree-item-thread tree-item-past"
            onClick={() => onResumeHistory(entry)}
            title={entry.claudeSessionId ? 'Click to resume' : 'No session ID'}
            disabled={!entry.claudeSessionId}
          >
            <span className="tree-item-status-indicator past">{'\u25CB'}</span>
            <span className="tree-item-label">{entry.name.replace(/^[^\w\s]+\s*/, '')}</span>
            <span className="thread-time">{timeAgo(entry.endedAt)}</span>
          </button>
        ))}
        {hasMoreHistory && (
          <button
            className="tree-item tree-item-show-more"
            onClick={() => setHistoryExpanded(!historyExpanded)}
          >
            <span className="tree-item-label show-more-label">
              {historyExpanded ? 'Show less' : `Show ${sortedHistory.length - HISTORY_COLLAPSED_LIMIT} more...`}
            </span>
          </button>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="thread-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          {contextMenu.type === 'project' ? (
            <>
              <button
                className="thread-context-menu-item"
                onClick={() => {
                  onNewThread()
                  setContextMenu(null)
                }}
              >
                New thread
              </button>
              {historyEntries.length > 0 && (
                <button
                  className="thread-context-menu-item"
                  onClick={() => {
                    onClearOldSessions()
                    setContextMenu(null)
                  }}
                >
                  Clear old sessions
                </button>
              )}
              <button
                className="thread-context-menu-item thread-context-menu-danger"
                onClick={() => {
                  onRemoveProject()
                  setContextMenu(null)
                }}
              >
                Remove project
              </button>
            </>
          ) : (
            <>
              <button
                className="thread-context-menu-item"
                onClick={() => {
                  if (contextMenu.sessionId) setRenamingSessionId(contextMenu.sessionId)
                  setContextMenu(null)
                }}
              >
                Rename
              </button>
              {(() => {
                const ctxSession = sdkSessions.find(s => s.sessionId === contextMenu.sessionId)
                const canFork = ctxSession && ctxSession.messages.length > 0 && !ctxSession.isForkParent
                return canFork ? (
                  <button
                    className="thread-context-menu-item"
                    onClick={() => {
                      if (contextMenu.sessionId) onForkSession(contextMenu.sessionId)
                      setContextMenu(null)
                    }}
                  >
                    Fork conversation
                  </button>
                ) : null
              })()}
              <button
                className="thread-context-menu-item"
                onClick={() => {
                  if (contextMenu.sessionId) onCloseSession(contextMenu.sessionId)
                  setContextMenu(null)
                }}
              >
                Kill session
              </button>
              {sdkSessions.length > 1 && (
                <button
                  className="thread-context-menu-item thread-context-menu-danger"
                  onClick={() => {
                    const others = sdkSessions.filter(s => s.sessionId !== contextMenu.sessionId)
                    for (const s of others) {
                      onCloseSession(s.sessionId)
                    }
                    setContextMenu(null)
                  }}
                >
                  Kill other sessions
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
