import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useUIStore } from '../../stores/uiStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'
import SettingsPanel from '../settings/SettingsPanel'
import StartConfigModal from './StartConfigModal'
import iconUrl from '../../assets/icon.png'

const isMac = navigator.userAgent.includes('Macintosh')

const SidebarExpandIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
)

export default function AppHeader() {
  const projectName = useProjectStore(s => s.currentName)
  const currentPath = useProjectStore(s => s.currentPath)
  const sidebarVisible = useUIStore(s => s.sidebarVisible)
  const toggleSidebar = useUIStore(s => s.toggleSidebar)
  const sidePanelView = useUIStore(s => s.sidePanelView)
  const setSidePanelView = useUIStore(s => s.setSidePanelView)
  const activeSessionId = useSessionStore(s => s.activeSessionId)
  const activeSession = useSessionStore(s => activeSessionId ? s.sessions[activeSessionId] : null)

  const chatDetached = useUIStore(s => s.chatDetached)
  const toggleChatDetached = useUIStore(s => s.toggleChatDetached)

  // Use worktree path if the active session is in a worktree, otherwise project path
  const effectiveCwd = activeSession?.worktreePath || currentPath

  const isBrowserActive = sidePanelView?.type === 'browser' && sidePanelView?.projectPath === currentPath
  const isDiffActive = sidePanelView?.type === 'diff' && sidePanelView?.projectPath === currentPath

  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsAnchorRef = useRef<HTMLDivElement>(null)

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)
  const ctxMenuRef = useRef<HTMLDivElement>(null)

  const [runMenuOpen, setRunMenuOpen] = useState(false)
  const runMenuRef = useRef<HTMLDivElement>(null)
  const [startConfigPath, setStartConfigPath] = useState<string | null>(null)
  const [hasStartConfig, setHasStartConfig] = useState(false)
  const [buildCommand, setBuildCommand] = useState<string | null>(null)

  useEffect(() => {
    if (!settingsOpen) return
    const close = (e: MouseEvent) => {
      if (settingsAnchorRef.current && !settingsAnchorRef.current.contains(e.target as Node)) {
        setSettingsOpen(false)
      }
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [settingsOpen])

  useEffect(() => {
    if (!ctxMenu) return
    const close = (e: MouseEvent) => {
      if (ctxMenuRef.current && !ctxMenuRef.current.contains(e.target as Node)) {
        setCtxMenu(null)
      }
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [ctxMenu])

  // Close run menu on outside click
  useEffect(() => {
    if (!runMenuOpen) return
    const close = (e: MouseEvent) => {
      if (runMenuRef.current && !runMenuRef.current.contains(e.target as Node)) {
        setRunMenuOpen(false)
      }
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [runMenuOpen])

  // Check start config existence for current project
  useEffect(() => {
    if (!currentPath) { setHasStartConfig(false); setBuildCommand(null); return }
    window.api.project.getStartConfig(currentPath).then(config => {
      setHasStartConfig(!!config && config.commands.length > 0)
      setBuildCommand(config?.buildCommand || null)
    })
  }, [currentPath])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    setCtxMenu({ x: e.clientX, y: e.clientY })
  }, [])

const handleRunStart = useCallback(async () => {
    if (!currentPath) return
    const cwd = effectiveCwd || currentPath
    const result = await window.api.project.runStart(currentPath, cwd !== currentPath ? cwd : undefined)
    if (result.success && result.terminals) {
      const store = useTerminalStore.getState()
      for (const t of result.terminals) {
        // Always associate with currentPath so the terminal panel can find it
        store.addTerminal({ id: t.id, projectPath: currentPath, pid: t.pid, name: t.name })
      }
    } else if (result.success && result.terminalIds) {
      const store = useTerminalStore.getState()
      for (const tid of result.terminalIds) {
        store.addTerminal({ id: tid, projectPath: currentPath, pid: 0 })
      }
    }
    if (result.success && result.browserUrl) {
      const url = result.browserUrl
      const currentPanel = useUIStore.getState().sidePanelView
      const browserAlreadyOpen = currentPanel?.type === 'browser' && currentPanel?.projectPath === currentPath
      if (browserAlreadyOpen) {
        window.api.browser.navigate(url)
      } else {
        useUIStore.getState().setPendingBrowserUrl(url)
        setSidePanelView({ type: 'browser', projectPath: currentPath })
      }
    }
    setRunMenuOpen(false)
  }, [currentPath, effectiveCwd, setSidePanelView])

  const handleToggleBrowser = useCallback(() => {
    if (!currentPath) return
    setSidePanelView({ type: 'browser', projectPath: currentPath })
  }, [currentPath, setSidePanelView])

  const handleOpenTerminal = useCallback(async () => {
    if (!currentPath) return
    const cwd = effectiveCwd || currentPath
    const store = useTerminalStore.getState()
    const shellTerminals = store.terminals.filter(t => t.projectPath === currentPath)
    if (shellTerminals.length === 0) {
      const result = await window.api.terminal.create(cwd)
      if (result.success && result.id) {
        store.addTerminal({ id: result.id, projectPath: currentPath, pid: result.pid || 0 })
      }
    } else {
      store.togglePanel()
    }
  }, [currentPath, effectiveCwd])

  const handleToggleDiff = useCallback(() => {
    if (!currentPath) return
    setSidePanelView({ type: 'diff', projectPath: currentPath })
  }, [currentPath, setSidePanelView])

  return (
    <div className="main-header" onContextMenu={handleContextMenu}>
      <div className="main-header-left">
        {!sidebarVisible && (
          <button className="sidebar-expand-btn" onClick={toggleSidebar} title="Expand sidebar">
            <SidebarExpandIcon />
          </button>
        )}
        <img src={iconUrl} alt="" style={{ width: 20, height: 20, marginRight: 6, borderRadius: 4 }} />
        <span className="main-header-branding">ClaudeX</span>
      </div>
      <div className="main-header-center">
        <span className="main-header-title">
          {projectName ?? 'No project'}
        </span>
      </div>
      <div className="main-header-actions">
        {/* Terminal */}
        <button
          className="btn-header-icon"
          onClick={handleOpenTerminal}
          title="Terminal"
          disabled={!currentPath}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="4 17 10 11 4 5"/>
            <line x1="12" y1="19" x2="20" y2="19"/>
          </svg>
        </button>

        {/* Run dropdown */}
        <div className="run-dropdown-anchor" ref={runMenuRef}>
          <button
            className={`btn-header-icon ${runMenuOpen ? 'active' : ''}`}
            onClick={() => {
              if (!currentPath) return
              if (hasStartConfig) {
                handleRunStart()
              } else {
                setRunMenuOpen(o => !o)
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault()
              if (currentPath) setRunMenuOpen(o => !o)
            }}
            title={hasStartConfig ? 'Run' : 'Run (right-click for options)'}
            disabled={!currentPath}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
          </button>
          <button
            className="btn-header-caret"
            onClick={() => currentPath && setRunMenuOpen(o => !o)}
            disabled={!currentPath}
            title="Run options"
          >
            <svg width="8" height="8" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 5 6 8 9 5"/>
            </svg>
          </button>
          {runMenuOpen && (
            <div className="run-dropdown-menu">
              <button
                className="run-dropdown-item"
                onClick={() => { handleRunStart(); }}
                disabled={!hasStartConfig}
              >
                Run
                {!hasStartConfig && <span className="run-dropdown-hint">not configured</span>}
              </button>
              <button
                className="run-dropdown-item"
                disabled={!buildCommand}
                onClick={() => {
                  if (!currentPath || !buildCommand) return
                  const cwd = effectiveCwd || currentPath
                  window.api.terminal.create(cwd).then(result => {
                    if (result.success && result.id) {
                      useTerminalStore.getState().addTerminal({
                        id: result.id,
                        projectPath: currentPath,
                        pid: result.pid || 0,
                        name: 'Build'
                      })
                      window.api.terminal.write(result.id, buildCommand + '\r')
                    }
                  })
                  setRunMenuOpen(false)
                }}
              >
                Run build
                {!buildCommand && <span className="run-dropdown-hint">not configured</span>}
              </button>
              <button
                className="run-dropdown-item"
                onClick={() => { handleRunStart(); }}
                disabled={!hasStartConfig}
              >
                Start
                {!hasStartConfig && <span className="run-dropdown-hint">not configured</span>}
              </button>
              <div className="run-dropdown-separator" />
              <button
                className="run-dropdown-item"
                onClick={() => {
                  if (currentPath) setStartConfigPath(currentPath)
                  setRunMenuOpen(false)
                }}
              >
                Configure...
              </button>
            </div>
          )}
        </div>

        <div className="header-separator" />

        <button
          className={`btn-header-icon ${isBrowserActive ? 'active' : ''}`}
          onClick={handleToggleBrowser}
          title="Browser"
          disabled={!currentPath}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </button>
        <button
          className={`btn-header-icon ${isDiffActive ? 'active' : ''}`}
          onClick={handleToggleDiff}
          title="Diff"
          disabled={!currentPath}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 3v18"/>
            <rect x="3" y="3" width="18" height="18" rx="2"/>
          </svg>
        </button>
        {activeSessionId && (
          <button
            className={`btn-header-icon ${chatDetached ? 'active' : ''}`}
            onClick={toggleChatDetached}
            title={chatDetached ? 'Dock chat' : 'Pop out chat'}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {chatDetached ? (
                <>
                  <polyline points="4 14 10 14 10 20"/>
                  <polyline points="20 10 14 10 14 4"/>
                  <line x1="14" y1="10" x2="21" y2="3"/>
                  <line x1="3" y1="21" x2="10" y2="14"/>
                </>
              ) : (
                <>
                  <polyline points="15 3 21 3 21 9"/>
                  <polyline points="9 21 3 21 3 15"/>
                  <line x1="21" y1="3" x2="14" y2="10"/>
                  <line x1="3" y1="21" x2="10" y2="14"/>
                </>
              )}
            </svg>
          </button>
        )}
        <div className="header-separator" />

        {/* Settings */}
        <div className="settings-dropdown-anchor" ref={settingsAnchorRef}>
          <button
            className={`btn-header-icon ${settingsOpen ? 'active' : ''}`}
            onClick={() => setSettingsOpen(o => !o)}
            title="Settings"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </button>
          {settingsOpen && (
            <div className="settings-dropdown">
              <SettingsPanel />
            </div>
          )}
        </div>

        {!isMac && (
          <>
            <div className="header-separator" />
            <button
              className="btn-window-control btn-window-close"
              onClick={() => window.api.win.close()}
              title="Close"
            >
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </>
        )}
      </div>

      {/* Right-click context menu */}
      {ctxMenu && (
        <div
          ref={ctxMenuRef}
          className="context-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button
            className="context-menu-item"
            onClick={() => { window.api.win.reload(); setCtxMenu(null) }}
          >
            Reload
          </button>
          <button
            className="context-menu-item"
            onClick={() => { window.api.win.devtools(); setCtxMenu(null) }}
          >
            Developer Tools
          </button>
        </div>
      )}

      {startConfigPath && (
        <StartConfigModal
          projectPath={startConfigPath}
          onClose={() => setStartConfigPath(null)}
          onSaved={() => {
            setHasStartConfig(true)
            if (currentPath) {
              window.api.project.getStartConfig(currentPath).then(config => {
                setBuildCommand(config?.buildCommand || null)
              })
            }
          }}
        />
      )}
    </div>
  )
}
