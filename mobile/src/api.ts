// Lightweight API client + WS client for the mobile PWA.
// Token is stored in localStorage after pairing.

const TOKEN_KEY = 'claudex.token'
const DEVICE_ID_KEY = 'claudex.deviceId'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setAuth(token: string, deviceId: string): void {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(DEVICE_ID_KEY, deviceId)
}

export function clearAuth(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(DEVICE_ID_KEY)
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken()
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {})
    }
  })
  if (res.status === 401) {
    clearAuth()
    throw new Error('Unauthorized — re-pair this device.')
  }
  if (!res.ok) {
    let body = ''
    try { body = await res.text() } catch { /* ignore */ }
    throw new Error(`HTTP ${res.status}: ${body || res.statusText}`)
  }
  return (await res.json()) as T
}

export interface ApiSession {
  id: string
  projectPath: string
  name: string
  createdAt: number
  lastActiveAt: number
  model: string | null
  worktreePath: string | null
  isWorktree: boolean
}

export interface ApiSessionDetail extends ApiSession {
  messages: unknown[]
}

export const api = {
  async listSessions(): Promise<ApiSession[]> {
    const data = await http<{ sessions: ApiSession[] }>('/api/sessions')
    return data.sessions
  },
  async getSession(id: string): Promise<ApiSessionDetail> {
    return await http<ApiSessionDetail>(`/api/sessions/${encodeURIComponent(id)}`)
  },
  async send(sessionId: string, content: string): Promise<void> {
    await http<{ ok: boolean }>('/api/agent/send', {
      method: 'POST',
      body: JSON.stringify({ sessionId, content })
    })
  },
  async stop(sessionId: string): Promise<void> {
    await http<{ ok: boolean }>('/api/agent/stop', {
      method: 'POST',
      body: JSON.stringify({ sessionId })
    })
  },
  async setModel(sessionId: string, model: string | null): Promise<void> {
    await http<{ ok: boolean }>('/api/agent/set-model', {
      method: 'POST',
      body: JSON.stringify({ sessionId, model })
    })
  },
  async setEffort(sessionId: string, effort: string | null): Promise<void> {
    await http<{ ok: boolean }>('/api/agent/set-effort', {
      method: 'POST',
      body: JSON.stringify({ sessionId, effort })
    })
  },
  async status(sessionId: string): Promise<{ isRunning: boolean; hasSession: boolean }> {
    return await http(`/api/agent/status/${encodeURIComponent(sessionId)}`)
  },
  async redeemCode(code: string, label?: string): Promise<{ deviceId: string; token: string; label: string }> {
    return await http('/api/pair/redeem', {
      method: 'POST',
      body: JSON.stringify({ code, label })
    })
  },
  async vapidKey(): Promise<string> {
    const r = await http<{ publicKey: string }>('/api/push/vapid-public-key')
    return r.publicKey
  },
  async subscribePush(sub: PushSubscriptionJSON): Promise<void> {
    await http<{ ok: boolean }>('/api/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(sub)
    })
  },

  /** Generic RPC call. The backend allowlist is in src/main/remote/rpcHandlers.ts. */
  async rpc<T = unknown>(domain: string, method: string, args: unknown[] = []): Promise<T> {
    const res = await http<{ ok: boolean; result?: T; error?: string }>('/api/rpc', {
      method: 'POST',
      body: JSON.stringify({ domain, method, args })
    })
    if (!res.ok) throw new Error(res.error || 'rpc failed')
    return res.result as T
  }
}

// ---------- Strongly-typed RPC wrappers ----------

