import { create } from 'zustand'

export interface AutomationSchedule {
  type: 'manual' | 'interval' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'cron'
  intervalMinutes?: number
  hourlyMinute?: number
  dailyAt?: string
  weeklyDay?: number
  weeklyAt?: string
  monthlyDay?: number
  monthlyAt?: string
  cronExpression?: string
}

export interface AutomationDefinition {
  id: string
  name: string
  prompt: string
  projectPaths: string[]
  branch: string | null
  schedule: AutomationSchedule
  sandboxMode: 'read-only' | 'workspace-write' | 'full-access'
  model: string | null
  effort: string | null
  enabled: boolean
  createdAt: number
  updatedAt: number
  lastRunAt: number | null
  runCount: number
}

export interface AutomationRun {
  id: string
  automationId: string
  projectPath: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  triageStatus: 'triage' | 'archived' | 'pinned'
  startedAt: number
  completedAt: number | null
  durationMs: number | null
  costUsd: number | null
  numTurns: number | null
  diff: string | null
  resultSummary: string | null
  agentMessages: Array<{ role: string; type: string; content: string; toolName?: string; timestamp: number }>
  error: string | null
  worktreeSessionId: string | null
  worktreePath: string | null
  sdkSessionId: string | null
}

export type AutomationView = 'list' | 'triage' | 'detail' | 'run-detail'

interface AutomationStore {
  automations: AutomationDefinition[]
  triageRuns: AutomationRun[]
  runs: Record<string, AutomationRun[]>
  selectedAutomationId: string | null
  selectedRunId: string | null
  automationView: AutomationView
  editorOpen: boolean
  editingAutomationId: string | null

  // Actions
  loadAutomations: () => Promise<void>
  loadTriageRuns: () => Promise<void>
  loadRuns: (automationId: string) => Promise<void>
  createAutomation: (input: {
    name: string
    prompt: string
    projectPaths: string[]
    branch?: string | null
    schedule: AutomationSchedule
    sandboxMode?: string
    model?: string | null
    effort?: string | null
    enabled?: boolean
  }) => Promise<void>
  updateAutomation: (id: string, partial: Partial<AutomationDefinition>) => Promise<void>
  deleteAutomation: (id: string) => Promise<void>
  triggerRun: (automationId: string, projectPath: string | null) => Promise<void>
  cancelRun: (runId: string) => Promise<void>
  setTriageStatus: (automationId: string, runId: string, status: string) => Promise<void>
  applyRun: (automationId: string, runId: string) => Promise<{ success: boolean; error?: string }>
  selectAutomation: (id: string | null) => void
  selectRun: (automationId: string | null, runId: string | null) => void
  setView: (view: AutomationView) => void
  openEditor: (automationId?: string | null) => void
  closeEditor: () => void

  // Reactive updates from IPC events
  handleRunStarted: (run: AutomationRun) => void
  handleRunCompleted: (run: AutomationRun) => void
  handleRunFailed: (run: AutomationRun) => void
  handleRunUpdated: (run: AutomationRun) => void
  handleAutomationCreated: (def: AutomationDefinition) => void
  handleAutomationUpdated: (def: AutomationDefinition) => void
  handleAutomationDeleted: (data: { id: string }) => void
}

