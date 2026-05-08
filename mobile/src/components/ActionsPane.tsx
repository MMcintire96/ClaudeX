import { useCallback, useEffect, useState } from 'react'
import { project, StartConfig } from '../api'
import { getSelectedProjectPath, useSnapshot } from '../state/store'
import { ArrowDownIcon, ArrowUpIcon, GitCommitIcon, PlayIcon } from './Icons'

type ActionState =
  | { kind: 'idle' }
  | { kind: 'running'; label: string }
  | { kind: 'done'; label: string; result?: string }
  | { kind: 'failed'; label: string; error: string }

export function ActionsPane(): JSX.Element {
  useSnapshot(() => Date.now())
  const path = getSelectedProjectPath()
  const [config, setConfig] = useState<StartConfig | null>(null)
  const [commitMsg, setCommitMsg] = useState('')
  const [action, setAction] = useState<ActionState>({ kind: 'idle' })

  const load = useCallback(async () => {
    if (!path) return
    try {
      const c = await project.startConfig(path)
      setConfig(c.config ?? null)
    } catch {
      /* ignore */
    }
  }, [path])

  useEffect(() => {
    void load()
  }, [load])

  const run = useCallback(async (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setAction({ kind: 'running', label })
    try {
      const r = await fn()
      if (r.ok) setAction({ kind: 'done', label })
      else setAction({ kind: 'failed', label, error: r.error || 'failed' })
    } catch (err) {
      setAction({ kind: 'failed', label, error: (err as Error).message })
    }
  }, [])

  const doPull = (): void => {
    if (!path) return
    void run('git pull', () => project.pull(path))
  }
  const doPush = (): void => {
    if (!path) return
    void run('git push', () => project.push(path))
  }
  const doCommit = async (): Promise<void> => {
    if (!path || !commitMsg.trim()) return
    setAction({ kind: 'running', label: 'commit' })
    try {
      const addRes = await project.add(path)
      if (!addRes.ok) {
        setAction({ kind: 'failed', label: 'commit', error: addRes.error || 'git add failed' })
        return
      }
      const commitRes = await project.commit(path, commitMsg.trim())
      if (commitRes.ok) {
        setCommitMsg('')
        setAction({ kind: 'done', label: 'commit', result: commitRes.commit })
      } else {
        setAction({ kind: 'failed', label: 'commit', error: commitRes.error || 'commit failed' })
      }
    } catch (err) {
      setAction({ kind: 'failed', label: 'commit', error: (err as Error).message })
    }
  }
  const doRunStart = (): void => {
    if (!path) return
    void run('start config', () => project.runStart(path))
  }

  if (!path) {
    return <div className="empty">Pick a project on the Project tab first.</div>
  }

  return (
    <div className="actions-pane-content">
      {action.kind === 'running' && (
        <div className="banner-info">Running {action.label}…</div>
      )}
      {action.kind === 'done' && (
        <div className="banner-success">
          {action.label} done{action.result ? ` · ${action.result.slice(0, 8)}` : ''}
        </div>
      )}
      {action.kind === 'failed' && (
        <div className="banner-error">{action.label}: {action.error}</div>
      )}

      <section className="actions-section">
        <h2>Git</h2>
        <div className="actions-row">
          <button className="btn-secondary" onClick={doPull}>
            <ArrowDownIcon size={14} /> Pull
          </button>
          <button className="btn-secondary" onClick={doPush}>
            <ArrowUpIcon size={14} /> Push
          </button>
        </div>
        <div className="commit-row">
          <textarea
            value={commitMsg}
            onChange={e => setCommitMsg(e.target.value)}
            placeholder="Commit message…"
            rows={2}
          />
          <button className="btn-primary" disabled={!commitMsg.trim()} onClick={() => void doCommit()}>
            <GitCommitIcon size={14} /> Add &amp; commit
          </button>
        </div>
      </section>

      {config?.actions && config.actions.length > 0 && (
        <section className="actions-section">
          <h2>Start config</h2>
          <p className="muted">
            {config.actions.length} action{config.actions.length === 1 ? '' : 's'} defined for this project.
          </p>
          <div className="actions-row">
            <button className="btn-secondary" onClick={doRunStart}>
              <PlayIcon size={14} /> Run start config
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
