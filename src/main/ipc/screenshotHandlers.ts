import { ipcMain } from 'electron'
import { execFile } from 'child_process'
import { tmpdir } from 'os'
import { join, extname } from 'path'
import { readFile } from 'fs/promises'

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml'
}

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

  ipcMain.handle('utils:read-image', async (_, filePath: string) => {
    try {
      const data = await readFile(filePath)
      const ext = extname(filePath).toLowerCase()
      const mime = MIME_MAP[ext] || 'image/png'
      return { success: true, dataUrl: `data:${mime};base64,${data.toString('base64')}` }
    } catch {
      return { success: false }
    }
  })
}
