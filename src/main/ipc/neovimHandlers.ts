import { ipcMain } from 'electron'
import { NeovimManager } from '../neovim/NeovimManager'

export function registerNeovimHandlers(neovimManager: NeovimManager): void {
  ipcMain.handle('neovim:create', (_event, projectPath: string, filePath?: string) => {
    try {
      const info = neovimManager.create(projectPath, filePath)
      return { success: true, ...info }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('neovim:write', (_event, projectPath: string, data: string) => {
    neovimManager.write(projectPath, data)
    return { success: true }
  })

  ipcMain.handle('neovim:resize', (_event, projectPath: string, cols: number, rows: number) => {
    neovimManager.resize(projectPath, cols, rows)
    return { success: true }
  })

  ipcMain.handle('neovim:open-file', (_event, projectPath: string, filePath: string) => {
    neovimManager.openFile(projectPath, filePath)
    return { success: true }
  })

  ipcMain.handle('neovim:close', (_event, projectPath: string) => {
    neovimManager.close(projectPath)
    return { success: true }
  })

  ipcMain.handle('neovim:is-running', (_event, projectPath: string) => {
    return neovimManager.isRunning(projectPath)
  })
}
