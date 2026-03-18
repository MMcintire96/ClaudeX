import { ipcMain, BrowserWindow } from 'electron'
import { CCSessionWatcher } from '../cc/CCSessionWatcher'

// Map: rendererSessionId -> watcher instance
const watchers: Map<string, CCSessionWatcher> = new Map()

let _mainWindow: BrowserWindow | null = null

export function setCCMainWindow(win: BrowserWindow): void {
  _mainWindow = win
}

export function registerCCHandlers(): void {
  ipcMain.handle('cc:watch-session', (_event, opts: {
    ccSessionId: string
    projectPath: string
    rendererSessionId: string
  }) => {
    // Stop any existing watcher for this renderer session
    const existing = watchers.get(opts.rendererSessionId)
    if (existing) existing.stop()

    const watcher = new CCSessionWatcher({
      sessionId: opts.ccSessionId,
      projectPath: opts.projectPath,
      rendererSessionId: opts.rendererSessionId
    })
    if (_mainWindow) watcher.setMainWindow(_mainWindow)
    watchers.set(opts.rendererSessionId, watcher)
    watcher.start()

    return { success: true }
  })

  ipcMain.handle('cc:stop-watch', (_event, rendererSessionId: string) => {
    const watcher = watchers.get(rendererSessionId)
    if (watcher) {
      watcher.stop()
      watchers.delete(rendererSessionId)
    }
    return { success: true }
  })

  ipcMain.handle('cc:handoff-to-chat', (_event, rendererSessionId: string) => {
    const watcher = watchers.get(rendererSessionId)
    if (watcher) {
      watcher.stop()
      watchers.delete(rendererSessionId)
    }
    return { success: true }
  })
}
