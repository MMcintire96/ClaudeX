import React, { useCallback } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useProjectStore } from '../../stores/projectStore'

export default function TerminalTabs() {
  const terminals = useTerminalStore(s => s.terminals)
  const activeTerminalId = useTerminalStore(s => s.activeTerminalId)
  const setActiveTerminal = useTerminalStore(s => s.setActiveTerminal)
  const removeTerminal = useTerminalStore(s => s.removeTerminal)
  const addTerminal = useTerminalStore(s => s.addTerminal)
  const currentPath = useProjectStore(s => s.currentPath)

  const handleNew = useCallback(async () => {
    if (!currentPath) return
    const result = await window.api.terminal.create(currentPath)
    if (result.success) {
      addTerminal({ id: result.id, projectPath: result.projectPath, pid: result.pid })
    }
  }, [currentPath, addTerminal])

  const handleClose = useCallback(
    (e: React.MouseEvent, id: string) => {
      e.stopPropagation()
      window.api.terminal.close(id)
      removeTerminal(id)
    },
    [removeTerminal]
  )

  return (
    <div className="terminal-tabs">
      {terminals.map((t, i) => (
        <button
          key={t.id}
          className={`terminal-tab ${t.id === activeTerminalId ? 'active' : ''}`}
          onClick={() => setActiveTerminal(t.id)}
        >
          <span className="terminal-tab-label">Terminal {i + 1}</span>
          <span
            className="terminal-tab-close"
            onClick={(e) => handleClose(e, t.id)}
          >
            &times;
          </span>
        </button>
      ))}
      <button className="terminal-tab terminal-tab-new" onClick={handleNew}>
        +
      </button>
    </div>
  )
}