export const useAutomationStore = create<AutomationStore>((set, get) => ({
  automations: [],
  triageRuns: [],
  runs: {},
  selectedAutomationId: null,
  selectedRunId: null,
  automationView: 'list',
  editorOpen: false,
  editingAutomationId: null,

  loadAutomations: async () => {
    const automations = await window.api.automation.list()
    set({ automations })
  },

  loadTriageRuns: async () => {
    const triageRuns = await window.api.automation.triage()
    set({ triageRuns })
  },

  loadRuns: async (automationId: string) => {
    const runs = await window.api.automation.runs(automationId, 50)
    set(s => ({ runs: { ...s.runs, [automationId]: runs } }))
  },

  createAutomation: async (input) => {
    await window.api.automation.create(input)
    await get().loadAutomations()
  },

  updateAutomation: async (id, partial) => {
    await window.api.automation.update(id, partial as Record<string, unknown>)
    await get().loadAutomations()
  },

  deleteAutomation: async (id) => {
    await window.api.automation.delete(id)
    set(s => ({
      automations: s.automations.filter(a => a.id !== id),
      selectedAutomationId: s.selectedAutomationId === id ? null : s.selectedAutomationId,
      automationView: s.selectedAutomationId === id ? 'list' : s.automationView
    }))
  },

  triggerRun: async (automationId, projectPath) => {
    await window.api.automation.trigger(automationId, projectPath)
  },

  cancelRun: async (runId) => {
    await window.api.automation.cancelRun(runId)
  },

  setTriageStatus: async (automationId, runId, status) => {
    await window.api.automation.setTriageStatus(automationId, runId, status)
    await get().loadTriageRuns()
    if (get().selectedAutomationId) {
      await get().loadRuns(get().selectedAutomationId!)
    }
  },

  applyRun: async (automationId, runId) => {
    const result = await window.api.automation.applyRun(automationId, runId)
    await get().loadTriageRuns()
    if (get().selectedAutomationId) {
      await get().loadRuns(get().selectedAutomationId!)
    }
    return result
  },

  selectAutomation: (id) => {
    set({ selectedAutomationId: id, selectedRunId: null, automationView: id ? 'detail' : 'list' })
    if (id) get().loadRuns(id)
  },

  selectRun: (automationId, runId) => {
    set({ selectedAutomationId: automationId, selectedRunId: runId, automationView: runId ? 'run-detail' : 'detail' })
  },

  setView: (view) => set({ automationView: view }),

  openEditor: (automationId) => {
    set({ editorOpen: true, editingAutomationId: automationId ?? null })
  },

  closeEditor: () => {
    set({ editorOpen: false, editingAutomationId: null })
  },

  // IPC event handlers
  handleRunStarted: (run) => {
    set(s => {
      const existing = s.runs[run.automationId] ?? []
      return { runs: { ...s.runs, [run.automationId]: [run, ...existing] } }
    })
  },

  handleRunCompleted: (run) => {
    set(s => {
      const existing = s.runs[run.automationId] ?? []
      const updated = existing.map(r => r.id === run.id ? run : r)
      const triageRuns = run.triageStatus === 'triage' || run.triageStatus === 'pinned'
        ? [run, ...s.triageRuns.filter(r => r.id !== run.id)]
        : s.triageRuns.filter(r => r.id !== run.id)
      return { runs: { ...s.runs, [run.automationId]: updated }, triageRuns }
    })
    get().loadAutomations() // refresh lastRunAt
  },

  handleRunFailed: (run) => {
    set(s => {
      const existing = s.runs[run.automationId] ?? []
      const updated = existing.map(r => r.id === run.id ? run : r)
      return { runs: { ...s.runs, [run.automationId]: updated } }
    })
  },

  handleRunUpdated: (run) => {
    set(s => {
      const existing = s.runs[run.automationId] ?? []
      const updated = existing.map(r => r.id === run.id ? run : r)
      const triageRuns = run.triageStatus === 'triage' || run.triageStatus === 'pinned'
        ? s.triageRuns.map(r => r.id === run.id ? run : r)
        : s.triageRuns.filter(r => r.id !== run.id)
      return { runs: { ...s.runs, [run.automationId]: updated }, triageRuns }
    })
  },

  handleAutomationCreated: (def) => {
    set(s => ({ automations: [...s.automations, def] }))
  },

  handleAutomationUpdated: (def) => {
    set(s => ({
      automations: s.automations.map(a => a.id === def.id ? def : a)
    }))
  },

  handleAutomationDeleted: (data) => {
    set(s => ({
      automations: s.automations.filter(a => a.id !== data.id),
      selectedAutomationId: s.selectedAutomationId === data.id ? null : s.selectedAutomationId
    }))
  }
}))
