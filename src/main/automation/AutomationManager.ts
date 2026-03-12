import { BrowserWindow } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { v4 as uuidv4 } from 'uuid'
import { EventEmitter } from 'events'
import { AutomationPersistence } from './AutomationPersistence'
import { isDue } from './AutomationScheduler'
import { AgentProcess } from '../agent/AgentProcess'
import { broadcastSend } from '../broadcast'
import type { WorktreeManager } from '../worktree/WorktreeManager'
import type { SettingsManager } from '../settings/SettingsManager'
import type { McpManager } from '../mcp/McpManager'
import type { ClaudexBridgeServer } from '../bridge/ClaudexBridgeServer'
import type {
  AutomationDefinition,
  AutomationRun,
  AutomationSchedule,
  SandboxMode,
  TriageStatus,
  AgentMessageSummary,
  RunStatus
} from './types'
import type { AgentEvent, StreamEvent, AssistantMessageEvent, ToolUseBlock, ResultEvent } from '../agent/types'

const TICK_INTERVAL_MS = 60_000
const MAX_MESSAGE_CONTENT_LEN = 500
const MAX_DIFF_LEN = 50_000

const READ_ONLY_DISALLOWED_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']

export class AutomationManager extends EventEmitter {
  private persistence = new AutomationPersistence()
  private automations: AutomationDefinition[] = []
  private schedulerInterval: NodeJS.Timeout | null = null
  private runningJobs: Map<string, { abort: AbortController; agent: AgentProcess; runId: string }> = new Map()

  private mainWindow: BrowserWindow | null = null
  private worktreeManager: WorktreeManager | null = null
  private settingsManager: SettingsManager | null = null
  private mcpManager: McpManager | null = null
  private bridgeServer: ClaudexBridgeServer | null = null

  constructor() {
    super()
    this.automations = this.persistence.loadAutomations()
    console.log(`[AutomationManager] Loaded ${this.automations.length} automation(s)`)
  }

  setMainWindow(win: BrowserWindow): void { this.mainWindow = win }
  setWorktreeManager(wm: WorktreeManager): void { this.worktreeManager = wm }
  setSettingsManager(sm: SettingsManager): void { this.settingsManager = sm }
  setMcpManager(mm: McpManager): void { this.mcpManager = mm }
  setBridgeServer(bs: ClaudexBridgeServer): void { this.bridgeServer = bs }

  // --- CRUD ---

  list(): AutomationDefinition[] {
    return this.automations
  }

  get(id: string): AutomationDefinition | null {
    return this.automations.find(a => a.id === id) ?? null
  }

  create(input: {
    name: string
    prompt: string
    projectPaths: string[]
    branch?: string | null
    schedule: AutomationSchedule
    sandboxMode?: SandboxMode
    model?: string | null
    effort?: string | null
    enabled?: boolean
  }): AutomationDefinition {
    const now = Date.now()
    const def: AutomationDefinition = {
      id: uuidv4(),
      name: input.name,
      prompt: input.prompt,
      projectPaths: input.projectPaths,
      branch: input.branch ?? null,
      schedule: input.schedule,
      sandboxMode: input.sandboxMode ?? 'workspace-write',
      model: input.model ?? null,
      effort: input.effort ?? null,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
      lastRunAt: null,
      runCount: 0
    }
    this.automations.push(def)
    this.save()
    this.broadcast('automation:created', def)
    return def
  }

  update(id: string, partial: Partial<AutomationDefinition>): AutomationDefinition | null {
    const idx = this.automations.findIndex(a => a.id === id)
    if (idx === -1) return null
    const def = this.automations[idx]
    Object.assign(def, partial, { updatedAt: Date.now() })
    // Don't let callers overwrite id/createdAt
    def.id = this.automations[idx].id
    this.save()
    this.broadcast('automation:updated', def)
    return def
  }

  delete(id: string): void {
    this.automations = this.automations.filter(a => a.id !== id)
    this.save()
    this.persistence.deleteRunsForAutomation(id)
    this.broadcast('automation:deleted', { id })
  }

  private save(): void {
    this.persistence.saveAutomations(this.automations)
  }

  // --- Scheduler ---

  startScheduler(): void {
    if (this.schedulerInterval) return
    console.log('[AutomationManager] Starting scheduler')
    this.schedulerInterval = setInterval(() => this.tick(), TICK_INTERVAL_MS)
  }

