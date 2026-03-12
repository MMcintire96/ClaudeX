import React from 'react'
import { useAutomationStore } from '../../stores/automationStore'

export default function TriageInbox() {
  const triageRuns = useAutomationStore(s => s.triageRuns)
  const automations = useAutomationStore(s => s.automations)
  const selectRun = useAutomationStore(s => s.selectRun)
  const setTriageStatus = useAutomationStore(s => s.setTriageStatus)
  const applyRun = useAutomationStore(s => s.applyRun)

  const getAutomationName = (automationId: string) =>
    automations.find(a => a.id === automationId)?.name ?? 'Unknown'

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    const now = Date.now()
    const diff = now - ts
    if (diff < 60_000) return 'Just now'
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
    return d.toLocaleDateString()
  }

  const formatDuration = (ms: number | null) => {
    if (ms === null) return '-'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}m`
  }

  // Group by automation
  const grouped: Record<string, typeof triageRuns> = {}
  for (const run of triageRuns) {
    const key = run.automationId
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(run)
  }

  const handleArchiveAll = () => {
    for (const run of triageRuns) {
      setTriageStatus(run.automationId, run.id, 'archived')
    }
  }

  if (triageRuns.length === 0) {
    return (
      <div className="triage-inbox">
        <div className="automation-empty">
          <p>No items in triage.</p>
          <p>Runs with findings will appear here for your review.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="triage-inbox">
      <div className="triage-inbox-header">
        <span>{triageRuns.length} item{triageRuns.length !== 1 ? 's' : ''} to review</span>
        <button className="btn btn-sm" onClick={handleArchiveAll}>Archive All</button>
      </div>

      {Object.entries(grouped).map(([automationId, runs]) => (
        <div key={automationId} className="triage-group">
          <div className="triage-group-header">
            <span className="triage-group-name">{getAutomationName(automationId)}</span>
            <span className="triage-group-count">{runs.length}</span>
          </div>

          {runs.map(run => (
            <div key={run.id} className="triage-run-card">
              <div className="triage-run-card-header" onClick={() => selectRun(run.automationId, run.id)}>
                <div className="triage-run-info">
                  <span className={`automation-run-status automation-run-status-${run.status}`}>
                    {run.status}
                  </span>
                  <span className="triage-run-project">{run.projectPath ? run.projectPath.split('/').pop() : 'No project'}</span>
                  <span className="triage-run-time">{formatTime(run.startedAt)}</span>
                  <span className="triage-run-duration">{formatDuration(run.durationMs)}</span>
                  {run.costUsd !== null && (
                    <span className="triage-run-cost">${run.costUsd.toFixed(4)}</span>
                  )}
                </div>
              </div>

              {/* Diff preview */}
              {run.diff && (
                <div className="triage-diff-preview" onClick={() => selectRun(run.automationId, run.id)}>
                  <pre>{run.diff.slice(0, 300)}{run.diff.length > 300 ? '...' : ''}</pre>
                </div>
              )}

              {/* Result summary preview */}
              {!run.diff && run.resultSummary && (
                <div className="triage-result-preview" onClick={() => selectRun(run.automationId, run.id)}>
                  <p>{run.resultSummary.slice(0, 200)}{run.resultSummary.length > 200 ? '...' : ''}</p>
                </div>
              )}

              <div className="triage-run-actions">
                <button className="btn btn-sm" onClick={() => selectRun(run.automationId, run.id)}>
                  View Details
                </button>
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => applyRun(run.automationId, run.id)}
                  disabled={!run.worktreeSessionId}
                >
                  Apply Changes
                </button>
                <button className="btn btn-sm" onClick={() => setTriageStatus(run.automationId, run.id, 'pinned')}>
                  Pin
                </button>
                <button className="btn btn-sm" onClick={() => setTriageStatus(run.automationId, run.id, 'archived')}>
                  Archive
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
