import { ipcMain } from 'electron'
import { BrowserManager, BrowserBounds } from '../browser/BrowserManager'

export function registerBrowserHandlers(browserManager: BrowserManager): void {
  ipcMain.handle('browser:navigate', async (_event, url: string) => {
    try {
      await browserManager.navigate(url)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('browser:back', () => {
    browserManager.goBack()
    return { success: true }
  })

  ipcMain.handle('browser:forward', () => {
    browserManager.goForward()
    return { success: true }
  })

  ipcMain.handle('browser:reload', () => {
    browserManager.reload()
    return { success: true }
  })

  ipcMain.handle('browser:set-bounds', (_event, bounds: BrowserBounds) => {
    browserManager.setBounds(bounds)
    return { success: true }
  })

  ipcMain.handle('browser:get-url', () => {
    return browserManager.getCurrentUrl()
  })

  ipcMain.handle('browser:show', () => {
    browserManager.show()
    return { success: true }
  })

  ipcMain.handle('browser:hide', () => {
    browserManager.hide()
    return { success: true }
  })

  ipcMain.handle('browser:switch-project', (_event, projectPath: string) => {
    const currentUrl = browserManager.switchProject(projectPath)
    return currentUrl
  })

  ipcMain.handle('browser:destroy', () => {
    browserManager.destroy()
    return { success: true }
  })
}
