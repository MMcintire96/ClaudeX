import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useAutomationStore, type AutomationSchedule } from '../../stores/automationStore'
import { AVAILABLE_MODELS, DEFAULT_MODEL, DEFAULT_EFFORT, getModelEffortLevels, type EffortLevel } from '../../constants/models'

const EFFORT_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  max: 'Max',
}

const SCHEDULE_TYPES = [
  { value: 'manual', label: 'Manual (on-demand only)' },
  { value: 'interval', label: 'Every N minutes' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays (Mon–Fri)' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'cron', label: 'Cron expression' }
]

const SANDBOX_MODES = [
  { value: 'read-only', label: 'Read-only' },
  { value: 'workspace-write', label: 'Workspace-write' },
  { value: 'full-access', label: 'Full access' }
]

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function AutomationEditor() {
  const closeEditor = useAutomationStore(s => s.closeEditor)
  const editingId = useAutomationStore(s => s.editingAutomationId)
  const automations = useAutomationStore(s => s.automations)
  const createAutomation = useAutomationStore(s => s.createAutomation)
  const updateAutomation = useAutomationStore(s => s.updateAutomation)

  const existing = editingId ? automations.find(a => a.id === editingId) : null

  const [name, setName] = useState(existing?.name ?? '')
  const [prompt, setPrompt] = useState(existing?.prompt ?? '')
  const [mode, setMode] = useState<'quick-chat' | 'project'>(
    existing?.projectPaths && existing.projectPaths.length > 0 ? 'project' : 'quick-chat'
  )
  const [projectPath, setProjectPath] = useState(existing?.projectPaths?.[0] ?? '')
  const [branch, setBranch] = useState<string | null>(existing?.branch ?? null)
  const [branchList, setBranchList] = useState<string[]>([])
  const [currentBranch, setCurrentBranch] = useState<string | null>(null)
  const [scheduleType, setScheduleType] = useState<AutomationSchedule['type']>(existing?.schedule.type ?? 'manual')
  const [intervalMinutes, setIntervalMinutes] = useState(existing?.schedule.intervalMinutes ?? 60)
  const [hourlyMinute, setHourlyMinute] = useState(existing?.schedule.hourlyMinute ?? 0)
  const [dailyAt, setDailyAt] = useState(existing?.schedule.dailyAt ?? '09:00')
  const [weeklyDay, setWeeklyDay] = useState(existing?.schedule.weeklyDay ?? 1)
  const [weeklyAt, setWeeklyAt] = useState(existing?.schedule.weeklyAt ?? '09:00')
  const [monthlyDay, setMonthlyDay] = useState(existing?.schedule.monthlyDay ?? 1)
  const [monthlyAt, setMonthlyAt] = useState(existing?.schedule.monthlyAt ?? '09:00')
  const [cronExpression, setCronExpression] = useState(existing?.schedule.cronExpression ?? '0 9 * * *')
  const [sandboxMode, setSandboxMode] = useState(existing?.sandboxMode ?? 'workspace-write')
  const [model, setModel] = useState(existing?.model ?? DEFAULT_MODEL)
  const [effort, setEffort] = useState<EffortLevel | null>(existing?.effort as EffortLevel | null ?? DEFAULT_EFFORT)
  const [enabled, setEnabled] = useState(existing?.enabled ?? true)

  const effortLevels = getModelEffortLevels(model)

  const isValid = name.trim() && prompt.trim() && (mode === 'quick-chat' || projectPath)

  // Fetch branches when project path changes
  useEffect(() => {
    if (!projectPath) { setBranchList([]); setCurrentBranch(null); return }
    let cancelled = false
    ;(async () => {
      const [branchResult, branchesResult] = await Promise.all([
        window.api.project.gitBranch(projectPath),
        window.api.project.gitBranches(projectPath),
      ])
      if (cancelled) return
      if (branchResult.success && branchResult.branch) {
        setCurrentBranch(branchResult.branch)
        if (!branch) setBranch(branchResult.branch)
      }
      if (branchesResult.success && branchesResult.branches) {
        setBranchList(branchesResult.branches)
      }
    })()
    return () => { cancelled = true }
  }, [projectPath]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleBrowseProject = async () => {
    const result = await window.api.project.open()
    if (result.success && result.path) {
      setProjectPath(result.path)
      setBranch(null) // Reset branch so it picks up the new project's current branch
    }
  }

  const handleSave = async () => {
    if (!isValid) return

    const schedule: AutomationSchedule = { type: scheduleType }
    if (scheduleType === 'interval') schedule.intervalMinutes = Math.max(5, intervalMinutes)
    if (scheduleType === 'hourly') schedule.hourlyMinute = Math.max(0, Math.min(59, hourlyMinute))
    if (scheduleType === 'daily' || scheduleType === 'weekdays') schedule.dailyAt = dailyAt
    if (scheduleType === 'weekly') { schedule.weeklyDay = weeklyDay; schedule.weeklyAt = weeklyAt }
    if (scheduleType === 'monthly') { schedule.monthlyDay = Math.max(1, Math.min(31, monthlyDay)); schedule.monthlyAt = monthlyAt }
    if (scheduleType === 'cron') schedule.cronExpression = cronExpression.trim()

    const data = {
      name: name.trim(),
      prompt: prompt.trim(),
      projectPaths: mode === 'project' && projectPath ? [projectPath] : [],
      branch: mode === 'project' ? branch : null,
      schedule,
      sandboxMode: (mode === 'project' ? sandboxMode : 'full-access') as any,
      model: model || null,
      effort: effortLevels ? (effort || null) : null,
      enabled
    }

    if (editingId) {
      await updateAutomation(editingId, data)
    } else {
      await createAutomation(data)
    }
    closeEditor()
  }

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeEditor()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [closeEditor])

  const projectName = projectPath ? projectPath.split('/').pop() : ''

  return createPortal(
    <div className="hotkeys-overlay" onClick={closeEditor}>
      <div className="automation-editor-modal" onClick={e => e.stopPropagation()}>
        <div className="hotkeys-header">
          <h3>{editingId ? 'Edit Automation' : 'New Automation'}</h3>
          <button className="hotkeys-close" onClick={closeEditor}>&times;</button>
        </div>

        <div className="automation-editor-body">
          {/* Name */}
          <div className="settings-field">
            <label className="settings-field-label">Name</label>
            <input
              className="settings-input"
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g., Nightly lint check"
              autoFocus
            />
          </div>

          {/* Prompt */}
          <div className="settings-field">
            <label className="settings-field-label">Prompt</label>
            <textarea
              className="settings-input"
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Describe the task for the agent..."
              rows={6}
              style={{ resize: 'vertical' }}
            />
          </div>

          {/* Mode: Quick Chat / Project */}
          <div className="settings-field">
            <label className="settings-field-label">Context</label>
            <div className="settings-effort-picker">
              <button
                className={`settings-effort-option${mode === 'quick-chat' ? ' active' : ''}`}
                onClick={() => setMode('quick-chat')}
              >
                Quick Chat
              </button>
              <button
                className={`settings-effort-option${mode === 'project' ? ' active' : ''}`}
                onClick={() => setMode('project')}
                disabled={!editingId}
                title={!editingId ? 'Coming soon' : undefined}
              >
                Project
              </button>
            </div>
            <span className="settings-field-hint">
              {mode === 'quick-chat'
                ? 'Runs without a project context — useful for general tasks like summarizing email.'
                : 'Runs against a specific project directory.'}
            </span>
          </div>

          {/* Project path (only in project mode) */}
          {mode === 'project' && (
            <div className="settings-field">
              <label className="settings-field-label">Project</label>
              <button className="btn" onClick={handleBrowseProject} style={{ width: '100%' }}>
                {projectPath ? projectPath.split('/').pop() : 'Browse project folder...'}
              </button>
              {projectPath && (
                <span className="settings-field-hint">{projectPath}</span>
              )}
            </div>
          )}

          {/* Branch selector (only in project mode with branches) */}
          {mode === 'project' && projectPath && branchList.length > 0 && (
            <div className="settings-field">
              <label className="settings-field-label">Branch</label>
              <select
                className="settings-select"
                value={branch ?? ''}
                onChange={e => setBranch(e.target.value || null)}
              >
                {branchList.map(b => (
                  <option key={b} value={b}>
                    {b}{b === currentBranch ? ' (current)' : ''}
                  </option>
                ))}
              </select>
              <span className="settings-field-hint">The branch the automation will run against.</span>
            </div>
          )}

          {/* Model + Reasoning */}
          <div className="settings-field">
            <label className="settings-field-label">Model</label>
            <select
              className="settings-select"
              value={model}
              onChange={e => {
                setModel(e.target.value)
                const newEffortLevels = getModelEffortLevels(e.target.value)
                if (!newEffortLevels) setEffort(null)
                else if (!effort || !newEffortLevels.includes(effort)) setEffort(newEffortLevels[newEffortLevels.length - 1])
              }}
            >
              {AVAILABLE_MODELS.map(m => (
                <option key={m.id} value={m.id}>{m.label} ({m.provider})</option>
              ))}
            </select>
          </div>

          {effortLevels && (
            <div className="settings-field">
              <label className="settings-field-label">Reasoning</label>
              <div className="settings-effort-picker">
                {effortLevels.map(level => (
                  <button
                    key={level}
                    className={`settings-effort-option${effort === level ? ' active' : ''}`}
                    onClick={() => setEffort(level)}
                  >
                    {EFFORT_LABELS[level] ?? level}
                  </button>
                ))}
              </div>
              <span className="settings-field-hint">Controls how much thinking the model does.</span>
            </div>
          )}

          {/* Schedule */}
          <div className="settings-field">
            <label className="settings-field-label">Schedule</label>
            <select
              className="settings-select"
              value={scheduleType}
              onChange={e => setScheduleType(e.target.value as AutomationSchedule['type'])}
            >
              {SCHEDULE_TYPES.map(st => (
                <option key={st.value} value={st.value}>{st.label}</option>
              ))}
            </select>

            {scheduleType === 'interval' && (
              <div className="automation-field-inline">
                <label className="settings-field-label">Every</label>
                <input
                  className="settings-input"
                  type="number"
                  min={5}
                  value={intervalMinutes}
                  onChange={e => setIntervalMinutes(parseInt(e.target.value) || 60)}
                  style={{ width: 80 }}
                />
                <span className="settings-field-hint" style={{ marginTop: 0, alignSelf: 'center' }}>minutes</span>
              </div>
            )}

            {scheduleType === 'hourly' && (
              <div className="automation-field-inline">
                <label className="settings-field-label">At minute</label>
                <input
                  className="settings-input"
                  type="number"
                  min={0}
                  max={59}
                  value={hourlyMinute}
                  onChange={e => setHourlyMinute(parseInt(e.target.value) || 0)}
                  style={{ width: 80 }}
                />
                <span className="settings-field-hint" style={{ marginTop: 0, alignSelf: 'center' }}>past the hour</span>
              </div>
            )}

            {(scheduleType === 'daily' || scheduleType === 'weekdays') && (
              <div className="automation-field-inline">
                <label className="settings-field-label">At</label>
                <input className="settings-input" type="time" value={dailyAt} onChange={e => setDailyAt(e.target.value)} />
              </div>
            )}

            {scheduleType === 'weekly' && (
              <div className="automation-field-inline">
                <select className="settings-select" value={weeklyDay} onChange={e => setWeeklyDay(parseInt(e.target.value))}>
                  {DAYS.map((day, i) => (
                    <option key={i} value={i}>{day}</option>
                  ))}
                </select>
                <label className="settings-field-label" style={{ margin: '0 4px' }}>at</label>
                <input className="settings-input" type="time" value={weeklyAt} onChange={e => setWeeklyAt(e.target.value)} />
              </div>
            )}

            {scheduleType === 'monthly' && (
              <div className="automation-field-inline">
                <label className="settings-field-label">Day</label>
                <input
                  className="settings-input"
                  type="number"
                  min={1}
                  max={31}
                  value={monthlyDay}
                  onChange={e => setMonthlyDay(parseInt(e.target.value) || 1)}
                  style={{ width: 80 }}
                />
                <label className="settings-field-label" style={{ margin: '0 4px' }}>at</label>
                <input className="settings-input" type="time" value={monthlyAt} onChange={e => setMonthlyAt(e.target.value)} />
              </div>
            )}

            {scheduleType === 'cron' && (
              <div className="automation-field-inline" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                <input
                  className="settings-input"
                  type="text"
                  value={cronExpression}
                  onChange={e => setCronExpression(e.target.value)}
                  placeholder="0 9 * * *"
                  style={{ fontFamily: 'var(--font-mono, monospace)' }}
                />
                <span className="settings-field-hint">min hour day month weekday &mdash; e.g. <code>0 */6 * * *</code> = every 6 hours</span>
              </div>
            )}
          </div>

          {/* Sandbox Mode (only for project mode) */}
          {mode === 'project' && (
            <div className="settings-field">
              <label className="settings-field-label">Sandbox</label>
              <div className="settings-effort-picker">
                {SANDBOX_MODES.map(m => (
                  <button
                    key={m.value}
                    className={`settings-effort-option${sandboxMode === m.value ? ' active' : ''}`}
                    onClick={() => setSandboxMode(m.value)}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <span className="settings-field-hint">
                {sandboxMode === 'read-only' && 'Agent can only read and analyze — no file modifications.'}
                {sandboxMode === 'workspace-write' && 'Agent writes within an isolated worktree — changes must be applied manually.'}
                {sandboxMode === 'full-access' && 'Agent runs directly in the project — use with caution.'}
              </span>
            </div>
          )}

          {/* Enabled */}
          <div className="settings-row" style={{ padding: 0, border: 'none' }}>
            <div className="settings-label">
              <span>Enabled</span>
              <span className="settings-description">Runs on schedule when enabled</span>
            </div>
            <label className="settings-toggle">
              <input
                type="checkbox"
                checked={enabled}
                onChange={e => setEnabled(e.target.checked)}
              />
              <span className="settings-toggle-slider" />
            </label>
          </div>
        </div>

        <div className="automation-editor-footer">
          <button className="btn" onClick={closeEditor}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!isValid}>
            {editingId ? 'Save Changes' : 'Create Automation'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
