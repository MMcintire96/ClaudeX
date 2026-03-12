import { ipcMain } from 'electron'
import type { AutomationManager } from '../automation/AutomationManager'
import type { AutomationSchedule, SandboxMode, TriageStatus } from '../automation/types'

export function registerAutomationHandlers(automationManager: AutomationManager): void {
  ipcMain.handle('automation:list', () => {
    return automationManager.list()
  })

  ipcMain.handle('automation:get', (_event, id: string) => {
    return automationManager.get(id)
  })

  ipcMain.handle('automation:create', (_event, input: {
    name: string
    prompt: string
    projectPaths: string[]
    schedule: AutomationSchedule
    sandboxMode?: SandboxMode
    model?: string | null
    effort?: string | null
    enabled?: boolean
  }) => {
    return automationManager.create(input)
  })

  ipcMain.handle('automation:update', (_event, id: string, partial: Record<string, unknown>) => {
    return automationManager.update(id, partial)
  })

  ipcMain.handle('automation:delete', (_event, id: string) => {
    automationManager.delete(id)
    return { success: true }
  })

  ipcMain.handle('automation:trigger', async (_event, automationId: string, projectPath: string | null) => {
    try {
      const runId = await automationManager.triggerRun(automationId, projectPath)
      return { success: true, runId }
    } catch (err: any) {
      return { success: false, error: err?.message ?? String(err) }
    }
  })

  ipcMain.handle('automation:cancel-run', (_event, runId: string) => {
    automationManager.cancelRun(runId)
    return { success: true }
  })

  ipcMain.handle('automation:runs', (_event, automationId: string, limit?: number) => {
    return automationManager.getRuns(automationId, limit)
  })

  ipcMain.handle('automation:run', (_event, automationId: string, runId: string) => {
    return automationManager.getRun(automationId, runId)
  })

  ipcMain.handle('automation:triage', () => {
    return automationManager.getTriageRuns()
  })

  ipcMain.handle('automation:set-triage-status', (_event, automationId: string, runId: string, status: TriageStatus) => {
    automationManager.setTriageStatus(automationId, runId, status)
    return { success: true }
  })

  ipcMain.handle('automation:apply-run', async (_event, automationId: string, runId: string) => {
    return automationManager.applyRunToProject(automationId, runId)
  })
}
