import React, { useEffect } from 'react'
import AppLayout from './components/layout/AppLayout'
import { useSessionStore } from './stores/sessionStore'
import { useUIStore } from './stores/uiStore'
import { useTerminalStore } from './stores/terminalStore'
import { useProjectStore } from './stores/projectStore'

export default function App() {
  const processEvent = useSessionStore(s => s.processEvent)
  const setProcessing = useSessionStore(s => s.setProcessing)
  const setError = useSessionStore(s => s.setError)
  const theme = useUIStore(s => s.theme)
  const removeTerminal = useTerminalStore(s => s.removeTerminal)
  const currentPath = useProjectStore(s => s.currentPath)
  const terminalTogglePanel = useTerminalStore(s => s.togglePanel)
  const terminalAddTerminal = useTerminalStore(s => s.addTerminal)
  const terminalTerminals = useTerminalStore(s => s.terminals)

  // Wire up agent event listeners
  useEffect(() => {
    const unsubEvent = window.api.agent.onEvent(({ sessionId, event }) => {
      processEvent(sessionId, event)
    })

    const unsubClosed = window.api.agent.onClosed(({ sessionId, code }) => {
      // Process exited — this is normal between turns for -p mode
      setProcessing(sessionId, false)
      if (code !== 0 && code !== null) {
        setError(sessionId, `Agent process exited with code ${code}`)
      }
    })

    const unsubError = window.api.agent.onError(({ sessionId, error }) => {
      setProcessing(sessionId, false)
      setError(sessionId, error)
    })

    return () => {
      unsubEvent()
      unsubClosed()
      unsubError()
    }
  }, [processEvent, setProcessing, setError])

  // Apply theme to document
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  // Terminal exit listener
  useEffect(() => {
    const unsub = window.api.terminal.onExit((id: string) => {
      removeTerminal(id)
    })
    return unsub
  }, [removeTerminal])

  // Sync terminal list on project switch
  useEffect(() => {
    if (!currentPath) return
    window.api.terminal.list(currentPath).then((list: Array<{ id: string; projectPath: string; pid: number }>) => {
      // Terminal list is already managed by the store; this syncs on project switch
      // New terminals from other sources would be added here
    })
  }, [currentPath])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault()
        const input = document.querySelector('.input-textarea') as HTMLTextAreaElement
        input?.focus()
      }
      // Ctrl+` to toggle terminal
      if ((e.ctrlKey || e.metaKey) && e.key === '`') {
        e.preventDefault()
        if (terminalTerminals.length === 0 && currentPath) {
          window.api.terminal.create(currentPath).then((result: { success: boolean; id: string; projectPath: string; pid: number }) => {
            if (result.success) {
              terminalAddTerminal({ id: result.id, projectPath: result.projectPath, pid: result.pid })
            }
          })
        } else {
          terminalTogglePanel()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [terminalTerminals, currentPath, terminalTogglePanel, terminalAddTerminal])

  return <AppLayout />
}
