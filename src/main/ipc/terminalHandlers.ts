import { ipcMain } from 'electron'
import { TerminalManager } from '../terminal/TerminalManager'
import { SessionPersistence } from '../session/SessionPersistence'

export interface BridgeInfo {
  bridgePort: number
  bridgeToken: string
}

export function registerTerminalHandlers(
  terminalManager: TerminalManager,
  _bridgeInfo?: BridgeInfo,
  sessionPersistence?: SessionPersistence
): void {
  ipcMain.handle('terminal:create', (_event, projectPath: string) => {
    try {
      const info = terminalManager.create(projectPath)
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
