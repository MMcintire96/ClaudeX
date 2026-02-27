import { ipcMain, powerSaveBlocker } from 'electron'
import { execFile } from 'child_process'
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

  ipcMain.handle('notification:play-sound', () => {
    const soundFile = '/usr/share/sounds/freedesktop/stereo/complete.oga'
    return new Promise<boolean>((resolve) => {
      // Try pw-play first (native PipeWire), fall back to paplay (PulseAudio compat)
      execFile('pw-play', [soundFile], (err) => {
        if (!err) return resolve(true)
        execFile('paplay', [soundFile], (err2) => {
          resolve(!err2)
        })
      })
    })
  })

  ipcMain.handle('settings:update', async (_event, partial: Partial<AppSettings>) => {
    const updated = await settingsManager.update(partial)
    if (partial.preventSleep !== undefined) {
      applyPreventSleep(partial.preventSleep)
    }
    return updated
  })
}
