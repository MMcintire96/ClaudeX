import { ipcMain } from 'electron'
import { WorktreeManager } from '../worktree/WorktreeManager'

export function registerWorktreeHandlers(worktreeManager: WorktreeManager): void {
  ipcMain.handle('worktree:create', async (_event, opts: {
    projectPath: string
    sessionId: string
    baseBranch?: string
    includeChanges?: boolean
  }) => {
    try {
      const info = await worktreeManager.create(opts)
      return { success: true, worktree: info }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('worktree:remove', async (_event, sessionId: string) => {
    try {
      await worktreeManager.remove(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('worktree:list', (_event, projectPath: string) => {
    return worktreeManager.list(projectPath)
  })

  ipcMain.handle('worktree:get', (_event, sessionId: string) => {
    return worktreeManager.get(sessionId)
  })

  ipcMain.handle('worktree:create-branch', async (_event, sessionId: string, branchName: string) => {
    try {
      await worktreeManager.createBranch(sessionId, branchName)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('worktree:diff', async (_event, sessionId: string) => {
    try {
      const diff = await worktreeManager.getDiff(sessionId)
      return { success: true, diff }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('worktree:sync-to-local', async (_event, sessionId: string, mode: 'overwrite' | 'apply') => {
    try {
      await worktreeManager.syncToLocal(sessionId, mode)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('worktree:sync-from-local', async (_event, sessionId: string, mode: 'overwrite' | 'apply') => {
    try {
      await worktreeManager.syncFromLocal(sessionId, mode)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('worktree:open-in-editor', (_event, sessionId: string) => {
    try {
      worktreeManager.openInEditor(sessionId)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}
