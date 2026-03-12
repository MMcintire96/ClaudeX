import React from 'react'
import { useAutomationStore } from '../../stores/automationStore'
import { formatSchedule } from './scheduleUtils'

export default function AutomationList({ searchFilter = '' }: { searchFilter?: string }) {
  const allAutomations = useAutomationStore(s => s.automations)
  const automations = searchFilter
    ? allAutomations.filter(a => a.name.toLowerCase().includes(searchFilter.toLowerCase()))
    : allAutomations
  const openEditor = useAutomationStore(s => s.openEditor)
  const triggerRun = useAutomationStore(s => s.triggerRun)
  const updateAutomation = useAutomationStore(s => s.updateAutomation)
  const deleteAutomation = useAutomationStore(s => s.deleteAutomation)

  const formatTime = (ts: number | null) => {
    if (!ts) return 'Never'
    const d = new Date(ts)
    const now = Date.now()
    const diff = now - ts
    if (diff < 60_000) return 'Just now'
    if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`
    return d.toLocaleDateString()
  }

  return (
    <div className="automation-list">
      <div className="automation-list-header">
        <span className="automation-list-count">{automations.length} automation{automations.length !== 1 ? 's' : ''}</span>
        <button className="btn btn-primary btn-sm" onClick={() => openEditor()}>
          + New Automation
        </button>
      </div>

      {automations.length === 0 ? (
        <div className="automation-empty">
          <p>No automations yet.</p>
          <p>Create an automation to run agent tasks on a schedule.</p>
          <button className="btn btn-primary" onClick={() => openEditor()}>
            Create your first automation
          </button>
        </div>
      ) : (
        <div className="automation-table">
          <div className="automation-table-header">
            <span className="automation-col-name">Name</span>
            <span className="automation-col-schedule">Schedule</span>
            <span className="automation-col-projects">Projects</span>
            <span className="automation-col-sandbox">Sandbox</span>
            <span className="automation-col-lastrun">Last Run</span>
            <span className="automation-col-runs">Runs</span>
            <span className="automation-col-actions">Actions</span>
          </div>
          {automations.map(auto => (
            <div
              key={auto.id}
              className={`automation-table-row ${!auto.enabled ? 'disabled' : ''}`}
              onClick={() => openEditor(auto.id)}
            >
              <span className="automation-col-name">
                <span className={`automation-enabled-dot ${auto.enabled ? 'on' : 'off'}`} />
                {auto.name}
              </span>
              <span className="automation-col-schedule">{formatSchedule(auto.schedule)}</span>
              <span className="automation-col-projects">
                {auto.projectPaths.length > 0 ? auto.projectPaths.map(p => p.split('/').pop()).join(', ') : 'No project'}
              </span>
              <span className="automation-col-sandbox">{auto.sandboxMode}</span>
              <span className="automation-col-lastrun">{formatTime(auto.lastRunAt)}</span>
              <span className="automation-col-runs">{auto.runCount}</span>
              <span className="automation-col-actions" onClick={e => e.stopPropagation()}>
                <button
                  className="btn btn-xs"
                  onClick={() => {
                    triggerRun(auto.id, auto.projectPaths[0] ?? null)
                  }}
                  title="Run now"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                </button>
                <button
                  className="btn btn-xs"
                  onClick={() => updateAutomation(auto.id, { enabled: !auto.enabled })}
                  title={auto.enabled ? 'Disable' : 'Enable'}
                >
                  {auto.enabled ? 'On' : 'Off'}
                </button>
                <button
                  className="btn btn-xs"
                  onClick={() => openEditor(auto.id)}
                  title="Edit"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  className="btn btn-xs btn-danger"
                  onClick={() => deleteAutomation(auto.id)}
                  title="Delete"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  </svg>
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
