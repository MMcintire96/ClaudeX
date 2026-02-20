import React, { useEffect, useCallback } from 'react'
import ChatView from './components/chat/ChatView'
import { useUIStore } from './stores/uiStore'
import { useTerminalStore } from './stores/terminalStore'
import { useSessionStore } from './stores/sessionStore'
import { validateTheme } from './lib/themes'
import type { SessionFileEntry } from './stores/sessionStore'

interface PopoutAppProps {
  terminalId: string
  projectPath: string
  initialTheme: string | null
}

/**
 * Minimal renderer for the popout chat window.
 * Only renders ChatView + the IPC listeners it needs.
 */
export default function PopoutApp({ terminalId, projectPath, initialTheme }: PopoutAppProps) {
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

  // Claude session ID detection
  useEffect(() => {
    const unsub = window.api.terminal.onClaudeSessionId((tid, sessionId) => {
      useTerminalStore.getState().setClaudeSessionId(tid, sessionId)
      useSessionStore.getState().loadEntries(sessionId, projectPath, [])
      window.api.sessionFile.watch(tid, sessionId, projectPath).then(result => {
        if (result.success && result.entries && (result.entries as unknown[]).length > 0) {
          useSessionStore.getState().loadEntries(
            sessionId,
            projectPath,
            result.entries as SessionFileEntry[]
          )
        }
      })
    })
    return unsub
  }, [projectPath])

  // Session file entries (push-based)
  useEffect(() => {
    const unsub = window.api.sessionFile.onEntries((tid, entries) => {
      const sessionId = useTerminalStore.getState().claudeSessionIds[tid]
      if (!sessionId) return
      const store = useSessionStore.getState()
      if (store.sessions[sessionId]) {
        store.appendEntries(sessionId, entries as SessionFileEntry[])
      } else {
        store.loadEntries(sessionId, projectPath, entries as SessionFileEntry[])
      }
    })
    return unsub
  }, [projectPath])

  // Session file reset
  useEffect(() => {
    const unsub = window.api.sessionFile.onReset((tid, entries) => {
      const sessionId = useTerminalStore.getState().claudeSessionIds[tid]
      if (sessionId) {
        useSessionStore.getState().loadEntries(sessionId, projectPath, entries as SessionFileEntry[])
      }
    })
    return unsub
  }, [projectPath])

  // Claude status
  useEffect(() => {
    const unsub = window.api.terminal.onClaudeStatus((id, status) => {
      useTerminalStore.getState().setClaudeStatus(id, status as 'running' | 'idle' | 'attention' | 'done')
    })
    return unsub
  }, [])

  // Claude rename
  useEffect(() => {
    const unsub = window.api.terminal.onClaudeRename((id, name) => {
      useTerminalStore.getState().autoRenameTerminal(id, name)
    })
    return unsub
  }, [])

  // Context usage
  useEffect(() => {
    const unsub = window.api.terminal.onContextUsage((id, percent) => {
      useTerminalStore.getState().setContextUsage(id, percent)
    })
    return unsub
  }, [])

  // System messages
  useEffect(() => {
    const unsub = window.api.terminal.onSystemMessage((tid, message) => {
      const sessionId = useTerminalStore.getState().claudeSessionIds[tid]
      if (sessionId) {
        useSessionStore.getState().addSystemMessage(sessionId, message)
      }
    })
    return unsub
  }, [])

  // Bootstrap: fetch existing session ID for the terminal if it already exists
  useEffect(() => {
    window.api.terminal.getClaudeSessionId(terminalId).then(sessionId => {
      if (sessionId) {
        useTerminalStore.getState().setClaudeSessionId(terminalId, sessionId)
        useSessionStore.getState().loadEntries(sessionId, projectPath, [])
        window.api.sessionFile.watch(terminalId, sessionId, projectPath).then(result => {
          if (result.success && result.entries && (result.entries as unknown[]).length > 0) {
            useSessionStore.getState().loadEntries(
              sessionId,
              projectPath,
              result.entries as SessionFileEntry[]
            )
          }
        })
      }
    })
  }, [terminalId, projectPath])

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
        <ChatView terminalId={terminalId} projectPath={projectPath} />
      </div>
    </div>
  )
}
