import { useCallback, useEffect, useState } from 'react'

interface PairData {
  code: string
  expiresAt: number
  url: string
  qrDataUrl: string
  bindHost: string
  bindSource: 'env' | 'tailscale' | 'localhost'
  port: number
}

interface DeviceRow {
  id: string
  label: string
  pairedAt: number
  lastSeenAt: number
  hasPush: boolean
}

interface RemoteStatus {
  running: boolean
  bindHost: string
  bindSource: 'env' | 'tailscale' | 'localhost'
  port: number
  configuredPort: number | null
  lastError: string | null
  devices: DeviceRow[]
}

export default function RemotePairingSection(): JSX.Element {
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [pair, setPair] = useState<PairData | null>(null)
  const [busy, setBusy] = useState(false)
  const [busyAction, setBusyAction] = useState<'start' | 'stop' | 'restart' | 'pair' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [portInput, setPortInput] = useState<string>('')
  const [portDirty, setPortDirty] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const s = await window.api.remote.status()
      setStatus(s)
      // Only sync the input field from server if the user hasn't edited it.
      if (!portDirty) {
        setPortInput(s.configuredPort != null ? String(s.configuredPort) : '')
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }, [portDirty])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Live status updates pushed from main process (no polling needed).
  useEffect(() => {
    const off = window.api.remote.onStatusChanged((s) => {
      setStatus(prev => ({
        ...(prev ?? { devices: [] as DeviceRow[] }),
        running: s.running,
        bindHost: s.bindHost,
        bindSource: s.bindSource,
        port: s.port,
        configuredPort: s.configuredPort,
        lastError: s.lastError
      } as RemoteStatus))
      if (!portDirty) {
        setPortInput(s.configuredPort != null ? String(s.configuredPort) : '')
      }
    })
    return off
  }, [portDirty])

  // Tick once a second so the countdown display updates.
  useEffect(() => {
    if (!pair) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [pair])

  // Poll device list while a pair code is active so the UI updates when the
  // phone successfully pairs.
  useEffect(() => {
    if (!pair) return
    const id = setInterval(() => { void refresh() }, 2000)
    return () => clearInterval(id)
  }, [pair, refresh])

  const startPairing = useCallback(async () => {
    setBusy(true)
    setBusyAction('pair')
    setError(null)
    try {
      const data = await window.api.remote.pairStart('iPhone')
      setPair(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
      setBusyAction(null)
    }
  }, [])

  const revoke = useCallback(async (id: string) => {
    try {
      await window.api.remote.pairRevoke(id)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    }
  }, [refresh])

  const startServer = useCallback(async () => {
    setBusy(true)
    setBusyAction('start')
    setError(null)
    try {
      const r = await window.api.remote.start()
      if (!r.ok) setError(r.error || 'Failed to start remote server')
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
      setBusyAction(null)
    }
  }, [refresh])

  const stopServer = useCallback(async () => {
    setBusy(true)
    setBusyAction('stop')
    setError(null)
    try {
      const r = await window.api.remote.stop()
      if (!r.ok) setError(r.error || 'Failed to stop remote server')
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
      setBusyAction(null)
    }
  }, [refresh])

  const applyPort = useCallback(async () => {
    setBusy(true)
    setBusyAction('restart')
    setError(null)
    try {
      const trimmed = portInput.trim()
      let port: number | null
      if (trimmed === '') {
        port = null
      } else {
        const n = Number(trimmed)
        if (!Number.isInteger(n) || n < 1024 || n > 65535) {
          setError('Port must be an integer between 1024 and 65535, or empty for auto-assigned.')
          setBusy(false)
          setBusyAction(null)
          return
        }
        port = n
      }
      const r = await window.api.remote.restart(port)
      if (!r.ok) setError(r.error || 'Failed to restart remote server')
      setPortDirty(false)
      await refresh()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
      setBusyAction(null)
    }
  }, [portInput, refresh])

  const codeExpired = pair ? now >= pair.expiresAt : false
  const remainingSec = pair ? Math.max(0, Math.ceil((pair.expiresAt - now) / 1000)) : 0

  const sourceWarning = status && status.bindSource !== 'tailscale'
    ? `Server is bound to ${status.bindHost} (${status.bindSource}). For phone access, install Tailscale on both devices so the remote server binds to the tailnet interface.`
    : null

  const running = !!status?.running
  const statusLabel = running
    ? `Running on http://${status!.bindHost}:${status!.port}`
    : 'Stopped'

  return (
    <div className="settings-card">
      <div className="settings-card-header">
        <h2 className="settings-card-title">Remote (iPhone)</h2>
        <p className="settings-card-description">
          Pair your phone to continue chats from your laptop.
        </p>
      </div>
      <div className="settings-card-body">
        {status && (
          <div className="settings-field">
            <label className="settings-field-label">Server</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                aria-label={running ? 'running' : 'stopped'}
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: running ? '#3fb950' : '#8b949e'
                }}
              />
              <code style={{ fontSize: 13 }}>{statusLabel}</code>
            </div>
            {!running && (
              <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                Pairing and remote sessions are unavailable while the server is stopped.
              </div>
            )}
          </div>
        )}

        {status?.lastError && (
          <div className="settings-warning">Server error: {status.lastError}</div>
        )}
        {sourceWarning && (
          <div className="settings-warning">{sourceWarning}</div>
        )}
        {error && <div className="settings-warning">{error}</div>}

        <div className="settings-field">
          <label className="settings-field-label">Port</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              className="settings-input"
              type="number"
              min={1024}
              max={65535}
              placeholder="auto"
              value={portInput}
              onChange={(e) => { setPortInput(e.target.value); setPortDirty(true) }}
              style={{ width: 120 }}
            />
            <button
              className="settings-btn"
              onClick={() => void applyPort()}
              disabled={busy || !portDirty}
            >
              {busyAction === 'restart' ? 'Restarting…' : 'Save & Restart'}
            </button>
          </div>
          <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
            Leave empty to let the OS assign a random port. Set a fixed port if you want
            phone bookmarks, installed PWAs, and push subscriptions to survive restarts.
          </div>
        </div>

        <div className="settings-field" style={{ display: 'flex', gap: 8 }}>
          {running ? (
            <button
              className="settings-btn settings-btn-danger"
              onClick={() => void stopServer()}
              disabled={busy}
            >
              {busyAction === 'stop' ? 'Stopping…' : 'Stop Server'}
            </button>
          ) : (
            <button
              className="settings-btn"
              onClick={() => void startServer()}
              disabled={busy}
            >
              {busyAction === 'start' ? 'Starting…' : 'Start Server'}
            </button>
          )}
          <button
            className="settings-btn"
            onClick={() => void startPairing()}
            disabled={busy || !running}
            title={!running ? 'Start the server first' : undefined}
          >
            {busyAction === 'pair' ? 'Generating…' : 'Pair iPhone'}
          </button>
        </div>

        {pair && !codeExpired && (
          <div className="settings-pair-card">
            <div className="settings-pair-grid">
              <img
                src={pair.qrDataUrl}
                alt="Pairing QR"
                style={{ width: 180, height: 180, borderRadius: 8, background: 'white' }}
              />
              <div>
                <div className="settings-pair-label">Code</div>
                <a
                  href={pair.url}
                  target="_blank"
                  rel="noreferrer"
                  className="settings-pair-code"
                  style={{ textDecoration: 'none', color: 'inherit' }}
                  title="Open pairing URL"
                >{pair.code}</a>
                <div className="settings-pair-label" style={{ marginTop: 12 }}>URL</div>
                <a href={pair.url} target="_blank" rel="noreferrer" style={{ fontSize: 12, wordBreak: 'break-all' }}>{pair.url}</a>
                <div className="settings-pair-label" style={{ marginTop: 12 }}>
                  Expires in {remainingSec}s
                </div>
              </div>
            </div>
            <p className="settings-card-description" style={{ marginTop: 12 }}>
              On your phone, open the URL above in Safari, then enter this code. Add the page to
              your Home Screen first so push notifications work.
            </p>
          </div>
        )}
        {pair && codeExpired && (
          <div className="settings-warning">Pairing code expired — click Pair iPhone to generate a new one.</div>
        )}

        {status && status.devices.length > 0 && (
          <div className="settings-field" style={{ marginTop: 16 }}>
            <label className="settings-field-label">Paired devices</label>
            <ul className="settings-list">
              {status.devices.map(d => (
                <li key={d.id} className="settings-list-row">
                  <div>
                    <div style={{ fontWeight: 500 }}>{d.label}</div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>
                      paired {new Date(d.pairedAt).toLocaleString()} · last seen {new Date(d.lastSeenAt).toLocaleString()}
                      {d.hasPush ? ' · push enabled' : ''}
                    </div>
                  </div>
                  <button className="settings-btn settings-btn-danger" onClick={() => void revoke(d.id)}>
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
