import { ipcMain, app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { BrowserManager, BrowserBounds } from '../browser/BrowserManager'
import { detectChromeProfiles, importChromeProfile } from '../browser/ChromeImporter'

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

  ipcMain.handle('browser:list-chrome-profiles', () => {
    try {
      const profiles = detectChromeProfiles()
      return { success: true, profiles }
    } catch (err) {
      return { success: false, profiles: [], error: (err as Error).message }
    }
  })

  ipcMain.handle('browser:import-chrome', async (_event, profilePath: string) => {
    try {
      const result = await importChromeProfile(profilePath, (progress) => {
        browserManager.safeSend('browser:import-progress', progress)
      })
      // Reload passwords into BrowserManager for autofill
      if (result.passwordsImported > 0) {
        browserManager.loadSavedPasswords()
      }
      return { success: result.success, ...result }
    } catch (err) {
      return { success: false, imported: 0, failed: 0, skipped: 0, errors: [(err as Error).message] }
    }
  })

  ipcMain.handle('browser:get-history', (_event, query: string) => {
    try {
      const historyFile = join(app.getPath('userData'), 'imported-browser-history.json')
      if (!existsSync(historyFile)) return []

      const data = JSON.parse(readFileSync(historyFile, 'utf-8')) as Array<{
        url: string
        title: string
        visitCount: number
        lastVisitTime: number
      }>

      if (!query || !query.trim()) return data.slice(0, 8)

      const q = query.toLowerCase()
      return data
        .filter(e => e.url.toLowerCase().includes(q) || e.title.toLowerCase().includes(q))
        .slice(0, 8)
    } catch {
      return []
    }
  })
}