  stopScheduler(): void {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval)
      this.schedulerInterval = null
    }
  }

  private tick(): void {
    const now = Date.now()
    for (const def of this.automations) {
      if (!def.enabled) continue
      if (!isDue(def.schedule, def.lastRunAt, now)) continue

      // Don't run if already running for this automation
      const alreadyRunning = [...this.runningJobs.values()].some(j => {
        const run = this.persistence.loadRun(def.id, j.runId)
        return run?.automationId === def.id
      })
      if (alreadyRunning) continue

      // Trigger for each target project, or once with null if no projects
      const targets = def.projectPaths.length > 0 ? def.projectPaths : [null]
      for (const projectPath of targets) {
        this.triggerRun(def.id, projectPath).catch(err => {
          console.error(`[AutomationManager] Failed to trigger run for ${def.name}:`, err)
        })
      }
    }
  }

  // --- Execution ---

  async triggerRun(automationId: string, projectPath: string | null): Promise<string> {
    const def = this.get(automationId)
    if (!def) throw new Error(`Automation not found: ${automationId}`)

    const runId = uuidv4()
    const run: AutomationRun = {
      id: runId,
      automationId,
      projectPath: projectPath ?? '',
      status: 'pending',
      triageStatus: 'triage',
      startedAt: Date.now(),
      completedAt: null,
      durationMs: null,
      costUsd: null,
      numTurns: null,
      diff: null,
      resultSummary: null,
      agentMessages: [],
      error: null,
      worktreeSessionId: null,
      worktreePath: null,
      sdkSessionId: null
    }
    this.persistence.saveRun(run)
    this.broadcast('automation:run-started', run)

    // Execute asynchronously
    this.executeRun(def, projectPath, run).catch(err => {
      console.error(`[AutomationManager] Run ${runId} failed:`, err)
    })

    return runId
  }

  private async executeRun(def: AutomationDefinition, projectPath: string | null, run: AutomationRun): Promise<void> {
    const runId = run.id
    let worktreeSessionId: string | null = null
    const resolvedPath = projectPath || homedir()
    let cwd = resolvedPath

    try {
      // Update status to running
      run.status = 'running'
      this.persistence.saveRun(run)
      this.broadcast('automation:run-updated', run)

      // Create worktree for git projects (unless full-access mode or no project)
      const isGit = projectPath ? existsSync(join(projectPath, '.git')) : false
      if (isGit && this.worktreeManager && def.sandboxMode !== 'full-access') {
        worktreeSessionId = `automation-${runId}`
        const wtInfo = await this.worktreeManager.create({
          projectPath,
          sessionId: worktreeSessionId,
          includeChanges: false
        })
        cwd = wtInfo.worktreePath
        run.worktreeSessionId = worktreeSessionId
        run.worktreePath = wtInfo.worktreePath
      }

      // Build agent options
      const disallowedTools = def.sandboxMode === 'read-only' ? READ_ONLY_DISALLOWED_TOOLS : undefined
      let systemPromptAppend = def.sandboxMode === 'read-only'
        ? 'IMPORTANT: This is a READ-ONLY automation. You must NOT modify any files. Only read, analyze, and report findings.'
        : undefined
      if (!projectPath) {
        const noProjectNote = 'This automation has no project context. You are running as a general-purpose agent (like a Quick Chat).'
        systemPromptAppend = systemPromptAppend ? `${systemPromptAppend}\n${noProjectNote}` : noProjectNote
      }

      const agent = new AgentProcess({
        projectPath: cwd,
        model: def.model,
        effort: def.effort,
        disallowedTools: disallowedTools ?? null,
        systemPromptAppend: systemPromptAppend ?? null
      })

      run.sdkSessionId = agent.sessionId

      const abort = new AbortController()
      this.runningJobs.set(runId, { abort, agent, runId })

      // Collect events
      const messages: AgentMessageSummary[] = []
      let resultSummary: string | null = null
      let costUsd: number | null = null
      let numTurns: number | null = null

      await new Promise<void>((resolve, reject) => {
        agent.on('event', (event: AgentEvent) => {
          // Collect assistant text messages
          if (event.type === 'assistant') {
            const assistantEvent = event as AssistantMessageEvent
            const content = assistantEvent.message?.content
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text' && block.text) {
                  messages.push({
                    role: 'assistant',
                    type: 'text',
                    content: block.text.slice(0, MAX_MESSAGE_CONTENT_LEN),
                    timestamp: Date.now()
                  })
                }
                if (block.type === 'tool_use') {
                  const toolBlock = block as ToolUseBlock
                  messages.push({
                    role: 'assistant',
                    type: 'tool_use',
                    content: JSON.stringify(toolBlock.input ?? {}).slice(0, MAX_MESSAGE_CONTENT_LEN),
                    toolName: toolBlock.name,
                    timestamp: Date.now()
                  })
                }
              }
            }
          }

          // Collect tool results
          if (event.type === 'tool_result') {
            const toolResult = event as any
            messages.push({
              role: 'tool',
              type: 'tool_result',
              content: String(toolResult.content ?? '').slice(0, MAX_MESSAGE_CONTENT_LEN),
              timestamp: Date.now()
            })
          }

          // Capture result
          if (event.type === 'result') {
            const resultEvent = event as ResultEvent
            resultSummary = resultEvent.result ?? null
            costUsd = resultEvent.total_cost_usd ?? null
            numTurns = resultEvent.num_turns ?? null
          }
        })

        agent.on('close', () => resolve())
        agent.on('error', (err: Error) => reject(err))

        agent.start(def.prompt)
      })

      // Compute diff from worktree
      let diff: string | null = null
      if (worktreeSessionId && this.worktreeManager) {
        try {
          const rawDiff = await this.worktreeManager.getDiff(worktreeSessionId)
          if (rawDiff.trim()) {
            diff = rawDiff.length > MAX_DIFF_LEN ? rawDiff.slice(0, MAX_DIFF_LEN) : rawDiff
          }
        } catch (err) {
          console.warn('[AutomationManager] Failed to get worktree diff:', err)
        }
      }

      // Classify: triage if there are findings, archived if empty
      const hasFindings = !!(diff?.trim()) || !!(resultSummary?.trim())
      const triageStatus: TriageStatus = hasFindings ? 'triage' : 'archived'

      // Update run
      run.status = 'completed'
      run.triageStatus = triageStatus
      run.completedAt = Date.now()
      run.durationMs = run.completedAt - run.startedAt
      run.costUsd = costUsd
      run.numTurns = numTurns
      run.diff = diff
      run.resultSummary = resultSummary
      run.agentMessages = messages
      this.persistence.saveRun(run)

      // Update automation metadata
      def.lastRunAt = run.startedAt
      def.runCount++
      this.save()

      // Clean up worktree if archived (no findings to inspect)
      if (triageStatus === 'archived' && worktreeSessionId && this.worktreeManager) {
        await this.worktreeManager.remove(worktreeSessionId).catch(() => {})
      }

      this.broadcast('automation:run-completed', run)
    } catch (err: any) {
      run.status = 'failed'
      run.error = err?.message ?? String(err)
      run.completedAt = Date.now()
      run.durationMs = run.completedAt - run.startedAt
      this.persistence.saveRun(run)
      this.broadcast('automation:run-failed', run)

      // Clean up worktree on failure
      if (worktreeSessionId && this.worktreeManager) {
        await this.worktreeManager.remove(worktreeSessionId).catch(() => {})
      }
    } finally {
      this.runningJobs.delete(runId)
    }
  }

  cancelRun(runId: string): void {
    const job = this.runningJobs.get(runId)
    if (job) {
      job.agent.stop()
      this.runningJobs.delete(runId)
    }
  }

  // --- Run management ---

  getRuns(automationId: string, limit?: number): AutomationRun[] {
    return this.persistence.loadRuns(automationId, limit)
  }

  getRun(automationId: string, runId: string): AutomationRun | null {
    return this.persistence.loadRun(automationId, runId)
  }

  getTriageRuns(): AutomationRun[] {
    return this.persistence.loadAllTriageRuns()
  }

  setTriageStatus(automationId: string, runId: string, status: TriageStatus): void {
    const run = this.persistence.loadRun(automationId, runId)
    if (!run) return

    const prevStatus = run.triageStatus
    run.triageStatus = status
    this.persistence.saveRun(run)

    // Clean up worktree when archiving a triage run
    if (status === 'archived' && prevStatus !== 'archived' && run.worktreeSessionId && this.worktreeManager) {
      this.worktreeManager.remove(run.worktreeSessionId).catch(() => {})
    }

    this.broadcast('automation:run-updated', run)
  }

  async applyRunToProject(automationId: string, runId: string): Promise<{ success: boolean; error?: string }> {
    const run = this.persistence.loadRun(automationId, runId)
    if (!run) return { success: false, error: 'Run not found' }
    if (!run.worktreeSessionId || !this.worktreeManager) {
      return { success: false, error: 'No worktree available for this run' }
    }

    try {
      await this.worktreeManager.syncToLocal(run.worktreeSessionId, 'apply')
      // Archive after applying
      run.triageStatus = 'archived'
      this.persistence.saveRun(run)
      // Clean up worktree
      await this.worktreeManager.remove(run.worktreeSessionId).catch(() => {})
      this.broadcast('automation:run-updated', run)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  }

  // --- Helpers ---

  private broadcast(channel: string, data: unknown): void {
    broadcastSend(this.mainWindow, channel, data)
  }

  destroy(): void {
    this.stopScheduler()
    // Cancel all running jobs
    for (const [runId, job] of this.runningJobs) {
      job.agent.stop()
    }
    this.runningJobs.clear()
  }
}
