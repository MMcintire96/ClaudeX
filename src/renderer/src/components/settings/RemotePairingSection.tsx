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

export default function RemotePairingSection(): JSX.Element {
  const [status, setStatus] = useState<{
    bindHost: string
    bindSource: 'env' | 'tailscale' | 'localhost'
    port: number
    devices: DeviceRow[]
  } | null>(null)
  const [pair, setPair] = useState<PairData | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())

  const refresh = useCallback(async () => {
    try {
      const s = await window.api.remote.status()
      setStatus(s)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

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
    setError(null)
    try {
      const data = await window.api.remote.pairStart('iPhone')
      setPair(data)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
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

  const codeExpired = pair ? now >= pair.expiresAt : false
  const remainingSec = pair ? Math.max(0, Math.ceil((pair.expiresAt - now) / 1000)) : 0

  const sourceWarning = status && status.bindSource !== 'tailscale'
    ? `Server is bound to ${status.bindHost} (${status.bindSource}). For phone access, install Tailscale on both devices so the remote server binds to the tailnet interface.`
    : null

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
            <code style={{ fontSize: 13 }}>http://{status.bindHost}:{status.port}</code>
          </div>
        )}
        {sourceWarning && (
          <div className="settings-warning">{sourceWarning}</div>
        )}
        {error && <div className="settings-warning">{error}</div>}

        <div className="settings-field">
          <button className="settings-btn" onClick={() => void startPairing()} disabled={busy}>
            {busy ? 'Generating…' : 'Pair iPhone'}
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
                <div className="settings-pair-code">{pair.code}</div>
                <div className="settings-pair-label" style={{ marginTop: 12 }}>URL</div>
                <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{pair.url}</code>
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
