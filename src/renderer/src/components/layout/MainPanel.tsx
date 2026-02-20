import React, { useCallback, useState, useEffect } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useUIStore } from '../../stores/uiStore'
import ChatView from '../chat/ChatView'

export default function MainPanel() {
  const currentPath = useProjectStore(s => s.currentPath)
  const addTerminal = useTerminalStore(s => s.addTerminal)
  const activeClaudeId = useTerminalStore(s => s.activeClaudeId)
  const setActiveClaudeId = useTerminalStore(s => s.setActiveClaudeId)
  const chatDetached = useUIStore(s => s.chatDetached)
  const toggleChatDetached = useUIStore(s => s.toggleChatDetached)

  const activeId = currentPath ? activeClaudeId[currentPath] : null

  const [launching, setLaunching] = useState(false)

  // Listen for popout window being closed externally (user closes the window)
  useEffect(() => {
    const unsub = window.api.popout.onClosed(() => {
      const state = useUIStore.getState()
      if (state.chatDetached) {
        state.toggleChatDetached()
      }
    })
    return unsub
  }, [])

  // When detach state changes, create or close the popout window
  useEffect(() => {
    if (chatDetached && activeId && currentPath) {
      const theme = useUIStore.getState().theme
      window.api.popout.create(activeId, currentPath, theme)
    } else if (!chatDetached) {
      window.api.popout.close()
    }
  }, [chatDetached, activeId, currentPath])

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
        chatDetached ? (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 3 21 3 21 9"/>
                <polyline points="9 21 3 21 3 15"/>
                <line x1="21" y1="3" x2="14" y2="10"/>
                <line x1="3" y1="21" x2="10" y2="14"/>
              </svg>
            </div>
            <h2>Chat is in a separate window</h2>
            <p>The chat has been popped out to its own window.</p>
            <button className="btn btn-primary" onClick={toggleChatDetached}>
              Dock chat back
            </button>
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            <ChatView
              key={activeId}
              terminalId={activeId}
              projectPath={currentPath!}
            />
          </div>
        )
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
