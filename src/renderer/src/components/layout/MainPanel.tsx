import React, { useCallback } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useUIStore } from '../../stores/uiStore'
import { useTerminalStore } from '../../stores/terminalStore'
import ChatView from '../chat/ChatView'

const isMac = navigator.userAgent.includes('Macintosh')

export default function MainPanel() {
  const projectName = useProjectStore(s => s.currentName)
  const currentPath = useProjectStore(s => s.currentPath)
  const sidePanelView = useUIStore(s => s.sidePanelView)
  const setSidePanelView = useUIStore(s => s.setSidePanelView)
  const addTerminal = useTerminalStore(s => s.addTerminal)
  const activeClaudeId = useTerminalStore(s => s.activeClaudeId)
  const setActiveClaudeId = useTerminalStore(s => s.setActiveClaudeId)

  const activeId = currentPath ? activeClaudeId[currentPath] : null

  const isBrowserActive = sidePanelView?.type === 'browser' && sidePanelView?.projectPath === currentPath
  const isDiffActive = sidePanelView?.type === 'diff' && sidePanelView?.projectPath === currentPath

  const handleToggleBrowser = useCallback(() => {
    if (!currentPath) return
    setSidePanelView({ type: 'browser', projectPath: currentPath })
  }, [currentPath, setSidePanelView])

  const handleToggleDiff = useCallback(() => {
    if (!currentPath) return
    setSidePanelView({ type: 'diff', projectPath: currentPath })
  }, [currentPath, setSidePanelView])

  const handleLaunchClaude = useCallback(async () => {
    if (!currentPath) return
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
  }, [currentPath, addTerminal, setActiveClaudeId])

  return (
    <main className="main-panel">
      <div className="main-header">
        <div className="main-header-left">
          <span className="main-header-title">
            {projectName ?? 'No project'}
          </span>
        </div>
        <div className="main-header-actions">
          <button
            className={`btn-header-icon ${isBrowserActive ? 'active' : ''}`}
            onClick={handleToggleBrowser}
            title="Browser"
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
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 3v18"/>
              <rect x="3" y="3" width="18" height="18" rx="2"/>
            </svg>
          </button>
          <div className="header-separator" />
          <button
            className="btn-header-icon"
            onClick={() => window.api.win.reload()}
            title="Reload"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23 4 23 10 17 10"/>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
            </svg>
          </button>
          <button
            className="btn-header-icon"
            onClick={() => window.api.win.devtools()}
            title="Developer Tools"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 18 22 12 16 6"/>
              <polyline points="8 6 2 12 8 18"/>
            </svg>
          </button>
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
      </div>

      {activeId ? (
        <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
          <ChatView
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
              <button className="btn btn-primary" onClick={handleLaunchClaude}>
                New thread
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
