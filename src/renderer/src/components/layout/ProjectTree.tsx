import React, { useCallback, useState, useRef, useEffect } from 'react'
import { TerminalTab, ClaudeTerminalStatus, SubAgentInfo } from '../../stores/terminalStore'
import ChatHistory from './ChatHistory'

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

const STATUS_COLORS: Record<ClaudeTerminalStatus, string> = {
  running: '#50fa7b',
  attention: '#f0a030',
  idle: '#888',
  done: '#666'
}

interface ContextMenuState {
  x: number
  y: number
}

interface ProjectTreeProps {
  projectPath: string
  projectName: string
  isExpanded: boolean
  isCurrentProject: boolean
  isGitRepo: boolean
  gitBranch: string | null
  terminalTabs: TerminalTab[]
  activeTerminalId: string | null
  terminalPanelVisible: boolean
  claudeTerminals: TerminalTab[]
  claudeStatuses: Record<string, ClaudeTerminalStatus>
  subAgents: Record<string, SubAgentInfo[]>
  activeClaudeId: string | null
  onToggleExpanded: () => void
  onSwitchToProject: () => void
  onSelectTerminal: (id: string) => void
  onNewTerminal: () => void
  onRenameTerminal: (terminalId: string, name: string) => void
  onSelectClaudeTerminal: (id: string) => void
  onNewClaudeTerminal: () => void
  onRenameClaudeTerminal: (id: string, name: string) => void
  onCloseTerminal: (id: string) => void
  onRemoveProject: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  isDragOver: boolean
  historyEntries: Array<{ id: string; claudeSessionId?: string; projectPath: string; name: string; createdAt: number; endedAt: number }>
  onResumeHistory: (entry: { claudeSessionId?: string; projectPath: string; name: string }) => void
  onClearHistory: () => void
  hasStartConfig: boolean
  onRunStart: () => void
  onEditStartConfig: () => void
}

