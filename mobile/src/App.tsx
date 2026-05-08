import { useCallback, useEffect, useState } from 'react'
import {
  api, appState, clearAuth, createWsClient, getToken, setAuth, WsMessage
} from './api'
import {
  applyEvent, applyEvents, getSessions, setProcessing, setSessions, setSessionMessages,
  getSelectedProjectPath, setSelectedProjectPath, setSuggestion, setSelectedModel
} from './state/store'
import { Sidebar } from './components/Sidebar'
import { ChatView } from './components/ChatView'
import { PairScreen } from './components/PairScreen'
import { ProjectPane } from './components/ProjectPane'
import { ActionsPane } from './components/ActionsPane'
import { SettingsPane } from './components/SettingsPane'
import { DiffView } from './components/DiffView'
import { SidebarLeftIcon, SidebarRightIcon } from './components/Icons'
import type { UIMessage } from '@shared/sessionEvents'

type RightTab = 'project' | 'actions' | 'settings'

const THEME_OVERRIDE_KEY = 'claudex.theme'
type Subview =
  | { kind: 'shell' }
  | { kind: 'diff'; projectPath: string; filePath: string; untracked: boolean }

export default function App() {
  const [authed, setAuthed] = useState(!!getToken())
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [leftOpen, setLeftOpen] = useState(false)
  const [rightOpen, setRightOpen] = useState(false)
  const [rightTab, setRightTab] = useState<RightTab>('project')
  const [subview, setSubview] = useState<Subview>({ kind: 'shell' })

  // Read deep link from push notification (?session=...).
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const s = params.get('session') || (location.pathname.startsWith('/chat/') ? location.pathname.slice(6) : null)
    if (s) setActiveSessionId(s)
  }, [])

  // Apply the desktop's active theme on first load + when settings change.
  // A locally-overridden theme (set in the Settings tab) wins.
  useEffect(() => {
    if (!authed) return
    let cancelled = false
    const apply = async (): Promise<void> => {
      const localOverride = localStorage.getItem(THEME_OVERRIDE_KEY)
      if (localOverride) {
        document.documentElement.setAttribute('data-theme', localOverride)
      }
      try {
        const r = await appState.get()
        if (cancelled) return
        if (!localOverride && r.theme) {
          document.documentElement.setAttribute('data-theme', r.theme)
        }
        if (r.activeProjectPath && !getSelectedProjectPath()) setSelectedProjectPath(r.activeProjectPath)
      } catch { /* ignore — fall back to default dark */ }
    }
    void apply()
    return () => { cancelled = true }
  }, [authed])

  const refreshSessions = useCallback(async () => {
    try {
      const list = await api.listSessions()
      setSessions(list)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  // WebSocket subscription
  useEffect(() => {
    if (!authed) return
    const ws = createWsClient()
    const off = ws.on((msg: WsMessage) => {
      if (msg.type !== 'event') return
      const { channel, args } = msg
      const first = (args[0] ?? {}) as {
        sessionId?: string
        event?: unknown
        events?: unknown[]
        suggestion?: string
      }
      const sid = first.sessionId
      if (!sid) return
      switch (channel) {
        case 'agent:event':
          applyEvent(sid, first.event)
          break
        case 'agent:events':
          applyEvents(sid, first.events ?? [])
          break
        case 'agent:closed':
          setProcessing(sid, false)
          break
        case 'agent:title':
          void refreshSessions()
          break
        case 'agent:suggestion':
          if (typeof first.suggestion === 'string') setSuggestion(sid, first.suggestion)
          break
      }
    })
    ws.start()
    return () => { off(); ws.stop() }
  }, [authed, refreshSessions])

  // Initial load
  useEffect(() => {
    if (!authed) return
    void refreshSessions()
  }, [authed, refreshSessions])

  const onPaired = useCallback((token: string, deviceId: string) => {
    setAuth(token, deviceId)
    setAuthed(true)
  }, [])

  const onSignOut = useCallback(() => {
    clearAuth()
    setAuthed(false)
    setActiveSessionId(null)
  }, [])

  const onSelectSession = useCallback(async (id: string) => {
    setActiveSessionId(id)
    setLeftOpen(false)
    try {
      const detail = await api.getSession(id)
      setSessionMessages(id, (detail.messages as UIMessage[]) ?? [])
      if (detail.model) setSelectedModel(id, detail.model)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const onOpenDiff = useCallback((projectPath: string, filePath: string, untracked: boolean) => {
    setSubview({ kind: 'diff', projectPath, filePath, untracked })
    setRightOpen(false)
  }, [])

  const backToShell = useCallback(() => setSubview({ kind: 'shell' }), [])

  if (!authed) return <PairScreen onPaired={onPaired} />

  // Diff is a full-screen take-over.
  if (subview.kind === 'diff') {
    return (
      <div className="app">
        <DiffView
          projectPath={subview.projectPath}
          filePath={subview.filePath}
          untracked={subview.untracked}
          onBack={backToShell}
        />
      </div>
    )
  }

  const activeSession = activeSessionId ? getSessions().find(s => s.id === activeSessionId) : null

  return (
    <div className="app">
      <div className="shell">
        <header className="app-bar">
          <button
            className="icon-btn"
            aria-label="Sessions"
            aria-pressed={leftOpen}
            onClick={() => { setLeftOpen(v => !v); setRightOpen(false) }}
          >
            <SidebarLeftIcon size={18} />
          </button>
          <div className="app-bar-title">
            {activeSession ? (
              <>
                {activeSession.name || 'Session'}
                <span className="subtitle">
                  {(activeSession.projectPath.split('/').pop() || activeSession.projectPath)}
                </span>
              </>
            ) : (
              <>
                ClaudeX
                <span className="subtitle">no session selected</span>
              </>
            )}
          </div>
          <button
            className="icon-btn"
            aria-label="Project"
            aria-pressed={rightOpen}
            onClick={() => { setRightOpen(v => !v); setLeftOpen(false) }}
          >
            <SidebarRightIcon size={18} />
          </button>
        </header>

        <div className="main-region">
          {activeSessionId ? (
            <ChatView sessionId={activeSessionId} onBack={() => { /* no back in shell mode */ }} hideHeader />
          ) : (
            <div className="chat">
              <div className="chat-empty">
                <div className="chat-empty-icon">💬</div>
                <div className="chat-empty-text">
                  Open the sessions drawer (top-left) to pick a chat.
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Left drawer: sessions list */}
      <aside className={'drawer left' + (leftOpen ? ' open' : '')}>
        <Sidebar
          sessions={getSessions()}
          activeSessionId={activeSessionId}
          onSelect={onSelectSession}
          onRefresh={refreshSessions}
          onSignOut={onSignOut}
          error={error}
        />
      </aside>

      {/* Right drawer: project/actions/settings tabbed */}
      <aside className={'drawer right' + (rightOpen ? ' open' : '')}>
        <div className="right-tabs">
          <button
            className={'right-tab' + (rightTab === 'project' ? ' active' : '')}
            onClick={() => setRightTab('project')}
          >
            Project
          </button>
          <button
            className={'right-tab' + (rightTab === 'actions' ? ' active' : '')}
            onClick={() => setRightTab('actions')}
          >
            Actions
          </button>
          <button
            className={'right-tab' + (rightTab === 'settings' ? ' active' : '')}
            onClick={() => setRightTab('settings')}
          >
            Settings
          </button>
        </div>
        <div className="right-pane-body">
          {rightTab === 'project' && <ProjectPane onOpenDiff={onOpenDiff} />}
          {rightTab === 'actions' && <ActionsPane />}
          {rightTab === 'settings' && <SettingsPane onSignOut={onSignOut} />}
        </div>
      </aside>

      {/* Backdrop scrim — click to close the open drawer */}
      <div
        className={'drawer-scrim' + ((leftOpen || rightOpen) ? ' open' : '')}
        onClick={() => { setLeftOpen(false); setRightOpen(false) }}
      />
    </div>
  )
}
