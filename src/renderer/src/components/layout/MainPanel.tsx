import React, { useCallback, useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useTerminalStore } from '../../stores/terminalStore'
import ChatView from '../chat/ChatView'

export default function MainPanel() {
  const currentPath = useProjectStore(s => s.currentPath)
  const addTerminal = useTerminalStore(s => s.addTerminal)
  const activeClaudeId = useTerminalStore(s => s.activeClaudeId)
  const setActiveClaudeId = useTerminalStore(s => s.setActiveClaudeId)

  const activeId = currentPath ? activeClaudeId[currentPath] : null

  const [launching, setLaunching] = useState(false)

  const handleLaunchClaude = useCallback(async () => {
    if (!currentPath) return
    setLaunching(true)
    try {
      const result = await window.api.terminal.createClaude(currentPath)
      if (result.success && result.id) {
        const count = useTerminalStore.getState().terminals.filter(t => t.type === 'claude' && t.projectPath === currentPath).length
        addTerminal({
          id: result.id,
          projectPath: result.projectPath!,
          pid: result.pid!,
          name: `Claude Code${count > 0 ? ` ${count + 1}` : ''}`,
          type: 'claude'
        })
        setActiveClaudeId(currentPath, result.id)
      }
    } finally {
      setLaunching(false)
    }
  }, [currentPath, addTerminal, setActiveClaudeId])

  return (
    <main className="main-panel">
      {activeId ? (
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <ChatView
            key={activeId}
            terminalId={activeId}
            projectPath={currentPath!}
          />
        </div>
      ) : (
        <div className="empty-state">
          {currentPath ? (
            <>
              <div className="empty-state-icon">&#9672;</div>
              <h2>What can I help you build?</h2>
              <p>Start a new thread to begin working with Claude Code</p>
              <button className="btn btn-primary" onClick={handleLaunchClaude} disabled={launching}>
                {launching ? 'Starting...' : 'New thread'}
              </button>
            </>
          ) : (
            <>
              <div className="empty-state-icon">&#9672;</div>
              <h2>Open a project to get started</h2>
              <p>Select a project from the sidebar or open a new one</p>
            </>
          )}
        </div>
      )}
    </main>
  )
}
