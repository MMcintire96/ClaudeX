import { ipcMain } from 'electron'
import { execFile } from 'child_process'
import { tmpdir } from 'os'
import { join } from 'path'

export function registerScreenshotHandlers(): void {
  ipcMain.handle('screenshot:capture', async () => {
    const filename = `claudex-screenshot-${Date.now()}.png`
    const filePath = join(tmpdir(), filename)

    return new Promise<{ success: boolean; path?: string; error?: string }>((resolve) => {
      // Use scrot with --select for region selection, or full screen with a small delay
      execFile('scrot', ['-s', filePath], (error) => {
        if (error) {
          resolve({ success: false, error: error.message })
        } else {
          resolve({ success: true, path: filePath })
        }
      })
    })
  })
}
