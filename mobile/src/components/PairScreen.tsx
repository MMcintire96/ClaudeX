import { useState } from 'react'
import { api } from '../api'

interface Props {
  onPaired: (token: string, deviceId: string) => void
}

export function PairScreen({ onPaired }: Props): JSX.Element {
  const [code, setCode] = useState('')
  const [label, setLabel] = useState('iPhone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // If the URL is /pair?code=ABCD, prefill the code.
  useState(() => {
    const params = new URLSearchParams(location.search)
    const c = params.get('code')
    if (c) setCode(c.toUpperCase())
  })

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.redeemCode(code.trim().toUpperCase(), label.trim() || 'iPhone')
      onPaired(res.token, res.deviceId)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pair-screen">
      <div className="pair-card">
        <h1>Pair this device</h1>
        <p className="pair-hint">
          On your laptop, open ClaudeX → Settings → Pair iPhone. Enter the code shown there.
        </p>
        <label className="field">
          <span>Pairing code</span>
          <input
            inputMode="text"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABCD1234"
          />
        </label>
        <label className="field">
          <span>Device label</span>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="iPhone"
          />
        </label>
        {error && <div className="pair-error">{error}</div>}
        <button className="btn-primary" onClick={() => void submit()} disabled={!code || busy}>
          {busy ? 'Pairing…' : 'Pair'}
        </button>
        <p className="pair-tip">
          Add this page to your Home Screen first to enable push notifications when an agent needs input.
        </p>
      </div>
    </div>
  )
}
