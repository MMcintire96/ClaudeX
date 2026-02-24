import React, { useEffect, useRef, useState } from 'react'
import AppLayout from './components/layout/AppLayout'
import ErrorBoundary from './components/common/ErrorBoundary'
import HotkeysModal from './components/common/HotkeysModal'
import CommandPalette from './components/common/CommandPalette'
import { useSessionStore, sessionNeedsInput } from './stores/sessionStore'
import { useUIStore } from './stores/uiStore'
import { useTerminalStore } from './stores/terminalStore'
import { useProjectStore } from './stores/projectStore'
import { useSettingsStore } from './stores/settingsStore'
import { validateTheme } from './lib/themes'

export default function App() {
  const processEvent = useSessionStore(s => s.processEvent)
  const setProcessing = useSessionStore(s => s.setProcessing)
  const setError = useSessionStore(s => s.setError)
  const renameSession = useSessionStore(s => s.renameSession)
  const theme = useUIStore(s => s.theme)
  const removeTerminal = useTerminalStore(s => s.removeTerminal)
  const currentPath = useProjectStore(s => s.currentPath)
  const terminalTogglePanel = useTerminalStore(s => s.togglePanel)
  const terminalAddTerminal = useTerminalStore(s => s.addTerminal)
  const terminalTerminals = useTerminalStore(s => s.terminals)
  const modKey = useSettingsStore(s => s.modKey)

  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const heldKeysRef = useRef<Set<string>>(new Set())

  // Wire up agent event listeners (SDK path)
  useEffect(() => {
    const unsubEvent = window.api.agent.onEvent(({ sessionId, event }) => {
      processEvent(sessionId, event)
    })

    const unsubEvents = window.api.agent.onEvents(({ sessionId, events }) => {
      for (const event of events) {
        processEvent(sessionId, event)
      }
    })

    const unsubClosed = window.api.agent.onClosed(({ sessionId, code }) => {
      setProcessing(sessionId, false)
      if (code !== 0 && code !== null) {
        setError(sessionId, `Agent process exited with code ${code}`)
      }
    })

    const unsubError = window.api.agent.onError(({ sessionId, error }) => {
      setProcessing(sessionId, false)
      setError(sessionId, error)
    })

    const unsubTitle = window.api.agent.onTitle(({ sessionId, title }) => {
      renameSession(sessionId, title)
    })

    return () => {
      unsubEvent()
      unsubEvents()
      unsubClosed()
      unsubError()
      unsubTitle()
    }
  }, [processEvent, setProcessing, setError, renameSession])

  // Centralized notification: fire when any non-active session transitions to needsInput
  const sessions = useSessionStore(s => s.sessions)
  const activeSessionId = useSessionStore(s => s.activeSessionId)
  const notifiedSessionsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    for (const [sid, session] of Object.entries(sessions)) {
      const needs = sessionNeedsInput(session)
      if (needs && sid !== activeSessionId && !notifiedSessionsRef.current.has(sid)) {
        notifiedSessionsRef.current.add(sid)
        // Fire browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          const lastMsg = [...session.messages].reverse().find(m => m.type === 'tool_use')
          const toolName = lastMsg && 'toolName' in lastMsg ? (lastMsg as { toolName: string }).toolName : ''
          let body = 'A session needs your attention'
          if (toolName === 'AskUserQuestion') body = 'Claude has a question for you'
          else if (toolName === 'ExitPlanMode') body = 'A plan is ready for your review'
          else body = `${toolName || 'A tool'} requires permission`

          new Notification(`${session.name || 'Claude Code'}`, {
            body,
            silent: false
          })
        } else if ('Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission()
        }
      } else if (!needs && notifiedSessionsRef.current.has(sid)) {
        // Clear notification tracking when input is no longer needed
        notifiedSessionsRef.current.delete(sid)
      }
    }
  }, [sessions, activeSessionId])

  // Prevent Electron from opening dropped files in the browser window
  useEffect(() => {
    const preventDrop = (e: DragEvent) => { e.preventDefault(); e.stopPropagation() }
    document.addEventListener('dragover', preventDrop)
    document.addEventListener('drop', preventDrop)
    return () => {
      document.removeEventListener('dragover', preventDrop)
      document.removeEventListener('drop', preventDrop)
    }
  }, [])

  // Apply theme to document + broadcast to popout windows
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    const channel = new BroadcastChannel('claudex-theme')
    channel.postMessage({ type: 'theme-changed', theme })
    channel.close()
  }, [theme])

  // Terminal exit listener (for shell terminals)
  useEffect(() => {
    const unsub = window.api.terminal.onExit((id: string) => {
      removeTerminal(id)
    })
    return unsub
  }, [removeTerminal])

  // Session restore listener — restore UI state and sessions
  useEffect(() => {
    const unsub = window.api.session.onRestore((state: unknown) => {
      const s = state as {
        theme?: string
        sidebarWidth?: number
        activeProjectPath?: string | null
        expandedProjects?: string[]
        sessions?: Array<{ id: string; projectPath: string; name: string; messages?: unknown[]; model?: string | null; totalCostUsd?: number; numTurns?: number; selectedModel?: string | null; createdAt: number; worktreePath?: string | null; isWorktree?: boolean; worktreeSessionId?: string | null }>
      }

      if (s.theme) {
        useUIStore.getState().setTheme(validateTheme(s.theme))
      }
      if (s.sidebarWidth && s.sidebarWidth !== 240) {
        useUIStore.getState().setSidebarWidth(s.sidebarWidth)
      }
      if (s.expandedProjects && s.expandedProjects.length > 0) {
        for (const path of s.expandedProjects) {
          useProjectStore.getState().setProjectExpanded(path, true)
        }
      }
      if (s.activeProjectPath) {
        useProjectStore.getState().setProject(s.activeProjectPath, false)
      }
      // Restore persisted sessions
      if (s.sessions && s.sessions.length > 0) {
        const sessionStore = useSessionStore.getState()
        for (const session of s.sessions) {
          sessionStore.restoreSession(session)
        }
        // Set active session to the last one for the active project
        if (s.activeProjectPath) {
          const lastSession = sessionStore.getLastSessionForProject(s.activeProjectPath)
          if (lastSession) {
            sessionStore.setActiveSession(lastSession)
          }
        }
      }
    })
    return unsub
  }, [])

  // Before-close handler: send UI snapshot to main process
  useEffect(() => {
    const unsub = window.api.app.onBeforeClose(() => {
      const uiState = useUIStore.getState()
      const projectState = useProjectStore.getState()
      const sessions = useSessionStore.getState().getSerializableSessions()
      window.api.app.sendUiSnapshot({
        theme: uiState.theme,
        sidebarWidth: uiState.sidebarWidth,
        activeProjectPath: projectState.currentPath,
        expandedProjects: projectState.expandedProjects,
        sessions
      })
    })
    return unsub
  }, [])

  // Auto-save session state every 30s for crash recovery
  useEffect(() => {
    const interval = setInterval(() => {
      const uiState = useUIStore.getState()
      const projectState = useProjectStore.getState()
      const sessions = useSessionStore.getState().getSerializableSessions()
      window.api.app.sendUiSnapshot({
        theme: uiState.theme,
        sidebarWidth: uiState.sidebarWidth,
        activeProjectPath: projectState.currentPath,
        expandedProjects: projectState.expandedProjects,
        sessions
      })
    }, 30_000)
    return () => clearInterval(interval)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const normalizeKey = (k: string): string => k === 'Control' ? 'Ctrl' : k

    const isModHeld = (e: KeyboardEvent): boolean => {
      const m = modKey
      if (m === 'Ctrl') return e.ctrlKey
      if (m === 'Alt') return e.altKey
      if (m === 'Meta') return e.metaKey
      if (m === 'Shift') return e.shiftKey
      return heldKeysRef.current.has(m)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      heldKeysRef.current.add(normalizeKey(e.key))

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
        return
      }

      if (normalizeKey(e.key) === modKey) return
      if (!isModHeld(e)) return

      const key = e.key.toLowerCase()

      // Mod+? (Shift+/ on most keyboards)
      if (e.key === '?' || (e.shiftKey && key === '/')) {
        e.preventDefault()
        setHotkeysOpen(prev => !prev)
        return
      }

      // Mod+K — Command palette
      if (key === 'k') {
        e.preventDefault()
        setHotkeysOpen(false)
        setCommandPaletteOpen(prev => !prev)
        return
      }

      // Mod+N — New SDK session
      if (key === 'n' && currentPath) {
        e.preventDefault()
        const store = useSessionStore.getState()
        const count = Object.values(store.sessions).filter(s => s.projectPath === currentPath).length
        const sessionId = `sdk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        store.createSession(currentPath, sessionId)
        store.renameSession(sessionId, `Claude Code${count > 0 ? ` ${count + 1}` : ''}`)
        return
      }

      // Mod+T — New shell terminal
      if (key === 't' && currentPath) {
        e.preventDefault()
        window.api.terminal.create(currentPath).then((result) => {
          if (result.success && result.id) {
            terminalAddTerminal({
              id: result.id,
              projectPath: result.projectPath!,
              pid: result.pid!
            })
          }
        })
        return
      }

      // Mod+O — Open project
      if (key === 'o') {
        e.preventDefault()
        window.api.project.open().then((result) => {
          if (result.success && result.path) {
            useProjectStore.getState().setProject(result.path, result.isGitRepo ?? false)
          }
        })
        return
      }

      // Mod+B — Toggle browser
      if (key === 'b' && currentPath) {
        e.preventDefault()
        const { sidePanelView, setSidePanelView } = useUIStore.getState()
        if (sidePanelView?.type === 'browser' && sidePanelView.projectPath === currentPath) {
          setSidePanelView(null)
        } else {
          setSidePanelView({ type: 'browser', projectPath: currentPath })
        }
        return
      }

      // Mod+D — Toggle diff
      if (key === 'd' && currentPath) {
        e.preventDefault()
        const { sidePanelView, setSidePanelView } = useUIStore.getState()
        if (sidePanelView?.type === 'diff' && sidePanelView.projectPath === currentPath) {
          setSidePanelView(null)
        } else {
          setSidePanelView({ type: 'diff', projectPath: currentPath })
        }
        return
      }

      // Mod+S — Toggle sidebar
      if (key === 's') {
        e.preventDefault()
        useUIStore.getState().toggleSidebar()
        return
      }

      // Mod+L — Cycle color scheme
      if (key === 'l') {
        e.preventDefault()
        useUIStore.getState().cycleTheme()
        return
      }

      // Mod+P — Toggle chat pop-out
      if (key === 'p' && !e.shiftKey) {
        e.preventDefault()
        useUIStore.getState().toggleChatDetached()
        return
      }

      // Mod+V — Voice input
      if (key === 'v') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('voice-toggle'))
        return
      }

      // Mod+W — Close active SDK session
      if (key === 'w' && currentPath) {
        e.preventDefault()
        const sessionStore = useSessionStore.getState()
        const activeId = sessionStore.activeSessionId
        if (activeId) {
          const session = sessionStore.sessions[activeId]
          if (session && session.messages.length > 0) {
            window.api.session.addHistory({
              id: activeId,
              claudeSessionId: activeId,
              projectPath: session.projectPath,
              name: session.name,
              createdAt: session.createdAt,
              endedAt: Date.now(),
              worktreePath: session.worktreePath,
              isWorktree: session.isWorktree
            }).catch(() => {})
          }
          window.api.agent.stop(activeId).catch(() => {})
          sessionStore.removeSession(activeId)
        }
        return
      }

      // Mod+1–9 — Switch SDK session
      const num = parseInt(e.key, 10)
      if (num >= 1 && num <= 9 && currentPath) {
        e.preventDefault()
        const projectSessions = Object.values(useSessionStore.getState().sessions)
          .filter(s => s.projectPath === currentPath)
          .sort((a, b) => a.createdAt - b.createdAt)
        const target = projectSessions[num - 1]
        if (target) {
          useSessionStore.getState().setActiveSession(target.sessionId)
        }
        return
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      heldKeysRef.current.delete(normalizeKey(e.key))
    }

    const handleBlur = () => {
      heldKeysRef.current.clear()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleBlur)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleBlur)
    }
  }, [terminalTerminals, currentPath, terminalTogglePanel, terminalAddTerminal, modKey])

  return (
    <ErrorBoundary>
      <AppLayout />
      {hotkeysOpen && (
        <HotkeysModal modKey={modKey} onClose={() => setHotkeysOpen(false)} />
      )}
      {commandPaletteOpen && (
        <CommandPalette onClose={() => setCommandPaletteOpen(false)} />
      )}
    </ErrorBoundary>
  )
}
