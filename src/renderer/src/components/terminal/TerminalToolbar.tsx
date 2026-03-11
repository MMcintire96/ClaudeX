import React, { useCallback } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { SCRATCH_PROJECT_PATH } from '../../constants/scratch'

export default function TerminalToolbar() {
  const activeTerminalId = useTerminalStore(s => s.activeTerminalId)
  const addTerminal = useTerminalStore(s => s.addTerminal)
  const togglePanel = useTerminalStore(s => s.togglePanel)
  const shellSplitIds = useTerminalStore(s => s.shellSplitIds)
  const unsplitShell = useTerminalStore(s => s.unsplitShell)
  const poppedOut = useTerminalStore(s => s.poppedOut)
  const setPoppedOut = useTerminalStore(s => s.setPoppedOut)
  const currentPath = useProjectStore(s => s.currentPath)
  const activeSessionId = useSessionStore(s => s.activeSessionId)
  const activeSession = useSessionStore(s => activeSessionId ? s.sessions[activeSessionId] : null)
  const isScratchSession = activeSession?.projectPath === SCRATCH_PROJECT_PATH

  const isShellSplit = shellSplitIds.length === 2

  const handleNew = useCallback(async () => {
    const createPath = isScratchSession ? '~' : currentPath
    if (!createPath) return
    const result = await window.api.terminal.create(createPath)
    if (result.success && result.id && result.projectPath && result.pid != null) {
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
    if (result.success && result.id && result.projectPath && result.pid != null) {
      addTerminal({ id: result.id, projectPath: isScratchSession ? SCRATCH_PROJECT_PATH : result.projectPath, pid: result.pid })
      useTerminalStore.setState({ shellSplitIds: [leftId, result.id] })
    }
  }, [currentPath, isScratchSession, isShellSplit, activeTerminalId, addTerminal, unsplitShell])

  const handlePopout = useCallback(async () => {
    if (!activeTerminalId) return
    const result = await (window.api.terminal as any).popout(activeTerminalId)
    if (result.success) {
      setPoppedOut(activeTerminalId, true)
    }
  }, [activeTerminalId, setPoppedOut])

  return (
    <div className="terminal-toolbar">
      <span className="terminal-toolbar-label">TERMINAL</span>
      <button className="terminal-collapse-center" onClick={togglePanel} title="Hide terminal">
        <span>Terminal</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      <div className="terminal-toolbar-actions">
        <button className="terminal-toolbar-btn" onClick={handleNew} title="New terminal">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
        <button
          className={`terminal-toolbar-btn ${isShellSplit ? 'active' : ''}`}
          onClick={handleSplitShell}
          title={isShellSplit ? 'Unsplit' : 'Split terminal'}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <rect x="3" y="3" width="8" height="18" rx="1"/>
            <rect x="13" y="3" width="8" height="18" rx="1"/>
          </svg>
        </button>
        <button
          className="terminal-toolbar-btn"
          onClick={handlePopout}
          title="Open in external terminal"
          disabled={!activeTerminalId || (activeTerminalId ? poppedOut[activeTerminalId] : false)}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
