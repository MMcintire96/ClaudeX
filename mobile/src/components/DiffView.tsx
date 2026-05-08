import { useEffect, useState } from 'react'
import { project } from '../api'

interface Props {
  projectPath: string
  filePath: string
  untracked: boolean
  onBack: () => void
}

interface Line { type: 'add' | 'del' | 'ctx' | 'hunk' | 'meta'; text: string }

function parseDiff(diff: string): Line[] {
  const out: Line[] = []
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('@@')) out.push({ type: 'hunk', text: raw })
    else if (raw.startsWith('diff ') || raw.startsWith('index ') || raw.startsWith('--- ') || raw.startsWith('+++ ')) {
      out.push({ type: 'meta', text: raw })
    } else if (raw.startsWith('+')) out.push({ type: 'add', text: raw.slice(1) })
    else if (raw.startsWith('-')) out.push({ type: 'del', text: raw.slice(1) })
    else if (raw.startsWith(' ')) out.push({ type: 'ctx', text: raw.slice(1) })
    else if (raw.length > 0) out.push({ type: 'ctx', text: raw })
  }
  return out
}

export function DiffView({ projectPath, filePath, untracked, onBack }: Props): JSX.Element {
  const [diff, setDiff] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    project.diffFile(projectPath, filePath, untracked, false)
      .then(r => {
        if (cancelled) return
        if (r.ok) setDiff(r.diff || '')
        else setError(r.error || 'failed')
      })
      .catch(e => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [projectPath, filePath, untracked])

  const lines = diff ? parseDiff(diff) : []

  return (
    <div className="diff-view">
      <header className="chat-header">
        <button className="icon-btn" onClick={onBack} aria-label="Back">‹</button>
        <div className="chat-title">{filePath}</div>
        {untracked && <span className="badge">new</span>}
      </header>
      <div className="diff-body">
        {loading && <div className="empty-mini">Loading…</div>}
        {error && <div className="banner-error">{error}</div>}
        {!loading && !error && lines.length === 0 && (
          <div className="empty-mini">No diff (file unchanged)</div>
        )}
        {lines.map((line, i) => (
          <pre key={i} className={'diff-line ' + line.type}>{line.text || ' '}</pre>
        ))}
      </div>
    </div>
  )
}
