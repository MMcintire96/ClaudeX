import { ipcMain, powerSaveBlocker } from 'electron'
import { SettingsManager, AppSettings } from '../settings/SettingsManager'

let powerSaveBlockerId: number | null = null

function applyPreventSleep(enabled: boolean): void {
  if (enabled && powerSaveBlockerId === null) {
    powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension')
  } else if (!enabled && powerSaveBlockerId !== null) {
    powerSaveBlocker.stop(powerSaveBlockerId)
    powerSaveBlockerId = null
  }
}

export function registerSettingsHandlers(settingsManager: SettingsManager): void {
  // Apply initial preventSleep state
  applyPreventSleep(settingsManager.get().preventSleep)

  ipcMain.handle('settings:get', () => {
    return settingsManager.get()
  })

  ipcMain.handle('settings:update', async (_event, partial: Partial<AppSettings>) => {
    const updated = await settingsManager.update(partial)
    if (partial.preventSleep !== undefined) {
      applyPreventSleep(partial.preventSleep)
    }
    return updated
  })
}
