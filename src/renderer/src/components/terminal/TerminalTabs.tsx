import React, { useCallback, useState, useRef, useEffect } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useProjectStore } from '../../stores/projectStore'

function InlineRename({ value, onCommit, onCancel }: {
  value: string
  onCommit: (name: string) => void
  onCancel: () => void
}) {
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
      className="terminal-tab-rename-input"
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

export default function TerminalTabs() {
  const terminals = useTerminalStore(s => s.terminals)
  const activeTerminalId = useTerminalStore(s => s.activeTerminalId)
  const setActiveTerminal = useTerminalStore(s => s.setActiveTerminal)
  const removeTerminal = useTerminalStore(s => s.removeTerminal)
  const addTerminal = useTerminalStore(s => s.addTerminal)
  const renameTerminal = useTerminalStore(s => s.renameTerminal)
  const togglePanel = useTerminalStore(s => s.togglePanel)
  const shellSplitIds = useTerminalStore(s => s.shellSplitIds)
  const splitShell = useTerminalStore(s => s.splitShell)
  const unsplitShell = useTerminalStore(s => s.unsplitShell)
  const currentPath = useProjectStore(s => s.currentPath)

  const [renamingId, setRenamingId] = useState<string | null>(null)

  const projectTerminals = terminals.filter(t => t.projectPath === currentPath)
  const isShellSplit = shellSplitIds.length === 2

  const handleNew = useCallback(async () => {
    if (!currentPath) return
    const result = await window.api.terminal.create(currentPath)
    if (result.success) {
      addTerminal({ id: result.id, projectPath: result.projectPath, pid: result.pid })
    }
  }, [currentPath, addTerminal])

  const handleSplitShell = useCallback(async () => {
    if (isShellSplit) {
      unsplitShell()
      return
    }
    if (!currentPath || !activeTerminalId) return
    const leftId = activeTerminalId
    const result = await window.api.terminal.create(currentPath)
    if (result.success) {
      addTerminal({ id: result.id, projectPath: result.projectPath, pid: result.pid })
      // Manually set split IDs since addTerminal changes activeTerminalId
      useTerminalStore.setState({ shellSplitIds: [leftId, result.id] })
    }
  }, [currentPath, isShellSplit, activeTerminalId, addTerminal, unsplitShell])

  const handleClose = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      window.api.terminal.close(id)
      removeTerminal(id)
    },
    [removeTerminal]
  )

  const handleTabClick = useCallback((id: string) => {
    if (isShellSplit && id !== shellSplitIds[0]) {
      // Replace right pane in split mode
      useTerminalStore.setState({ shellSplitIds: [shellSplitIds[0], id] })
    }
    setActiveTerminal(id)
  }, [isShellSplit, shellSplitIds, setActiveTerminal])

  return (
    <div className="terminal-tabs">
      {projectTerminals.map((t, i) => {
        const displayName = t.name || `Terminal ${i + 1}`
        const isRenaming = renamingId === t.id
        return (
          <button
            key={t.id}
            className={`terminal-tab ${t.id === activeTerminalId ? 'active' : ''} ${isShellSplit && shellSplitIds.includes(t.id) ? 'split-active' : ''}`}
            onClick={() => handleTabClick(t.id)}
            onDoubleClick={() => setRenamingId(t.id)}
          >
            {isRenaming ? (
              <InlineRename
                value={displayName}
                onCommit={(name) => {
                  renameTerminal(t.id, name)
                  setRenamingId(null)
                }}
                onCancel={() => setRenamingId(null)}
              />
            ) : (
              <span className="terminal-tab-label">{displayName}</span>
            )}
            <span
              className="terminal-tab-close"
              onClick={(e) => handleClose(e, t.id)}
            >
              &times;
            </span>
          </button>
        )
      })}
      <button className="terminal-tab terminal-tab-new" onClick={handleNew} title="New terminal">
        +
      </button>
      <button
        className={`terminal-tab terminal-tab-split ${isShellSplit ? 'active' : ''}`}
        onClick={handleSplitShell}
        title={isShellSplit ? 'Unsplit' : 'Split terminal'}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
          <rect x="3" y="3" width="8" height="18" rx="1"/>
          <rect x="13" y="3" width="8" height="18" rx="1"/>
        </svg>
      </button>
      <button
        className="terminal-tab terminal-tab-hide"
        onClick={togglePanel}
        title="Hide terminal"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
    </div>
  )
}
