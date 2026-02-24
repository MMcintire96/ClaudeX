import React, { useEffect, useCallback } from 'react'
import ChatView from './components/chat/ChatView'
import { useUIStore } from './stores/uiStore'
import { useSessionStore } from './stores/sessionStore'
import { validateTheme } from './lib/themes'

interface PopoutAppProps {
  terminalId: string  // Actually a sessionId passed via URL params
  projectPath: string
  initialTheme: string | null
}

/**
 * Minimal renderer for the popout chat window.
 * Only renders ChatView + the IPC listeners it needs.
 */
export default function PopoutApp({ terminalId: sessionId, projectPath, initialTheme }: PopoutAppProps) {
  const theme = useUIStore(s => s.theme)

  // Set initial theme from query param
  useEffect(() => {
    if (initialTheme) {
      useUIStore.getState().setTheme(validateTheme(initialTheme))
    }
  }, [initialTheme])

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Listen for live theme changes from the main window via BroadcastChannel
  useEffect(() => {
    const channel = new BroadcastChannel('claudex-theme')
    channel.onmessage = (event) => {
      if (event.data?.type === 'theme-changed' && event.data.theme) {
        useUIStore.getState().setTheme(validateTheme(event.data.theme))
      }
    }
    return () => channel.close()
  }, [])

  // Restore session from snapshot sent by main window, or create empty fallback
  useEffect(() => {
    const store = useSessionStore.getState()
    // Create a blank session immediately so ChatView has something to render
    if (!store.sessions[sessionId]) {
      store.createSession(projectPath, sessionId)
    }

    // Listen for the full session snapshot from the main window
    const unsub = window.api.popout.onInit(({ session }) => {
      if (session && typeof session === 'object') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useSessionStore.getState().restoreSession(session as any)
      }
    })
    return unsub
  }, [sessionId, projectPath])

  // Agent SDK event listeners
  useEffect(() => {
    const unsubs: Array<() => void> = []

    unsubs.push(window.api.agent.onEvent(({ sessionId: sid, event }) => {
      if (sid === sessionId) {
        useSessionStore.getState().processEvent(sid, event)
      }
    }))

    unsubs.push(window.api.agent.onEvents(({ sessionId: sid, events }) => {
      if (sid === sessionId) {
        const store = useSessionStore.getState()
        for (const event of events) {
          store.processEvent(sid, event)
        }
      }
    }))

    unsubs.push(window.api.agent.onClosed(({ sessionId: sid }) => {
      if (sid === sessionId) {
        useSessionStore.getState().setProcessing(sid, false)
      }
    }))

    unsubs.push(window.api.agent.onError(({ sessionId: sid, error }) => {
      if (sid === sessionId) {
        useSessionStore.getState().addSystemMessage(sid, `Error: ${error}`)
        useSessionStore.getState().setProcessing(sid, false)
      }
    }))

    return () => unsubs.forEach(fn => fn())
  }, [sessionId])

  // Prevent drag-and-drop navigation
  useEffect(() => {
    const preventDrop = (e: DragEvent) => { e.preventDefault(); e.stopPropagation() }
    document.addEventListener('dragover', preventDrop)
    document.addEventListener('drop', preventDrop)
    return () => {
      document.removeEventListener('dragover', preventDrop)
      document.removeEventListener('drop', preventDrop)
    }
  }, [])

  const handleDockBack = useCallback(() => {
    window.api.popout.close()
  }, [])

  return (
    <div className="popout-app">
      <div className="popout-header">
        <span className="popout-header-title">Chat</span>
        <button
          className="popout-header-btn"
          onClick={handleDockBack}
          title="Dock back into main window"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 14 10 14 10 20"/>
            <polyline points="20 10 14 10 14 4"/>
            <line x1="14" y1="10" x2="21" y2="3"/>
            <line x1="3" y1="21" x2="10" y2="14"/>
          </svg>
          <span>Dock</span>
        </button>
      </div>
      <div className="popout-body">
        <ChatView sessionId={sessionId} projectPath={projectPath} />
      </div>
    </div>
  )
}
