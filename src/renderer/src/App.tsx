import React, { useEffect, useRef, useState } from 'react'
import AppLayout from './components/layout/AppLayout'
import ErrorBoundary from './components/common/ErrorBoundary'
import HotkeysModal from './components/common/HotkeysModal'
import { useSessionStore } from './stores/sessionStore'
import { useUIStore } from './stores/uiStore'
import { useTerminalStore } from './stores/terminalStore'
import { useProjectStore } from './stores/projectStore'
import { useSettingsStore } from './stores/settingsStore'
import { validateTheme } from './lib/themes'

export default function App() {
  const processEvent = useSessionStore(s => s.processEvent)
  const setProcessing = useSessionStore(s => s.setProcessing)
  const setError = useSessionStore(s => s.setError)
  const theme = useUIStore(s => s.theme)
  const removeTerminal = useTerminalStore(s => s.removeTerminal)
  const setClaudeStatus = useTerminalStore(s => s.setClaudeStatus)
  const autoRenameTerminal = useTerminalStore(s => s.autoRenameTerminal)
  const addSubAgent = useTerminalStore(s => s.addSubAgent)
  const completeSubAgent = useTerminalStore(s => s.completeSubAgent)
  const currentPath = useProjectStore(s => s.currentPath)
  const terminalTogglePanel = useTerminalStore(s => s.togglePanel)
  const terminalAddTerminal = useTerminalStore(s => s.addTerminal)
  const terminalTerminals = useTerminalStore(s => s.terminals)
  const modKey = useSettingsStore(s => s.modKey)

  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  const heldKeysRef = useRef<Set<string>>(new Set())

  /** Set up session store + file watcher for a newly created Claude terminal */
  const setupSessionWatcher = (terminalId: string, claudeSessionId: string, projectPath: string) => {
    useTerminalStore.getState().setClaudeSessionId(terminalId, claudeSessionId)
    useSessionStore.getState().loadEntries(claudeSessionId, projectPath, [])
    window.api.sessionFile.watch(terminalId, claudeSessionId, projectPath).then(result => {
      if (result.success && result.entries && (result.entries as unknown[]).length > 0) {
        useSessionStore.getState().loadEntries(
          claudeSessionId,
          projectPath,
          result.entries as import('./stores/sessionStore').SessionFileEntry[]
        )
      }
    })
  }

  // Wire up agent event listeners
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
      unsubEvents()
      unsubClosed()
      unsubError()
    }
  }, [processEvent, setProcessing, setError])

  // Prevent Electron from opening dropped files in the browser window.
  // ChatView has its own drop handler that stops propagation for its area.
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

  // Terminal exit listener
  useEffect(() => {
    const unsub = window.api.terminal.onExit((id: string) => {
      window.api.sessionFile.unwatch(id)
      removeTerminal(id)
    })
    return unsub
  }, [removeTerminal])

  // Push-based session ID detection — handles /clear (new session ID for existing terminal)
  // and any other case where the main process detects a session ID change.
  // For new terminals, the call site sets up the watcher directly after addTerminal.
  useEffect(() => {
    const unsub = window.api.terminal.onClaudeSessionId((terminalId, sessionId) => {
      const prevSessionId = useTerminalStore.getState().claudeSessionIds[terminalId]
      useTerminalStore.getState().setClaudeSessionId(terminalId, sessionId)

      // Skip if this is the same session ID (already set up by the call site)
      if (prevSessionId === sessionId) return

      // Skip if the session is already initialized (call site or resume handler set it up)
      if (useSessionStore.getState().sessions[sessionId]) return

      const terminal = useTerminalStore.getState().terminals.find(t => t.id === terminalId)
      if (terminal) {
        const watchPath = terminal.worktreePath || terminal.projectPath
        useSessionStore.getState().loadEntries(sessionId, watchPath, [])
        window.api.sessionFile.watch(terminalId, sessionId, watchPath).then(result => {
          if (result.success && result.entries && (result.entries as unknown[]).length > 0) {
            useSessionStore.getState().loadEntries(
              sessionId,
              watchPath,
              result.entries as import('./stores/sessionStore').SessionFileEntry[]
            )
          }
        })
      }
    })
    return unsub
  }, [])

  // Push-based incremental session file entries
  useEffect(() => {
    const unsub = window.api.sessionFile.onEntries((terminalId, entries) => {
      const sessionId = useTerminalStore.getState().claudeSessionIds[terminalId]
      if (!sessionId) return
      const store = useSessionStore.getState()
      if (store.sessions[sessionId]) {
        store.appendEntries(sessionId, entries as import('./stores/sessionStore').SessionFileEntry[])
      } else {
        // Session not in store yet — create it with these entries
        const terminal = useTerminalStore.getState().terminals.find(t => t.id === terminalId)
        if (terminal) {
          const watchPath = terminal.worktreePath || terminal.projectPath
          store.loadEntries(sessionId, watchPath, entries as import('./stores/sessionStore').SessionFileEntry[])
        }
      }
    })
    return unsub
  }, [])

  // Push-based session file reset (new session file detected)
  useEffect(() => {
    const unsub = window.api.sessionFile.onReset((terminalId, entries) => {
      const sessionId = useTerminalStore.getState().claudeSessionIds[terminalId]
      const terminal = useTerminalStore.getState().terminals.find(t => t.id === terminalId)
      if (sessionId && terminal) {
        const watchPath = terminal.worktreePath || terminal.projectPath
        useSessionStore.getState().loadEntries(sessionId, watchPath, entries as import('./stores/sessionStore').SessionFileEntry[])
      }
    })
    return unsub
  }, [])

  // System message listener (e.g. "Conversation compacted")
  useEffect(() => {
    const unsub = window.api.terminal.onSystemMessage((terminalId, message) => {
      const sessionId = useTerminalStore.getState().claudeSessionIds[terminalId]
      if (sessionId) {
        useSessionStore.getState().addSystemMessage(sessionId, message)
      }
    })
    return unsub
  }, [])

  // Claude terminal status listener
  useEffect(() => {
    const unsub = window.api.terminal.onClaudeStatus((id: string, status: string) => {
      console.log('[claude-status]', id, status)
      setClaudeStatus(id, status as 'running' | 'idle' | 'attention' | 'done')
      // Clear permission request when Claude resumes running (user already responded)
      if (status === 'running') {
        useTerminalStore.getState().clearPermissionRequest(id)
      }
    })
    return unsub
  }, [setClaudeStatus])

  // Claude terminal auto-rename listener
  useEffect(() => {
    const unsub = window.api.terminal.onClaudeRename((id: string, name: string) => {
      autoRenameTerminal(id, name)
    })
    return unsub
  }, [autoRenameTerminal])

  // Permission request listener — surface CLI permission prompts in ChatView
  useEffect(() => {
    const unsub = window.api.terminal.onPermissionRequest((terminalId, permissionText, promptType) => {
      useTerminalStore.getState().setPermissionRequest(terminalId, permissionText, promptType as 'yn' | 'enter')
    })
    return unsub
  }, [])

  // Context usage listener
  useEffect(() => {
    const unsub = window.api.terminal.onContextUsage((id: string, percent: number) => {
      useTerminalStore.getState().setContextUsage(id, percent)
    })
    return unsub
  }, [])

  // Session restore listener — recreate Claude terminals with --resume and restore UI state
  useEffect(() => {
    const unsub = window.api.session.onRestore((state: unknown) => {
      const s = state as {
        sessions?: Array<{ claudeSessionId?: string; projectPath: string; name: string }>
        theme?: string
        sidebarWidth?: number
        activeProjectPath?: string | null
        expandedProjects?: string[]
      }

      // Restore UI state
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
        // Select the project (isGitRepo will be re-detected on load)
        useProjectStore.getState().setProject(s.activeProjectPath, false)
      }

      // Don't auto-restore old Claude sessions — they appear in history and can be
      // resumed on demand. Just restore UI state (theme, sidebar, active project).
    })
    return unsub
  }, [terminalAddTerminal])

  // Before-close handler: send UI snapshot to main process
  useEffect(() => {
    const unsub = window.api.app.onBeforeClose(() => {
      const uiState = useUIStore.getState()
      const projectState = useProjectStore.getState()
      window.api.app.sendUiSnapshot({
        theme: uiState.theme,
        sidebarWidth: uiState.sidebarWidth,
        activeProjectPath: projectState.currentPath,
        expandedProjects: projectState.expandedProjects
      })
    })
    return unsub
  }, [])

  // Agent spawn/complete listeners
  useEffect(() => {
    const unsubSpawn = window.api.terminal.onAgentSpawned((parentId, agent) => {
      addSubAgent(parentId, {
        id: agent.id,
        name: agent.name,
        status: agent.status as 'running' | 'completed',
        startedAt: agent.startedAt
      })
    })
    const unsubComplete = window.api.terminal.onAgentCompleted((parentId) => {
      completeSubAgent(parentId)
    })
    return () => {
      unsubSpawn()
      unsubComplete()
    }
  }, [addSubAgent, completeSubAgent])

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
    // Normalize a KeyboardEvent.key to the stored modKey format
    const normalizeKey = (k: string): string => k === 'Control' ? 'Ctrl' : k

    // Check whether the configured mod key is currently held
    const isModHeld = (e: KeyboardEvent): boolean => {
      const m = modKey
      // For built-in modifiers, use the native boolean for reliability
      if (m === 'Ctrl') return e.ctrlKey
      if (m === 'Alt') return e.altKey
      if (m === 'Meta') return e.metaKey
      if (m === 'Shift') return e.shiftKey
      // For any other key, fall back to tracked held-keys set
      return heldKeysRef.current.has(m)
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      // Track all held keys (normalized)
      heldKeysRef.current.add(normalizeKey(e.key))


      // Ctrl+` to toggle terminal (hardcoded, separate from mod system)
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

      // Don't fire hotkeys when the pressed key IS the mod key itself
      if (normalizeKey(e.key) === modKey) return

      if (!isModHeld(e)) return

      const key = e.key.toLowerCase()

      // Mod+? (Shift+/ on most keyboards)
      if (e.key === '?' || (e.shiftKey && key === '/')) {
        e.preventDefault()
        setHotkeysOpen(prev => !prev)
        return
      }

      // Mod+N — New Claude terminal
      if (key === 'n' && currentPath) {
        e.preventDefault()
        window.api.terminal.createClaude(currentPath).then((result) => {
          if (result.success && result.id) {
            terminalAddTerminal({
              id: result.id,
              projectPath: result.projectPath!,
              pid: result.pid!,
              type: 'claude'
            })
            if (result.claudeSessionId) {
              setupSessionWatcher(result.id, result.claudeSessionId, result.projectPath!)
            }
          }
        })
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

      // Mod+W — Close active Claude tab
      if (key === 'w' && currentPath) {
        e.preventDefault()
        const store = useTerminalStore.getState()
        const claudeTerminals = store.terminals.filter(
          t => t.type === 'claude' && t.projectPath === currentPath
        )
        const activeId = store.activeClaudeId[currentPath]
        const target = activeId
          ? claudeTerminals.find(t => t.id === activeId)
          : claudeTerminals[claudeTerminals.length - 1]
        if (target) {
          window.api.terminal.close(target.id)
          store.removeTerminal(target.id)
        }
        return
      }

      // Mod+1–9 — Switch Claude tab
      const num = parseInt(e.key, 10)
      if (num >= 1 && num <= 9 && currentPath) {
        e.preventDefault()
        const claudeTerminals = useTerminalStore.getState().terminals.filter(
          t => t.type === 'claude' && t.projectPath === currentPath
        )
        const target = claudeTerminals[num - 1]
        if (target) {
          useTerminalStore.getState().setActiveClaudeId(currentPath, target.id)
        }
        return
      }
    }

    const handleKeyUp = (e: KeyboardEvent) => {
      heldKeysRef.current.delete(normalizeKey(e.key))
    }

    // Clear held keys when the window loses focus to avoid stuck keys
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
    </ErrorBoundary>
  )
}
