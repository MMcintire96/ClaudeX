import React from 'react'
import { useAutomationStore } from '../../stores/automationStore'
import { useUIStore } from '../../stores/uiStore'
import { useProjectStore } from '../../stores/projectStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'
import type { UIMessage } from '../../stores/sessionStore'
import { SCRATCH_PROJECT_PATH } from '../../constants/scratch'

export default function AutomationSidebarSection({ collapsed, onToggleCollapse }: { collapsed: boolean; onToggleCollapse: () => void }) {
  const automations = useAutomationStore(s => s.automations)
  const runs = useAutomationStore(s => s.runs)
  const loadRuns = useAutomationStore(s => s.loadRuns)

  const activeSessionId = useSessionStore(s => s.activeSessionId)
  const sessions = useSessionStore(s => s.sessions)
  const createSession = useSessionStore(s => s.createSession)
  const setActiveSession = useSessionStore(s => s.setActiveSession)
  const renameSession = useSessionStore(s => s.renameSession)

  const getLatestRun = (automationId: string) => {
    const automationRuns = runs[automationId]
    if (!automationRuns || automationRuns.length === 0) return null
    return automationRuns[0]
  }

  const getStatusIndicator = (automationId: string, enabled: boolean) => {
    const latestRun = getLatestRun(automationId)
    if (latestRun?.status === 'running') return { className: 'spinner', char: '' }
    if (latestRun?.status === 'failed') return { className: '', char: '\u25CF', color: '#ef4444' }
    if (latestRun?.status === 'completed') return { className: '', char: '\u25CF', color: '#22c55e' }
    if (enabled) return { className: '', char: '\u25CB', color: '#888' }
    return { className: '', char: '\u25CB', color: '#555' }
  }

  const formatRunTime = (timestamp: number) => {
    const now = new Date()
    const date = new Date(timestamp)
    const isToday = now.toDateString() === date.toDateString()
    if (isToday) {
      return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
  }

  const handleClick = async (auto: typeof automations[0]) => {
    const sessionId = `automation-${auto.id}`

    // Load runs if not yet loaded
    if (!runs[auto.id]) {
      await loadRuns(auto.id)
    }

    const latestRun = useAutomationStore.getState().runs[auto.id]?.[0]

    // Determine the effective project path from the run or automation config
    const effectiveProjectPath = latestRun?.projectPath || auto.projectPaths[0] || ''

    // Switch to the project so header shows name/branch, but session stays scratch
    if (effectiveProjectPath) {
      const currentPath = useProjectStore.getState().currentPath
      if (currentPath !== effectiveProjectPath) {
        const result = await window.api.project.selectRecent(effectiveProjectPath)
        if (result.success) {
          useProjectStore.getState().setProject(result.path, result.isGitRepo)
          useTerminalStore.getState().switchToProjectTerminals(result.path)
        }
      }
    }

    // Close automations panel if open
    useUIStore.getState().setAutomationsOpen(false)

    // If session already exists, just switch to it
    if (sessions[sessionId]) {
      setActiveSession(sessionId)
      return
    }

    // Always use SCRATCH_PROJECT_PATH so the session stays under Automations, not under the project
    createSession(SCRATCH_PROJECT_PATH, sessionId)
    renameSession(sessionId, auto.name)

    // Set model/effort from automation config so ChatView picks them up
    if (auto.model) {
      useSessionStore.getState().setSelectedModel(sessionId, auto.model)
    }
    if (auto.effort) {
      useSessionStore.getState().setSelectedEffort(sessionId, auto.effort as any)
    }

    // Populate with the latest run's messages if available
    if (latestRun && (latestRun.status === 'running' || latestRun.status === 'pending')) {
      // Run is in progress — show prompt and processing indicator
      const runningMessages: UIMessage[] = [
        { id: 'auto-prompt-0', role: 'user' as const, type: 'text' as const, content: auto.prompt, timestamp: latestRun.startedAt }
      ]
      useSessionStore.setState(s => ({
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...s.sessions[sessionId],
            messages: runningMessages,
            isProcessing: true,
          }
        }
      }))
    } else if (latestRun && latestRun.agentMessages.length > 0) {
      const messages = convertRunToMessages(latestRun, auto.prompt)
      useSessionStore.setState(s => ({
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...s.sessions[sessionId],
            messages,
            totalCostUsd: latestRun.costUsd ?? 0,
            numTurns: latestRun.numTurns ?? 0,
          }
        }
      }))
    } else if (latestRun?.error) {
      // Even if no agent messages, show the error
      const errMessages: UIMessage[] = []
      const errContext: string[] = []
      if (latestRun.projectPath) errContext.push(`Project: ${latestRun.projectPath}`)
      if (latestRun.worktreePath) errContext.push(`Worktree: ${latestRun.worktreePath}`)
      if (errContext.length > 0) {
        errMessages.push({ id: 'auto-ctx-0', role: 'system' as const, type: 'system' as const, content: errContext.join('\n'), timestamp: latestRun.startedAt })
      }
      errMessages.push({ id: 'auto-err-0', role: 'user' as const, type: 'text' as const, content: auto.prompt, timestamp: latestRun.startedAt })
      errMessages.push({ id: 'auto-err-1', role: 'system' as const, type: 'system' as const, content: `Automation failed: ${latestRun.error}`, timestamp: latestRun.completedAt ?? latestRun.startedAt })
      useSessionStore.setState(s => ({
        sessions: {
          ...s.sessions,
          [sessionId]: {
            ...s.sessions[sessionId],
            messages: errMessages,
          }
        }
      }))
    }

    setActiveSession(sessionId)
  }

  const setAutomationsOpen = useUIStore(s => s.setAutomationsOpen)
  const selectAutomation = useAutomationStore(s => s.selectAutomation)

  const handleOpenList = () => {
    setAutomationsOpen(true)
    selectAutomation(null)
  }

  return (
    <div className="sidebar-automation-section">
      <div className="sidebar-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="sidebar-section-toggle" onClick={onToggleCollapse} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
          Automations
        </span>
        <button
          className="sidebar-section-action"
          onClick={handleOpenList}
          title="Manage automations"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
      {!collapsed && automations.map(auto => {
        const sessionId = `automation-${auto.id}`
        const isActive = activeSessionId === sessionId
        const indicator = getStatusIndicator(auto.id, auto.enabled)
        const isRunning = getLatestRun(auto.id)?.status === 'running'
        const latestRun = getLatestRun(auto.id)
        const runTime = latestRun?.completedAt || latestRun?.startedAt

        return (
          <div
            key={auto.id}
            className={`tree-item tree-item-thread${isActive ? ' active' : ''}`}
          >
            <button
              className="tree-item-btn"
              onClick={() => handleClick(auto)}
              style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '2px 0', textAlign: 'left', fontSize: 'inherit', fontFamily: 'inherit' }}
            >
              <span
                className={`tree-item-status-indicator ${indicator.className}`}
                style={!isRunning ? { color: indicator.color } : undefined}
              >
                {indicator.char}
              </span>
              <span className="tree-item-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{auto.name}</span>
            </button>
            {runTime && (
              <span style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap', paddingRight: '4px', flexShrink: 0 }}>
                {formatRunTime(runTime)}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function convertRunToMessages(run: ReturnType<typeof useAutomationStore.getState>['triageRuns'][0], prompt: string): UIMessage[] {
  let nextId = 0
  const uid = () => `auto-${run.id}-${nextId++}`

  const messages: UIMessage[] = []

  // Project/worktree context as system message
  const contextParts: string[] = []
  if (run.projectPath) contextParts.push(`Project: ${run.projectPath}`)
  if (run.worktreePath) contextParts.push(`Worktree: ${run.worktreePath}`)
  if (contextParts.length > 0) {
    messages.push({
      id: uid(),
      role: 'system',
      type: 'system',
      content: contextParts.join('\n'),
      timestamp: run.startedAt,
    })
  }

  // User prompt as first message
  messages.push({
    id: uid(),
    role: 'user',
    type: 'text',
    content: prompt,
    timestamp: run.startedAt,
  })

  // Convert agent messages
  for (const msg of run.agentMessages) {
    if (msg.role === 'assistant' && msg.type === 'text') {
      messages.push({
        id: uid(),
        role: 'assistant',
        type: 'text',
        content: msg.content,
        timestamp: msg.timestamp,
      })
    } else if (msg.role === 'assistant' && msg.type === 'tool_use') {
      const toolId = uid()
      messages.push({
        id: uid(),
        role: 'assistant',
        type: 'tool_use',
        toolName: msg.toolName || 'unknown',
        toolId,
        input: tryParseJson(msg.content),
        timestamp: msg.timestamp,
      })
    } else if (msg.role === 'tool' && msg.type === 'tool_result') {
      messages.push({
        id: uid(),
        role: 'tool',
        type: 'tool_result',
        toolUseId: '',
        content: msg.content,
        isError: false,
        timestamp: msg.timestamp,
      })
    }
  }

  // Error as system message
  if (run.error) {
    messages.push({
      id: uid(),
      role: 'system',
      type: 'system',
      content: `Automation failed: ${run.error}`,
      timestamp: run.completedAt ?? run.startedAt,
    })
  }

  // Result summary as final assistant text
  if (run.resultSummary) {
    messages.push({
      id: uid(),
      role: 'assistant',
      type: 'text',
      content: run.resultSummary,
      timestamp: run.completedAt ?? run.startedAt,
    })
  }

  return messages
}

function tryParseJson(str: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(str)
    return typeof parsed === 'object' && parsed !== null ? parsed : { value: str }
  } catch {
    return { value: str }
  }
}
