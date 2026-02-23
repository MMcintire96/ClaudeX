import React, { useCallback, useState, useEffect } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import ChatView from '../chat/ChatView'

export default function MainPanel() {
  const currentPath = useProjectStore(s => s.currentPath)
  const activeSessionId = useSessionStore(s => s.activeSessionId)
  const createSession = useSessionStore(s => s.createSession)
  const setActiveSession = useSessionStore(s => s.setActiveSession)
  const chatDetached = useUIStore(s => s.chatDetached)
  const toggleChatDetached = useUIStore(s => s.toggleChatDetached)

  const [launching, setLaunching] = useState(false)

  // Listen for popout window being closed externally
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
    if (chatDetached && activeSessionId && currentPath) {
      const theme = useUIStore.getState().theme
      window.api.popout.create(activeSessionId, currentPath, theme)
    } else if (!chatDetached) {
      window.api.popout.close()
    }
  }, [chatDetached, activeSessionId, currentPath])

  const handleLaunchClaude = useCallback(async () => {
    if (!currentPath) return
    setLaunching(true)
    try {
      const count = Object.values(useSessionStore.getState().sessions)
        .filter(s => s.projectPath === currentPath).length
      const sessionId = `sdk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      createSession(currentPath, sessionId)
      useSessionStore.getState().renameSession(sessionId, `Claude Code${count > 0 ? ` ${count + 1}` : ''}`)
    } finally {
      setLaunching(false)
    }
  }, [currentPath, createSession])

  return (
    <main className="main-panel">
      {activeSessionId ? (
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
              key={activeSessionId}
              sessionId={activeSessionId}
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
