import React, { useEffect, useState } from 'react'
import { useAutomationStore, type AutomationRun } from '../../stores/automationStore'

export default function RunDetail() {
  const selectedAutomationId = useAutomationStore(s => s.selectedAutomationId)
  const selectedRunId = useAutomationStore(s => s.selectedRunId)
  const runs = useAutomationStore(s => s.runs)
  const automations = useAutomationStore(s => s.automations)
  const setView = useAutomationStore(s => s.setView)
  const selectRun = useAutomationStore(s => s.selectRun)
  const setTriageStatus = useAutomationStore(s => s.setTriageStatus)
  const applyRun = useAutomationStore(s => s.applyRun)

  const [applyResult, setApplyResult] = useState<{ success: boolean; error?: string } | null>(null)

  const automation = automations.find(a => a.id === selectedAutomationId)
  const automationRuns = selectedAutomationId ? (runs[selectedAutomationId] ?? []) : []
  const run = automationRuns.find(r => r.id === selectedRunId) ?? null

  // If run not found in store, try loading fresh
  useEffect(() => {
    if (!run && selectedAutomationId && selectedRunId) {
      // Could fetch individually but the store should have it from loadRuns
    }
  }, [run, selectedAutomationId, selectedRunId])

  if (!run || !selectedAutomationId) {
    return <div className="automation-empty">Run not found</div>
  }

  const formatTime = (ts: number) => new Date(ts).toLocaleString()

  const formatDuration = (ms: number | null) => {
    if (ms === null) return '-'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}m`
  }

  const handleApply = async () => {
    const result = await applyRun(selectedAutomationId, run.id)
    setApplyResult(result)
  }

  return (
    <div className="run-detail">
      <div className="run-detail-header">
        <button
          className="automation-back-link"
          onClick={() => selectRun(selectedAutomationId, null)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Back to {automation?.name ?? 'automation'}
        </button>
      </div>

      <div className="run-detail-info">
        <div className="run-detail-title-row">
          <h3>Run {run.id.slice(0, 8)}</h3>
          <div className="run-detail-badges">
            <span className={`automation-run-status automation-run-status-${run.status}`}>
              {run.status}
            </span>
            <span className={`automation-triage-badge automation-triage-${run.triageStatus}`}>
              {run.triageStatus}
            </span>
          </div>
        </div>

        <div className="run-detail-meta">
          <div className="run-detail-meta-row">
            <span>Project: <strong>{run.projectPath ? run.projectPath.split('/').pop() : 'No project'}</strong></span>
            <span>Started: {formatTime(run.startedAt)}</span>
            {run.completedAt && <span>Completed: {formatTime(run.completedAt)}</span>}
          </div>
          <div className="run-detail-meta-row">
            <span>Duration: {formatDuration(run.durationMs)}</span>
            {run.costUsd !== null && <span>Cost: ${run.costUsd.toFixed(4)}</span>}
            {run.numTurns !== null && <span>Turns: {run.numTurns}</span>}
          </div>
        </div>

        {/* Actions */}
        <div className="run-detail-actions">
          {run.triageStatus !== 'archived' && (
            <button className="btn btn-sm" onClick={() => setTriageStatus(selectedAutomationId, run.id, 'archived')}>
              Archive
            </button>
          )}
          {run.triageStatus !== 'pinned' && (
            <button className="btn btn-sm" onClick={() => setTriageStatus(selectedAutomationId, run.id, 'pinned')}>
              Pin
            </button>
          )}
          {run.worktreeSessionId && run.triageStatus !== 'archived' && (
            <button className="btn btn-sm btn-primary" onClick={handleApply}>
              Apply Changes to Project
            </button>
          )}
        </div>

        {applyResult && (
          <div className={`run-detail-apply-result ${applyResult.success ? 'success' : 'error'}`}>
            {applyResult.success
              ? 'Changes applied successfully and run archived.'
              : `Failed to apply: ${applyResult.error}`}
          </div>
        )}

        {/* Error */}
        {run.error && (
          <div className="run-detail-error">
            <h4>Error</h4>
            <pre>{run.error}</pre>
          </div>
        )}

        {/* Result Summary */}
        {run.resultSummary && (
          <div className="run-detail-section">
            <h4>Result Summary</h4>
            <pre className="run-detail-result">{run.resultSummary}</pre>
          </div>
        )}

        {/* Diff */}
        {run.diff && (
          <div className="run-detail-section">
            <h4>Diff</h4>
            <pre className="run-detail-diff">{run.diff}</pre>
          </div>
        )}

        {/* Agent Messages */}
        {run.agentMessages.length > 0 && (
          <div className="run-detail-section">
            <h4>Agent Log ({run.agentMessages.length} messages)</h4>
            <div className="run-detail-messages">
              {run.agentMessages.map((msg, i) => (
                <div key={i} className={`run-detail-message run-detail-message-${msg.role}`}>
                  <div className="run-detail-message-header">
                    <span className="run-detail-message-role">{msg.role}</span>
                    {msg.toolName && <span className="run-detail-message-tool">{msg.toolName}</span>}
                    <span className="run-detail-message-type">{msg.type}</span>
                  </div>
                  <pre className="run-detail-message-content">{msg.content}</pre>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
