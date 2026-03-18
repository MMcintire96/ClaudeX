import React, { useCallback, useState, useEffect, useRef } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import { useEditorStore } from '../../stores/editorStore'
import { SCRATCH_PROJECT_PATH } from '../../constants/scratch'
import ChatView from '../chat/ChatView'
import NeovimEditor from '../editor/NeovimEditor'
import ClaudeCodeTerminal, { killCCTerminal } from '../cc/ClaudeCodeTerminal'

function SplitEmptyState({ side }: { side: 'left' | 'right' }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">&#9672;</div>
      <h2>{side === 'right' ? 'Select a session' : 'No active session'}</h2>
      <p>{side === 'right' ? 'Click a session in the sidebar to show it here' : 'Start or select a session from the sidebar'}</p>
    </div>
  )
}

export default function MainPanel() {
  const currentPath = useProjectStore(s => s.currentPath)
  const activeSessionId = useSessionStore(s => s.activeSessionId)
  const activeSession = useSessionStore(s => activeSessionId ? s.sessions[activeSessionId] ?? null : null)
  const createSession = useSessionStore(s => s.createSession)
  const setActiveSession = useSessionStore(s => s.setActiveSession)
  const chatDetached = useUIStore(s => s.chatDetached)
  const toggleChatDetached = useUIStore(s => s.toggleChatDetached)
  const splitView = useUIStore(s => s.splitView)
  const splitSessionId = useUIStore(s => s.splitSessionId)
  const splitRatio = useUIStore(s => s.splitRatio)
  const setSplitRatio = useUIStore(s => s.setSplitRatio)
  const focusedSplitPane = useUIStore(s => s.focusedSplitPane)
  const setFocusedSplitPane = useUIStore(s => s.setFocusedSplitPane)
  const splitSession = useSessionStore(s => splitSessionId ? s.sessions[splitSessionId] ?? null : null)
  const mainPanelTab = useEditorStore(s => s.mainPanelTab)
  const setMainPanelTab = useEditorStore(s => s.setMainPanelTab)
  const setCCSessionId = useEditorStore(s => s.setCCSessionId)
  const ccResumeId = useEditorStore(s => s.ccResumeId)
  const setCCResumeId = useEditorStore(s => s.setCCResumeId)
  const hasCCTerminal = useEditorStore(s => !!(activeSessionId && s.ccSessionIds[activeSessionId]))
  const markAsResumable = useSessionStore(s => s.markAsResumable)

  const isScratchSession = activeSession?.projectPath === SCRATCH_PROJECT_PATH
  const showTabs = !!(currentPath || isScratchSession)
  const chatProjectPath = activeSession?.projectPath ?? currentPath
  // For CC terminal: scratch sessions use home dir (~) instead of the sentinel path
  const ccProjectPath = isScratchSession ? '~' : chatProjectPath

  // Track which sessions have had their CC terminal mounted (so we keep them alive)
  const [ccMountedSessions, setCCMountedSessions] = useState<Set<string>>(new Set())

  // When active session + CC tab is shown, add it to the mounted set
  useEffect(() => {
    if (activeSessionId && ccProjectPath && mainPanelTab === 'cc') {
      setCCMountedSessions(prev => {
        if (prev.has(activeSessionId)) return prev
        const next = new Set(prev)
        next.add(activeSessionId)
        return next
      })
    }
  }, [activeSessionId, ccProjectPath, mainPanelTab])

  // Clean up removed sessions from mounted set
  const sessions = useSessionStore(s => s.sessions)
  useEffect(() => {
    setCCMountedSessions(prev => {
      const sessionIds = new Set(Object.keys(sessions))
      let changed = false
      const next = new Set<string>()
      for (const id of prev) {
        if (sessionIds.has(id)) {
          next.add(id)
        } else {
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [sessions])

  const [launching, setLaunching] = useState(false)
  const splitContainerRef = useRef<HTMLDivElement>(null)

  const onSplitDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const container = splitContainerRef.current
    if (!container) return
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'

    const onMouseMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect()
      const x = ev.clientX - rect.left
      setSplitRatio(x / rect.width)
    }
    const onMouseUp = () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [setSplitRatio])

  // Auto-create a paired session when entering split view
  useEffect(() => {
    if (!splitView || !activeSessionId || splitSessionId) return
    const activeSession_ = useSessionStore.getState().sessions[activeSessionId]
    if (!activeSession_) return

    const projectPath = activeSession_.projectPath
    const count = Object.values(useSessionStore.getState().sessions)
      .filter(s => s.projectPath === projectPath).length
    const newId = `sdk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const store = useSessionStore.getState()
    store.createSession(projectPath, newId)
    const newName = `Claude Code ${count + 1}`
    store.renameSession(newId, newName)
    // Route the new session to the right pane (createSession sets it as active, undo that)
    store.setActiveSession(activeSessionId)
    useUIStore.getState().setSplitSessionId(newId)

    // Show system messages in both UIs — agents discover each other via session_list
    const leftName = activeSession_.name || 'Left session'
    const addSystem = store.addSystemMessage
    addSystem(activeSessionId, `Linked with "${newName}" — use session_list() to find the other session, session_send() to communicate.`)
    addSystem(newId, `Linked with "${leftName}" — use session_list() to find the other session, session_send() to communicate.`)
  }, [splitView, activeSessionId, splitSessionId])

  // Pair sessions for auto-forwarding file changes between them
  // Re-fires when session IDs change (e.g. after replaceSessionId re-keys)
  useEffect(() => {
    if (!splitView || !activeSessionId || !splitSessionId) return
    window.api.agent.pairSessions(activeSessionId, splitSessionId)
    // Persist the pair so it survives project switches
    const session = useSessionStore.getState().sessions[activeSessionId]
    if (session) {
      useUIStore.getState().setProjectPair(session.projectPath, activeSessionId, splitSessionId)
    }
  }, [splitView, activeSessionId, splitSessionId])

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
    if (chatDetached && activeSessionId && chatProjectPath) {
      const theme = useUIStore.getState().theme
      // Serialize current session state so the popout window gets existing messages
      const session = useSessionStore.getState().sessions[activeSessionId]
      const sessionSnapshot = session ? {
        id: session.sessionId,
        projectPath: session.projectPath,
        name: session.name,
        messages: session.messages,
        model: session.model,
        totalCostUsd: session.totalCostUsd,
        numTurns: session.numTurns,
        selectedModel: session.selectedModel,
        createdAt: session.createdAt,
        worktreePath: session.worktreePath,
        isWorktree: session.isWorktree,
        worktreeSessionId: session.worktreeSessionId,
        forkedFrom: session.forkedFrom,
        forkChildren: session.forkChildren,
        forkLabel: session.forkLabel,
        isForkParent: session.isForkParent
      } : null
      window.api.popout.create(activeSessionId, chatProjectPath, theme, sessionSnapshot)
    } else if (!chatDetached) {
      window.api.popout.close()
    }
  }, [chatDetached, activeSessionId, chatProjectPath])

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

  // CC → Chat: just switch tabs — CC keeps running, watcher keeps feeding events into Chat
  const handleCCToChat = useCallback(() => {
    setMainPanelTab('chat')
  }, [setMainPanelTab])

  // Chat → CC handoff: stop SDK agent, set resume ID, switch to CC
  const handleChatToCC = useCallback(async () => {
    if (!activeSessionId) return
    // Stop the SDK agent
    await window.api.agent.stop(activeSessionId)
    // Set the resume ID — CC terminal effect will kill existing + respawn with --resume
    setCCResumeId(activeSessionId)
    setMainPanelTab('cc')
  }, [activeSessionId, setCCResumeId, setMainPanelTab])

  return (
    <main className="main-panel">
      {showTabs && (
        <div className="main-panel-tabs">
          <button
            className={`main-panel-tab${mainPanelTab === 'chat' ? ' active' : ''}`}
            onClick={() => mainPanelTab === 'cc' && activeSessionId ? handleCCToChat() : setMainPanelTab('chat')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            Chat
          </button>
          {!isScratchSession && (
            <button
              className={`main-panel-tab${mainPanelTab === 'editor' ? ' active' : ''}`}
              onClick={() => setMainPanelTab('editor')}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              Editor
            </button>
          )}
          <button
            className={`main-panel-tab${mainPanelTab === 'cc' ? ' active' : ''}`}
            onClick={() => mainPanelTab === 'chat' && activeSessionId && activeSession?.messages?.length && !hasCCTerminal ? handleChatToCC() : setMainPanelTab('cc')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5"/>
              <line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
            CC
          </button>
          <div style={{ flex: 1 }} />
        </div>
      )}

      {/* Chat tab content — stays mounted, toggled via display */}
      <div style={{ display: mainPanelTab === 'chat' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
        {splitView ? (
          <div className="chat-split-container" ref={splitContainerRef}>
            {/* Left pane: writer */}
            <div
              className={`chat-split-pane${focusedSplitPane === 'left' ? ' focused' : ''}`}
              style={{ flex: `0 0 calc(${splitRatio * 100}% - 3px)` }}
              onClick={() => setFocusedSplitPane('left')}
            >
              <div className="split-pane-label split-pane-label-writer">Writer</div>
              {activeSessionId && chatProjectPath ? (
                <ChatView key={activeSessionId} sessionId={activeSessionId} projectPath={chatProjectPath} />
              ) : (
                <SplitEmptyState side="left" />
              )}
            </div>
            <div className="chat-split-divider" onMouseDown={onSplitDividerMouseDown} />
            {/* Right pane: reviewer */}
            <div
              className={`chat-split-pane${focusedSplitPane === 'right' ? ' focused' : ''}`}
              style={{ flex: 1 }}
              onClick={() => setFocusedSplitPane('right')}
            >
              <div className="split-pane-label split-pane-label-reviewer">Reviewer</div>
              {splitSessionId && splitSession ? (
                <ChatView key={splitSessionId} sessionId={splitSessionId} projectPath={splitSession.projectPath} reviewerMode />
              ) : (
                <SplitEmptyState side="right" />
              )}
            </div>
          </div>
        ) : activeSessionId && chatProjectPath ? (
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
                projectPath={chatProjectPath}
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
      </div>

      {/* Editor tab content — stays mounted, toggled via display */}
      <div style={{ display: mainPanelTab === 'editor' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}>
        <NeovimEditor projectPath={currentPath} visible={mainPanelTab === 'editor'} />
      </div>

      {/* CC tab content — per-session Claude Code CLI terminals, kept mounted for persistence */}
      <div style={{ display: mainPanelTab === 'cc' ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
        {/* Render all CC terminals that have been mounted — hidden when not active */}
        {Array.from(ccMountedSessions).map(sid => {
          const isActive = sid === activeSessionId
          const sess = sessions[sid]
          const sessProjectPath = sess?.projectPath === SCRATCH_PROJECT_PATH ? '~' : (sess?.projectPath ?? currentPath)
          return sessProjectPath ? (
            <ClaudeCodeTerminal
              key={sid}
              sessionId={sid}
              projectPath={sessProjectPath}
              visible={mainPanelTab === 'cc' && isActive}
              resumeSessionId={isActive ? ccResumeId : null}
              onCCSessionId={(ccId) => setCCSessionId(sid, ccId)}
              onResumeConsumed={isActive ? () => setCCResumeId(null) : undefined}
            />
          ) : null
        })}
        {/* Show empty state when active session hasn't spawned CC yet */}
        {(!activeSessionId || !ccProjectPath || !ccMountedSessions.has(activeSessionId)) && (
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5"/>
                <line x1="12" y1="19" x2="20" y2="19"/>
              </svg>
            </div>
            <h2>Start a thread to use Claude Code</h2>
            <p>Each thread gets its own Claude Code terminal instance</p>
          </div>
        )}
      </div>
    </main>
  )
}
