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
      className="terminal-list-rename-input"
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

export default function TerminalListSidebar() {
  const terminals = useTerminalStore(s => s.terminals)
  const activeTerminalId = useTerminalStore(s => s.activeTerminalId)
  const setActiveTerminal = useTerminalStore(s => s.setActiveTerminal)
  const removeTerminal = useTerminalStore(s => s.removeTerminal)
  const renameTerminal = useTerminalStore(s => s.renameTerminal)
  const shellSplitIds = useTerminalStore(s => s.shellSplitIds)
  const poppedOut = useTerminalStore(s => s.poppedOut)
  const setPoppedOut = useTerminalStore(s => s.setPoppedOut)
  const terminalListWidth = useTerminalStore(s => s.terminalListWidth)
  const currentPath = useProjectStore(s => s.currentPath)
  const activeSessionId = useSessionStore(s => s.activeSessionId)
  const activeSession = useSessionStore(s => activeSessionId ? s.sessions[activeSessionId] : null)
  const terminalFilterPath = activeSession?.projectPath === SCRATCH_PROJECT_PATH ? SCRATCH_PROJECT_PATH : currentPath

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; id: string } | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)

  const isShellSplit = shellSplitIds.length === 2
  const projectTerminals = terminals.filter(t => t.projectPath === terminalFilterPath)

  // Split terminals and non-split terminals
  const splitTerminals = isShellSplit ? projectTerminals.filter(t => shellSplitIds.includes(t.id)) : []
  const nonSplitTerminals = isShellSplit ? projectTerminals.filter(t => !shellSplitIds.includes(t.id)) : projectTerminals

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

  useEffect(() => {
    const unsub = (window.api.terminal as any).onPopoutClosed((id: string) => {
      setPoppedOut(id, false)
    })
    return unsub
  }, [setPoppedOut])

  const handleTabClick = useCallback((id: string) => {
    if (isShellSplit && id !== shellSplitIds[0]) {
      useTerminalStore.setState({ shellSplitIds: [shellSplitIds[0], id] })
    }
    setActiveTerminal(id)
  }, [isShellSplit, shellSplitIds, setActiveTerminal])

  const handleClose = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      window.api.terminal.close(id)
      removeTerminal(id)
    },
    [removeTerminal]
  )

  const handlePopout = useCallback(async (id: string) => {
    const result = await (window.api.terminal as any).popout(id)
    if (result.success) {
      setPoppedOut(id, true)
    }
  }, [setPoppedOut])

  const renderItem = (t: typeof terminals[0], i: number) => {
    const displayName = t.name || `Terminal ${i + 1}`
    const isRenaming = renamingId === t.id
    const isActive = t.id === activeTerminalId
    const isSplitActive = isShellSplit && shellSplitIds.includes(t.id)

    return (
      <div
        key={t.id}
        className={`terminal-list-item ${isActive ? 'active' : ''} ${isSplitActive ? 'split-active' : ''}`}
        onClick={() => handleTabClick(t.id)}
        onDoubleClick={() => setRenamingId(t.id)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setCtxMenu({ x: e.clientX, y: e.clientY, id: t.id })
        }}
      >
        <span className="terminal-list-icon">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5"/>
          </svg>
        </span>
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
          <span className="terminal-list-name">
            {poppedOut[t.id] && <span className="terminal-list-popout-indicator" title="Shared with external terminal">&#8599; </span>}
            {displayName}
          </span>
        )}
        <span
          className="terminal-list-close"
          onClick={(e) => handleClose(e, t.id)}
        >
          &times;
        </span>
      </div>
    )
  }

  // Get the global index for display names
  const getGlobalIndex = (t: typeof terminals[0]) => projectTerminals.indexOf(t)

  return (
    <div className="terminal-list-sidebar" style={{ width: terminalListWidth }}>
      {isShellSplit && (
        <>
          <div className="terminal-list-group-label">SPLIT 1</div>
          {splitTerminals.map(t => renderItem(t, getGlobalIndex(t)))}
          {nonSplitTerminals.length > 0 && (
            <div className="terminal-list-group-label" style={{ marginTop: 4 }}>OTHER</div>
          )}
        </>
      )}
      {nonSplitTerminals.map(t => renderItem(t, getGlobalIndex(t)))}

      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="context-menu"
          style={{
            position: 'fixed',
            left: Math.min(ctxMenu.x, window.innerWidth - 160),
            zIndex: 9999,
            ...(ctxMenu.y + 120 > window.innerHeight
              ? { bottom: window.innerHeight - ctxMenu.y }
              : { top: ctxMenu.y })
          }}
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
