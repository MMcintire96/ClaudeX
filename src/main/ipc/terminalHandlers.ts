import { ipcMain } from 'electron'
import { homedir } from 'os'
import { randomUUID } from 'crypto'
import { TerminalManager } from '../terminal/TerminalManager'
import { SessionPersistence } from '../session/SessionPersistence'

export function registerTerminalHandlers(
  terminalManager: TerminalManager,
  sessionPersistence?: SessionPersistence
): void {
  ipcMain.handle('terminal:create', (_event, projectPath: string) => {
    try {
      const cwd = projectPath === '~' ? homedir() : projectPath
      const info = terminalManager.create(cwd)
      return { success: true, ...info }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('terminal:write', (_event, id: string, data: string) => {
    terminalManager.write(id, data)
    return { success: true }
  })

  ipcMain.handle('terminal:resize', (_event, id: string, cols: number, rows: number) => {
    terminalManager.resize(id, cols, rows)
    return { success: true }
  })

  ipcMain.handle('terminal:close', (_event, id: string) => {
    terminalManager.close(id)
    return { success: true }
  })

  ipcMain.handle('terminal:list', (_event, projectPath: string) => {
    return terminalManager.list(projectPath)
  })

  ipcMain.handle('terminal:rename', (_event, id: string, name: string) => {
    terminalManager.setTerminalName(id, name)
    return { success: true }
  })

  ipcMain.handle('terminal:getBuffer', (_event, id: string) => {
    return terminalManager.getRawBuffer(id)
  })

  ipcMain.handle('terminal:popout', (_event, id: string) => {
    try {
      const result = terminalManager.popout(id)
      return { success: true, ...result }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('terminal:close-popout', (_event, id: string) => {
    terminalManager.closePopout(id)
    return { success: true }
  })

  ipcMain.handle('terminal:create-cc', (_event, projectPath: string, skipPermissions: boolean, model?: string | null, effort?: string | null, ccSessionId?: string, resumeSessionId?: string) => {
    try {
      const cwd = projectPath === '~' ? homedir() : projectPath
      const args: string[] = []
      if (skipPermissions) args.push('--dangerously-skip-permissions')
      if (model) args.push('--model', model)
      if (effort) args.push('--effort', effort)
      if (resumeSessionId) {
        args.push('--resume', resumeSessionId)
      } else if (ccSessionId) {
        args.push('--session-id', ccSessionId)
      }
      const info = terminalManager.createWithCommand(cwd, 'claude', args)
      return { success: true, ...info }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  // Session history handlers
  ipcMain.handle('session:history', (_event, projectPath: string) => {
    if (!sessionPersistence) return []
    return sessionPersistence.getHistory(projectPath)
  })

  ipcMain.handle('session:clear-history', (_event, projectPath?: string) => {
    if (!sessionPersistence) return { success: false }
    sessionPersistence.clearHistory(projectPath)
    return { success: true }
  })
}
