import { ipcMain } from 'electron'
import { AgentManager } from '../agent/AgentManager'
import { WorktreeManager } from '../worktree/WorktreeManager'
import { randomUUID } from 'crypto'

export interface WorktreeOptions {
  useWorktree: boolean
  baseBranch?: string
  includeChanges?: boolean
}

export function registerAgentHandlers(agentManager: AgentManager, worktreeManager?: WorktreeManager): void {
  ipcMain.handle('agent:start', async (_event, projectPath: string, prompt: string, model?: string | null, worktreeOptions?: WorktreeOptions) => {
    try {
      let effectivePath = projectPath
      let worktreePath: string | undefined

      if (worktreeOptions?.useWorktree && worktreeManager) {
        const sessionId = randomUUID()
        const info = await worktreeManager.create({
          projectPath,
          sessionId,
          baseBranch: worktreeOptions.baseBranch,
          includeChanges: worktreeOptions.includeChanges
        })
        effectivePath = info.worktreePath
        worktreePath = info.worktreePath

        const agentSessionId = agentManager.startAgent({ projectPath: effectivePath, model: model ?? 'claude-opus-4-6' }, prompt)
        return { success: true, sessionId: agentSessionId, worktreePath, worktreeSessionId: sessionId }
      }

      const sessionId = agentManager.startAgent({ projectPath: effectivePath, model: model ?? 'claude-opus-4-6' }, prompt)
      return { success: true, sessionId }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('agent:send', (_event, sessionId: string, content: string) => {
    try {
      agentManager.sendMessage(sessionId, content)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('agent:stop', (_event, sessionId: string) => {
    agentManager.stopAgent(sessionId)
    return { success: true }
  })

  ipcMain.handle('agent:status', (_event, sessionId: string) => {
    return agentManager.getStatus(sessionId)
  })

  ipcMain.handle('agent:set-model', (_event, sessionId: string, model: string | null) => {
    agentManager.setModel(sessionId, model)
    return { success: true }
  })
}
