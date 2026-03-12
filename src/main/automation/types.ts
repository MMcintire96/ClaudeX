export type SandboxMode = 'read-only' | 'workspace-write' | 'full-access'

export interface AutomationSchedule {
  type: 'manual' | 'interval' | 'hourly' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'cron'
  /** For 'interval': every N minutes (min 5) */
  intervalMinutes?: number
  /** For 'hourly': minute of the hour (0–59) */
  hourlyMinute?: number
  /** For 'daily' / 'weekdays': "HH:MM" in local time */
  dailyAt?: string
  /** For 'weekly': 0=Sun..6=Sat */
  weeklyDay?: number
  /** For 'weekly': "HH:MM" in local time */
  weeklyAt?: string
  /** For 'monthly': day of month (1–31) */
  monthlyDay?: number
  /** For 'monthly': "HH:MM" in local time */
  monthlyAt?: string
  /** For 'cron': standard 5-field cron expression */
  cronExpression?: string
}

export interface AutomationDefinition {
  id: string
  name: string
  prompt: string
  projectPaths: string[]
  branch: string | null
  schedule: AutomationSchedule
  sandboxMode: SandboxMode
  model: string | null
  effort: string | null
  enabled: boolean
  createdAt: number
  updatedAt: number
  lastRunAt: number | null
  runCount: number
}

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type TriageStatus = 'triage' | 'archived' | 'pinned'

export interface AgentMessageSummary {
  role: 'assistant' | 'tool'
  type: 'text' | 'tool_use' | 'tool_result'
  content: string
  toolName?: string
  timestamp: number
}

export interface AutomationRun {
  id: string
  automationId: string
  projectPath: string
  status: RunStatus
  triageStatus: TriageStatus
  startedAt: number
  completedAt: number | null
  durationMs: number | null
  costUsd: number | null
  numTurns: number | null
  diff: string | null
  resultSummary: string | null
  agentMessages: AgentMessageSummary[]
  error: string | null
  worktreeSessionId: string | null
  worktreePath: string | null
  sdkSessionId: string | null
}
