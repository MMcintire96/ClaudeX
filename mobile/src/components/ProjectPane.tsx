import { useCallback, useEffect, useState } from 'react'
import { project, GitDiffSummary, GitStatus } from '../api'
import {
  getProjects,
  getSelectedProjectPath,
  setProjects,
  setSelectedProjectPath,
  useSnapshot
} from '../state/store'
import { RefreshIcon } from './Icons'

interface Props {
  onOpenDiff: (projectPath: string, filePath: string, untracked: boolean) => void
}

export function ProjectPane({ onOpenDiff }: Props): JSX.Element {
  useSnapshot(() => Date.now())
  const projects = getProjects()
  const selectedPath = getSelectedProjectPath()
  const [branch, setBranch] = useState<string | null>(null)
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [summary, setSummary] = useState<GitDiffSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const loadProjects = useCallback(async () => {
    try {
      const list = await project.recent()
      setProjects(list)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const loadProjectInfo = useCallback(async (path: string) => {
    setError(null)
    try {
      const [b, s, ds] = await Promise.all([
        project.branch(path),
        project.status(path),
        project.diffSummary(path, false)
      ])
      setBranch(b.branch ?? null)
      setStatus(s.status ?? null)
      setSummary(ds.summary ?? null)
    } catch (err) {
      setError((err as Error).message)
      setStatus(null)
      setSummary(null)
    }
  }, [])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  useEffect(() => {
    if (selectedPath) void loadProjectInfo(selectedPath)
  }, [selectedPath, loadProjectInfo])

  const refresh = async (): Promise<void> => {
    if (!selectedPath) return
    setRefreshing(true)
    try {
      await loadProjectInfo(selectedPath)
    } finally {
      setRefreshing(false)
    }
  }

  const projectName = (p: string): string => p.split('/').pop() || p

  // Build a unified file list: tracked + untracked, sorted.
  const untrackedSet = new Set(status?.not_added ?? [])
  const fileList = summary?.files ?? []

  return (
    <div className="project-pane-content">
      <header className="drawer-header">
        <h1>Project</h1>
        <div className="drawer-actions">
          <button className="icon-btn" onClick={() => void refresh()} disabled={refreshing} title="Refresh" aria-label="Refresh">
            <RefreshIcon size={16} />
          </button>
        </div>
      </header>

      {projects.length > 1 && (
        <div className="project-picker">
          {projects.map(p => (
            <button
              key={p.path}
              className={'chip' + (p.path === selectedPath ? ' active' : '')}
              onClick={() => setSelectedProjectPath(p.path)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}

      {selectedPath ? (
        <>
          <div className="project-meta">
            <div className="project-meta-row">
              <span className="meta-label">Project</span>
              <span className="meta-value">{projectName(selectedPath)}</span>
            </div>
            <div className="project-meta-row">
              <span className="meta-label">Branch</span>
              <span className="meta-value">{branch ?? '—'}</span>
            </div>
            {status && (
              <div className="project-meta-row">
                <span className="meta-label">Status</span>
                <span className="meta-value">
                  {status.isClean
                    ? 'clean'
                    : `${status.modified.length}M · ${status.not_added.length}? · ${status.deleted.length}D · ${status.staged.length}S`}
                </span>
              </div>
            )}
            {summary && summary.changed > 0 && (
              <div className="project-meta-row">
                <span className="meta-label">Changes</span>
                <span className="meta-value">
                  +{summary.insertions} −{summary.deletions} across {summary.changed} files
                </span>
              </div>
            )}
          </div>

          {error && <div className="banner-error">{error}</div>}

          <div className="files-section">
            <div className="files-section-head">Changed files</div>
            {fileList.length === 0 && (status?.not_added.length ?? 0) === 0 && (
              <div className="empty-mini">No file changes</div>
            )}
            <ul className="file-list">
              {fileList.map(f => {
                const untracked = untrackedSet.has(f.file)
                return (
                  <li
                    key={f.file}
                    className="file-row"
                    onClick={() => onOpenDiff(selectedPath, f.file, untracked)}
                  >
                    <span className={'file-mark' + (untracked ? ' new' : '')}>
                      {untracked ? '?' : 'M'}
                    </span>
                    <span className="file-path">{f.file}</span>
                    <span className="file-stats">
                      <span className="ins">+{f.insertions}</span>
                      <span className="del">−{f.deletions}</span>
                    </span>
                  </li>
                )
              })}
              {/* Untracked files not in summary (the diffSummary skips truly-new content) */}
              {(status?.not_added ?? [])
                .filter(p => !fileList.some(f => f.file === p))
                .map(p => (
                  <li key={p} className="file-row" onClick={() => onOpenDiff(selectedPath, p, true)}>
                    <span className="file-mark new">?</span>
                    <span className="file-path">{p}</span>
                    <span className="file-stats" />
                  </li>
                ))}
            </ul>
          </div>
        </>
      ) : (
        <div className="empty">No projects yet — open one on your laptop.</div>
      )}
    </div>
  )
}
