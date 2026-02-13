import { ipcMain } from 'electron'
import { TerminalManager } from '../terminal/TerminalManager'

export function registerTerminalHandlers(terminalManager: TerminalManager): void {
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
}
