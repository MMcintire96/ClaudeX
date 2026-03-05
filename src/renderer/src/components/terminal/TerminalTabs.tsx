import React, { useCallback, useState, useRef, useEffect } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { SCRATCH_PROJECT_PATH } from '../../constants/scratch'

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
  const poppedOut = useTerminalStore(s => s.poppedOut)
  const setPoppedOut = useTerminalStore(s => s.setPoppedOut)
  const currentPath = useProjectStore(s => s.currentPath)
  const activeSessionId = useSessionStore(s => s.activeSessionId)
  const activeSession = useSessionStore(s => activeSessionId ? s.sessions[activeSessionId] : null)
  const isScratchSession = activeSession?.projectPath === SCRATCH_PROJECT_PATH
  const terminalFilterPath = isScratchSession ? SCRATCH_PROJECT_PATH : currentPath

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ctxMenu) return
    const close = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null)
      }
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [ctxMenu])

  // Listen for popout-closed events from main process
  useEffect(() => {
    const unsub = window.api.terminal.onPopoutClosed((id: string) => {
      setPoppedOut(id, false)
    })
    return unsub
  }, [setPoppedOut])

  const handlePopout = useCallback(async (id: string) => {
    const result = await window.api.terminal.popout(id)
    if (result.success) {
      setPoppedOut(id, true)
    }
  }, [setPoppedOut])

  const projectTerminals = terminals.filter(t => t.projectPath === terminalFilterPath)
  const isShellSplit = shellSplitIds.length === 2

  const handleNew = useCallback(async () => {
    const createPath = isScratchSession ? '~' : currentPath
    if (!createPath) return
    const result = await window.api.terminal.create(createPath)
    if (result.success) {
      addTerminal({ id: result.id, projectPath: isScratchSession ? SCRATCH_PROJECT_PATH : result.projectPath, pid: result.pid })
    }
  }, [currentPath, isScratchSession, addTerminal])

  const handleSplitShell = useCallback(async () => {
    if (isShellSplit) {
      unsplitShell()
      return
    }
    const createPath = isScratchSession ? '~' : currentPath
    if (!createPath || !activeTerminalId) return
    const leftId = activeTerminalId
    const result = await window.api.terminal.create(createPath)
    if (result.success) {
      addTerminal({ id: result.id, projectPath: isScratchSession ? SCRATCH_PROJECT_PATH : result.projectPath, pid: result.pid })
      // Manually set split IDs since addTerminal changes activeTerminalId
      useTerminalStore.setState({ shellSplitIds: [leftId, result.id] })
    }
  }, [currentPath, isScratchSession, isShellSplit, activeTerminalId, addTerminal, unsplitShell])

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
            onContextMenu={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setCtxMenu({ x: e.clientX, y: e.clientY, id: t.id })
            }}
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
              <span className="terminal-tab-label">
                {poppedOut[t.id] && <span className="terminal-tab-popout-indicator" title="Shared with external terminal">&#8599; </span>}
                {displayName}
              </span>
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
        className="terminal-tab terminal-tab-popout"
        onClick={() => activeTerminalId && handlePopout(activeTerminalId)}
        title="Open in external terminal"
        disabled={!activeTerminalId || (activeTerminalId ? poppedOut[activeTerminalId] : false)}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
          <polyline points="15 3 21 3 21 9"/>
          <line x1="10" y1="14" x2="21" y2="3"/>
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

      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="context-menu"
          style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 9999 }}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              setRenamingId(ctxMenu.id)
              setCtxMenu(null)
            }}
          >
            Rename
          </button>
          <button
            className="context-menu-item"
            disabled={poppedOut[ctxMenu.id]}
            onClick={() => {
              handlePopout(ctxMenu.id)
              setCtxMenu(null)
            }}
          >
            {poppedOut[ctxMenu.id] ? 'Already popped out' : 'Open in External Terminal'}
          </button>
          <button
            className="context-menu-item context-menu-item-danger"
            onClick={() => {
              window.api.terminal.close(ctxMenu.id)
              removeTerminal(ctxMenu.id)
              setCtxMenu(null)
            }}
          >
            Kill
          </button>
        </div>
      )}
    </div>
  )
}