export default function ProjectTree({
  projectPath,
  projectName,
  isExpanded,
  isCurrentProject,
  isGitRepo,
  gitBranch,
  terminalTabs,
  activeTerminalId,
  terminalPanelVisible,
  claudeTerminals,
  claudeStatuses,
  subAgents,
  activeClaudeId,
  onToggleExpanded,
  onSwitchToProject,
  onSelectTerminal,
  onNewTerminal,
  onRenameTerminal,
  onSelectClaudeTerminal,
  onNewClaudeTerminal,
  onRenameClaudeTerminal,
  onCloseTerminal,
  onRemoveProject,
  onDragStart,
  onDragOver,
  onDrop,
  isDragOver,
  historyEntries,
  onResumeHistory,
  onClearHistory,
  hasStartConfig,
  onRunStart,
  onEditStartConfig
}: ProjectTreeProps) {
  const [renamingTerminalId, setRenamingTerminalId] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null)
  const [itemContextMenu, setItemContextMenu] = useState<{ x: number; y: number; id: string; type: 'claude' | 'shell' } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const itemMenuRef = useRef<HTMLDivElement>(null)

  const handleHeaderClick = useCallback(() => {
    if (!isCurrentProject) {
      onSwitchToProject()
    }
    onToggleExpanded()
  }, [isCurrentProject, onSwitchToProject, onToggleExpanded])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setItemContextMenu(null)
    setContextMenu({ x: e.clientX, y: e.clientY })
  }, [])

  const handleItemContextMenu = useCallback((e: React.MouseEvent, id: string, type: 'claude' | 'shell') => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu(null)
    setItemContextMenu({ x: e.clientX, y: e.clientY, id, type })
  }, [])

  // Close menus on outside click
  useEffect(() => {
    if (!contextMenu && !itemContextMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
      if (itemMenuRef.current && !itemMenuRef.current.contains(e.target as Node)) {
        setItemContextMenu(null)
      }
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [contextMenu, itemContextMenu])

  return (
    <div
      className={`project-tree ${isDragOver ? 'project-tree-drag-over' : ''}`}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button
        className={`project-tree-header ${isCurrentProject ? 'current' : ''}`}
        onClick={handleHeaderClick}
        onContextMenu={handleContextMenu}
        draggable
        onDragStart={onDragStart}
      >
        <span className={`project-group-chevron ${isExpanded ? 'open' : ''}`}>
          &#9654;
        </span>
        <span className="project-group-icon">{'\u25CF'}</span>
        <span className="project-group-name">{projectName}</span>
        {gitBranch && (
          <span className="project-git-branch">{gitBranch}</span>
        )}
        {hasStartConfig && (
          <span
            className="project-start-btn"
            title="Run start commands (right-click to edit)"
            onClick={(e) => { e.stopPropagation(); onRunStart() }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onEditStartConfig() }}
          >
            &#9654;
          </span>
        )}
      </button>

      {/* Project context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="context-menu-item"
            onClick={() => { onNewClaudeTerminal(); setContextMenu(null) }}
          >
            New Claude Code
          </button>
          <button
            className="context-menu-item"
            onClick={() => { onNewTerminal(); setContextMenu(null) }}
          >
            New Terminal
          </button>
          <div className="context-menu-separator" />
          <button
            className="context-menu-item"
            onClick={() => { onEditStartConfig(); setContextMenu(null) }}
          >
            Configure Start
          </button>
          <div className="context-menu-separator" />
          <button
            className="context-menu-item context-menu-item-danger"
            onClick={() => { onRemoveProject(); setContextMenu(null) }}
          >
            Remove Project
          </button>
        </div>
      )}

      {/* Item context menu (rename / close) */}
      {itemContextMenu && (
        <div
          ref={itemMenuRef}
          className="context-menu"
          style={{ top: itemContextMenu.y, left: itemContextMenu.x }}
        >
          <button
            className="context-menu-item"
            onClick={() => { setRenamingTerminalId(itemContextMenu.id); setItemContextMenu(null) }}
          >
            Rename
          </button>
          <button
            className="context-menu-item context-menu-item-danger"
            onClick={() => { onCloseTerminal(itemContextMenu.id); setItemContextMenu(null) }}
          >
            Close
          </button>
        </div>
      )}

      {isExpanded && (
        <div className="project-tree-children">
          {/* Claude terminal items */}
          {claudeTerminals.map((t, i) => {
            const status = claudeStatuses[t.id] || 'idle'
            const isActive = isCurrentProject && activeClaudeId === t.id
            const isRenaming = renamingTerminalId === t.id
            const displayName = t.name || `Claude Code ${i + 1}`
            return (
              <React.Fragment key={t.id}>
                <button
                  className={`tree-item tree-item-claude ${isActive ? 'active' : ''}`}
                  onClick={() => onSelectClaudeTerminal(t.id)}
                  onDoubleClick={() => setRenamingTerminalId(t.id)}
                  onContextMenu={(e) => handleItemContextMenu(e, t.id, 'claude')}
                >
                  <span
                    className="tree-item-status-dot"
                    style={{ background: STATUS_COLORS[status] }}
                  />
                  {isRenaming ? (
                    <InlineRename
                      value={displayName}
                      onCommit={(name) => {
                        onRenameClaudeTerminal(t.id, name)
                        setRenamingTerminalId(null)
                      }}
                      onCancel={() => setRenamingTerminalId(null)}
                    />
                  ) : (
                    <span className="tree-item-label">{displayName}</span>
                  )}
                </button>
                {/* Nested sub-agents */}
                {subAgents[t.id] && subAgents[t.id].length > 0 && (
                  <div className="tree-sub-agents">
                    {subAgents[t.id].map((agent: SubAgentInfo) => (
                      <div key={agent.id} className={`tree-sub-agent tree-sub-agent-${agent.status}`}>
                        <span className="sub-agent-dot" />
                        <span className="tree-item-label">{agent.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </React.Fragment>
            )
          })}

          {/* Individual shell terminal items */}
          {terminalTabs.map((t, i) => {
            const isActive = isCurrentProject && terminalPanelVisible && activeTerminalId === t.id
            const isRenaming = renamingTerminalId === t.id
            const displayName = t.name || `Terminal ${i + 1}`
            return (
              <button
                key={t.id}
                className={`tree-item tree-item-terminal ${isActive ? 'active' : ''}`}
                onClick={() => onSelectTerminal(t.id)}
                onDoubleClick={() => setRenamingTerminalId(t.id)}
                onContextMenu={(e) => handleItemContextMenu(e, t.id, 'shell')}
              >
                <span className="tree-item-icon">&gt;_</span>
                {isRenaming ? (
                  <InlineRename
                    value={displayName}
                    onCommit={(name) => {
                      onRenameTerminal(t.id, name)
                      setRenamingTerminalId(null)
                    }}
                    onCancel={() => setRenamingTerminalId(null)}
                  />
                ) : (
                  <span className="tree-item-label">{displayName}</span>
                )}
              </button>
            )
          })}

          {/* Chat History */}
          <ChatHistory
            entries={historyEntries}
            onResume={onResumeHistory}
            onClearHistory={onClearHistory}
          />
        </div>
      )}
    </div>
  )
}