export interface GitFile { path: string; index: string; working_dir: string }
export interface GitStatus {
  files: GitFile[]
  staged: string[]
  modified: string[]
  not_added: string[]
  deleted: string[]
  renamed: Array<{ from: string; to: string }>
  conflicted: string[]
  isClean: boolean
}
export interface GitDiffSummary {
  changed: number
  insertions: number
  deletions: number
  files: Array<{ file: string; changes: number; insertions: number; deletions: number }>
}
export interface RecentProject { path: string; name: string; lastOpened: number }
export interface StartAction { name: string; command: string; autoRun?: boolean }
export interface StartConfig { actions?: StartAction[]; defaultAction?: string }
export const project = {
  recent: () => api.rpc<RecentProject[]>('project', 'recent'),
  status: (path: string) => api.rpc<{ ok: boolean; status?: GitStatus; error?: string }>('project', 'gitStatus', [path]),
  branch: (path: string) => api.rpc<{ ok: boolean; branch: string | null }>('project', 'gitBranch', [path]),
  diffSummary: (path: string, staged = false) =>
    api.rpc<{ ok: boolean; summary?: GitDiffSummary; error?: string }>('project', 'gitDiffSummary', [path, staged]),
  diffFile: (path: string, filePath: string, untracked = false, fullFile = false) =>
    api.rpc<{ ok: boolean; diff?: string; error?: string }>('project', 'diffFile', [path, filePath, untracked, fullFile]),
  log: (path: string, max = 20) =>
    api.rpc<{ ok: boolean; log?: { all: Array<{ hash: string; date: string; message: string; author_name: string }> } }>('project', 'gitLog', [path, max]),
  add: (path: string, files?: string[]) =>
    api.rpc<{ ok: boolean; error?: string }>('project', 'gitAdd', [path, files]),
  commit: (path: string, message: string) =>
    api.rpc<{ ok: boolean; commit?: string; error?: string }>('project', 'gitCommit', [path, message]),
  push: (path: string) => api.rpc<{ ok: boolean; error?: string }>('project', 'gitPush', [path]),
  pull: (path: string) => api.rpc<{ ok: boolean; error?: string }>('project', 'gitPull', [path]),
  startConfig: (path: string) =>
    api.rpc<{ ok: boolean; config: StartConfig | null }>('project', 'getStartConfig', [path]),
  runStart: (path: string) =>
    api.rpc<{ ok: boolean; terminalIds?: string[]; error?: string }>('project', 'runStart', [path])
}

/**
 * Desktop settings shape. Only the fields the phone uses are typed; everything
 * else is preserved on the server.
 */
export interface DesktopSettings {
  theme?: string
  defaultModel?: string
  defaultEffort?: string
  notificationSounds?: boolean
  claude?: {
    dangerouslySkipPermissions?: boolean
  }
}

export const desktopSettings = {
  get: () => api.rpc<{ ok: boolean; settings: DesktopSettings }>('settings', 'get'),
  update: (partial: Partial<DesktopSettings>) =>
    api.rpc<{ ok: boolean; settings: DesktopSettings }>('settings', 'update', [partial])
}

export const appState = {
  get: () => api.rpc<{ ok: boolean; theme: string; activeProjectPath: string | null }>('appState', 'get')
}

// --- WebSocket client with reconnect + last-seq replay ---

export interface WsHello {
  type: 'hello'
  deviceId: string
  seq: number
}
export interface WsEvent {
  type: 'event'
  seq: number
  channel: string
  args: unknown[]
}
export type WsMessage = WsHello | WsEvent | { type: 'pong'; seq: number }

export interface WsClient {
  start(): void
  stop(): void
  on(handler: (msg: WsMessage) => void): () => void
}

export function createWsClient(): WsClient {
  const handlers = new Set<(msg: WsMessage) => void>()
  let ws: WebSocket | null = null
  let stopped = false
  let lastSeq = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  function url(): string {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const token = getToken() ?? ''
    return `${proto}://${location.host}/api/events?token=${encodeURIComponent(token)}&since=${lastSeq}`
  }

  function connect(): void {
    if (stopped) return
    try {
      ws = new WebSocket(url())
    } catch (err) {
      console.warn('ws connect failed:', err)
      scheduleReconnect()
      return
    }
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as WsMessage
        if (msg.type === 'event' || msg.type === 'hello') lastSeq = Math.max(lastSeq, msg.seq)
        for (const h of handlers) h(msg)
      } catch { /* ignore */ }
    }
    ws.onclose = () => { ws = null; scheduleReconnect() }
    ws.onerror = () => { ws?.close() }
  }

  function scheduleReconnect(): void {
    if (stopped) return
    if (reconnectTimer) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connect()
    }, 1500)
  }

  return {
    start(): void {
      stopped = false
      connect()
    },
    stop(): void {
      stopped = true
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null }
      if (ws) { try { ws.close() } catch { /* ignore */ } }
      ws = null
    },
    on(h): () => void {
      handlers.add(h)
      return () => { handlers.delete(h) }
    }
  }
}
