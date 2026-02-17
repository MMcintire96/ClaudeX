import { ipcMain } from 'electron'
import { SettingsManager, AppSettings } from '../settings/SettingsManager'

export function registerSettingsHandlers(settingsManager: SettingsManager): void {
  ipcMain.handle('settings:get', () => {
    return settingsManager.get()
  })

  ipcMain.handle('settings:update', async (_event, partial: Partial<AppSettings>) => {
    return await settingsManager.update(partial)
  })
}
