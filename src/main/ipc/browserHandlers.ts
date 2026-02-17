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

  ipcMain.handle('browser:open-devtools', () => {
    browserManager.openDevTools()
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
    return browserManager.switchProject(projectPath)
  })

  ipcMain.handle('browser:destroy', () => {
    browserManager.destroy()
    return { success: true }
  })

  ipcMain.handle('browser:new-tab', (_event, url?: string) => {
    return browserManager.newTab(url)
  })

  ipcMain.handle('browser:switch-tab', (_event, tabId: string) => {
    browserManager.switchTab(tabId)
    return { success: true }
  })

  ipcMain.handle('browser:close-tab', (_event, tabId: string) => {
    browserManager.closeTab(tabId)
    return { success: true }
  })

  ipcMain.handle('browser:get-tabs', () => {
    return browserManager.getTabs()
  })
}
