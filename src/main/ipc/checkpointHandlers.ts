import { ipcMain } from 'electron'
import type { CheckpointManager } from '../checkpoint/CheckpointManager'

export function registerCheckpointHandlers(checkpointManager: CheckpointManager): void {
  ipcMain.handle('checkpoint:list', async (_event, sessionId: string) => {
    return checkpointManager.getCheckpoints(sessionId)
  })

  // Renderer-driven checkpoint creation with correct turn number
  ipcMain.handle('checkpoint:create', async (_event, opts: {
    sessionId: string
    projectPath: string
    filesModified: string[]
    messageCount: number
    turnNumber: number
    sdkSessionId: string | null
  }) => {
    try {
      const checkpoint = await checkpointManager.createCheckpointWithTurn(opts)
      return { success: true, checkpoint }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('checkpoint:revert', async (_event, sessionId: string, turnNumber: number) => {
    try {
      const result = await checkpointManager.revertToCheckpoint(sessionId, turnNumber)
      return { success: true, messageCount: result.messageCount }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('checkpoint:cleanup', async (_event, sessionId: string) => {
    try {
      await checkpointManager.cleanupCheckpoints(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}
