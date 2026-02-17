import React, { useCallback, useState, useRef, useEffect } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useUIStore } from '../../stores/uiStore'
import { useTerminalStore, ClaudeTerminalStatus, SubAgentInfo } from '../../stores/terminalStore'
import { useSettingsStore } from '../../stores/settingsStore'
import TerminalView from '../terminal/TerminalView'
import ChatView from '../chat/ChatView'
import VoiceButton from '../common/VoiceButton'

const isMac = navigator.userAgent.includes('Macintosh')

const STATUS_COLORS: Record<ClaudeTerminalStatus, string> = {
  running: '#50fa7b',
  attention: '#f0a030',
  idle: '#888',
  done: '#666'
}

function TabRenameInput({ value, onCommit, onCancel }: { value: string; onCommit: (name: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const commit = () => {
    const trimmed = text.trim()
    if (trimmed && trimmed !== value) {
      onCommit(trimmed)
    } else {
      onCancel()
    }
  }

  return (
    <input
      ref={inputRef}
      className="claude-tab-rename-input"
      value={text}
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') onCancel()
      }}
      onClick={e => e.stopPropagation()}
      onDoubleClick={e => e.stopPropagation()}
    />
  )
}

export default function MainPanel() {
  const projectName = useProjectStore(s => s.currentName)
  const currentPath = useProjectStore(s => s.currentPath)
  const vimMode = useSettingsStore(s => s.vimMode)
  const sidePanelView = useUIStore(s => s.sidePanelView)
  const setSidePanelView = useUIStore(s => s.setSidePanelView)
  const terminals = useTerminalStore(s => s.terminals)
  const addTerminal = useTerminalStore(s => s.addTerminal)
  const removeTerminal = useTerminalStore(s => s.removeTerminal)
  const manualRenameTerminal = useTerminalStore(s => s.manualRenameTerminal)
  const claudeStatuses = useTerminalStore(s => s.claudeStatuses)
  const activeClaudeId = useTerminalStore(s => s.activeClaudeId)
  const setActiveClaudeId = useTerminalStore(s => s.setActiveClaudeId)
  const subAgents = useTerminalStore(s => s.subAgents)
  const claudeViewMode = useTerminalStore(s => s.claudeViewMode)
  const setClaudeViewMode = useTerminalStore(s => s.setClaudeViewMode)

  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [claudeSessionIds, setClaudeSessionIds] = useState<Record<string, string>>({})

  const claudeTerminals = currentPath
    ? terminals.filter(t => t.type === 'claude' && t.projectPath === currentPath)
    : []
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
      const count = terminals.filter(t => t.type === 'claude' && t.projectPath === currentPath).length
      addTerminal({
        id: result.id,
        projectPath: result.projectPath!,
        pid: result.pid!,
        name: `Claude Code${count > 0 ? ` ${count + 1}` : ''}`,
        type: 'claude'
      })
      setActiveClaudeId(currentPath, result.id)
    }
  }, [currentPath, terminals, addTerminal, setActiveClaudeId])

  const handleCloseClaudeTab = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    window.api.terminal.close(id)
    removeTerminal(id)
  }, [removeTerminal])

  const activeViewMode = activeId ? (claudeViewMode[activeId] || 'terminal') : 'terminal'

  // Poll for claude session IDs when chat mode is activated
  useEffect(() => {
    console.log('[MainPanel] session poll effect:', { activeId, activeViewMode, currentPath, hasCachedSid: activeId ? !!claudeSessionIds[activeId] : false })
    if (!activeId || activeViewMode !== 'chat' || !currentPath) return
    if (claudeSessionIds[activeId]) {
      console.log('[MainPanel] already have session ID:', claudeSessionIds[activeId])
      return
    }

    let cancelled = false
    const poll = async () => {
      // First try the terminal manager's detected session ID
      let sid = await window.api.terminal.getClaudeSessionId(activeId)
      console.log('[MainPanel] getClaudeSessionId result:', sid)

      // Fallback: find the most recently modified JSONL file for this project
      if (!sid) {
        const result = await window.api.sessionFile.findLatest(currentPath)
        console.log('[MainPanel] findLatest result:', result)
        if (result.success && result.sessionId) {
          sid = result.sessionId
        }
      }

      if (!cancelled && sid) {
        console.log('[MainPanel] setting session ID:', sid)
        setClaudeSessionIds(prev => ({ ...prev, [activeId]: sid! }))
      }
    }
    poll()
    const timer = setInterval(poll, 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [activeId, activeViewMode, claudeSessionIds, currentPath])

  const handleVoiceTranscript = useCallback(async (text: string) => {
    const targetId = currentPath ? activeClaudeId[currentPath] : null
    if (!targetId) return
    if (vimMode) {
      // Ensure vim insert mode: Escape → normal mode, then 'i' → insert mode
      await window.api.terminal.write(targetId, '\x1b')
      await new Promise(r => setTimeout(r, 50))
      await window.api.terminal.write(targetId, 'i')
      await new Promise(r => setTimeout(r, 50))
    }
    window.api.terminal.write(targetId, text)
  }, [currentPath, activeClaudeId, vimMode])

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
      {claudeTerminals.length > 0 ? (
        <>
          <div className="claude-tab-bar">
            {claudeTerminals.map(t => {
              const status = claudeStatuses[t.id] || 'idle'
              const isRenaming = renamingTabId === t.id
              return (
                <button
                  key={t.id}
                  className={`claude-tab ${t.id === activeId ? 'active' : ''}`}
                  onClick={() => currentPath && setActiveClaudeId(currentPath, t.id)}
                  onDoubleClick={() => setRenamingTabId(t.id)}
                >
                  <span
                    className="tree-item-status-dot"
                    style={{ background: STATUS_COLORS[status] }}
                  />
                  {isRenaming ? (
                    <TabRenameInput
                      value={t.name || 'Claude Code'}
                      onCommit={(name) => {
                        manualRenameTerminal(t.id, name)
                        setRenamingTabId(null)
                      }}
                      onCancel={() => setRenamingTabId(null)}
                    />
                  ) : (
                    <span>{t.name || 'Claude Code'}</span>
                  )}
                  <span
                    className="claude-tab-close"
                    onClick={(e) => handleCloseClaudeTab(e, t.id)}
                  >
                    &times;
                  </span>
                </button>
              )
            })}
            <button className="claude-tab claude-tab-new" onClick={handleLaunchClaude} title="New Claude terminal">
              +
            </button>
            {activeId && (
              <div className="claude-view-toggle">
                <button
                  className={`claude-view-toggle-btn ${activeViewMode === 'terminal' ? 'active' : ''}`}
                  onClick={() => activeId && setClaudeViewMode(activeId, 'terminal')}
                >
                  Terminal
                </button>
                <button
                  className={`claude-view-toggle-btn ${activeViewMode === 'chat' ? 'active' : ''}`}
                  onClick={() => activeId && setClaudeViewMode(activeId, 'chat')}
                >
                  Chat
                </button>
              </div>
            )}
          </div>
          {/* Sub-agent indicators for active tab */}
          {activeId && subAgents[activeId] && subAgents[activeId].length > 0 && (
            <div className="sub-agent-bar">
              {subAgents[activeId].map((agent: SubAgentInfo) => (
                <span key={agent.id} className={`sub-agent-indicator sub-agent-${agent.status}`}>
                  <span className="sub-agent-dot" />
                  <span className="sub-agent-name">{agent.name}</span>
                </span>
              ))}
            </div>
          )}
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
            {claudeTerminals.map(t => (
              <TerminalView
                key={t.id}
                terminalId={t.id}
                visible={t.id === activeId && (claudeViewMode[t.id] || 'terminal') === 'terminal'}
                background={undefined}
              />
            ))}
            {activeId && activeViewMode === 'chat' && (
              claudeSessionIds[activeId] ? (
                <ChatView
                  terminalId={activeId}
                  claudeSessionId={claudeSessionIds[activeId]}
                  projectPath={currentPath!}
                />
              ) : (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                  <span style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                    Waiting for session to start...
                  </span>
                </div>
              )
            )}
            <VoiceButton onTranscript={handleVoiceTranscript} />
          </div>
        </>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: '12px' }}>
          {currentPath ? (
            <>
              <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
                No Claude Code session running
              </span>
              <button className="btn" onClick={handleLaunchClaude}>
                Launch Claude Code
              </button>
            </>
          ) : (
            <span style={{ color: 'var(--text-muted)', fontSize: '14px' }}>
              Open a project to get started
            </span>
          )}
        </div>
      )}
    </main>
  )
}
