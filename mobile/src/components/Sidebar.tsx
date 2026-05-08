import { useEffect, useState } from 'react'
import type { ApiSession } from '../api'
import { api } from '../api'
import { getSlim, useSnapshot } from '../state/store'
import { sessionNeedsInput } from '@shared/sessionEvents'
import { BellIcon, RefreshIcon } from './Icons'

interface Props {
  sessions: ApiSession[]
  activeSessionId: string | null
  onSelect: (id: string) => void
  onRefresh: () => Promise<void>
  onSignOut: () => void
  error: string | null
}

// onSignOut kept in props for parent symmetry; sign-out lives in Settings tab now.
export function Sidebar({ sessions, activeSessionId, onSelect, onRefresh, error }: Props): JSX.Element {
  const [refreshing, setRefreshing] = useState(false)
  // Force re-render on event stream so "needs input" badges update.
  useSnapshot(() => Date.now())

  useEffect(() => {
    void onRefresh()
  }, [onRefresh])

  const refresh = async (): Promise<void> => {
    setRefreshing(true)
    try { await onRefresh() } finally { setRefreshing(false) }
  }

  const enablePush = async (): Promise<void> => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return
    if (Notification.permission !== 'granted') {
      const r = await Notification.requestPermission()
      if (r !== 'granted') return
    }
    try {
      const reg = await navigator.serviceWorker.ready
      const key = await api.vapidKey()
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key)
      })
      await api.subscribePush(sub.toJSON() as PushSubscriptionJSON)
    } catch (err) {
      console.warn('push subscribe failed', err)
    }
  }

  const sorted = [...sessions].sort((a, b) => b.lastActiveAt - a.lastActiveAt)

  return (
    <div className="sidebar-content">
      <header className="drawer-header">
        <h1>Sessions</h1>
        <div className="drawer-actions">
          <button className="icon-btn" onClick={() => void refresh()} disabled={refreshing} title="Refresh" aria-label="Refresh">
            <RefreshIcon size={16} />
          </button>
          <button className="icon-btn" onClick={() => void enablePush()} title="Enable notifications" aria-label="Notifications">
            <BellIcon size={16} />
          </button>
        </div>
      </header>
      {error && <div className="banner-error">{error}</div>}
      {sorted.length === 0 && (
        <div className="empty">No sessions yet. Start one on your laptop.</div>
      )}
      <ul className="session-list">
        {sorted.map((s) => {
          const slim = getSlim(s.id)
          const needsInput = sessionNeedsInput(slim)
          const projectName = s.projectPath.split('/').pop() || s.projectPath
          return (
            <li
              key={s.id}
              className={'session-item' + (s.id === activeSessionId ? ' active' : '')}
              onClick={() => onSelect(s.id)}
            >
              <div className="session-row">
                <span className="session-name">{s.name || 'Session'}</span>
                {needsInput && <span className="badge">needs input</span>}
                {slim.isStreaming && <span className="badge streaming">streaming</span>}
              </div>
              <div className="session-meta">
                <span className="project">{projectName}</span>
                <span className="dot">·</span>
                <span className="time">{formatRelative(s.lastActiveAt)}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function formatRelative(ts: number): string {
  const d = Date.now() - ts
  const m = Math.floor(d / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  return `${days}d ago`
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
