import { BrowserWindow } from 'electron'

/**
 * Tracks all renderer windows (main + popouts) and provides
 * a broadcast send that delivers IPC events to all of them.
 */
const extraWindows: Set<BrowserWindow> = new Set()

export function addBroadcastWindow(win: BrowserWindow): void {
  extraWindows.add(win)
  win.on('closed', () => extraWindows.delete(win))
}

export function removeBroadcastWindow(win: BrowserWindow): void {
  extraWindows.delete(win)
}

export function getBroadcastWindows(): BrowserWindow[] {
  return Array.from(extraWindows).filter(w => !w.isDestroyed())
}

/**
 * Send an IPC event to mainWindow + all extra windows.
 */
export function broadcastSend(
  mainWindow: BrowserWindow | null,
  channel: string,
  ...args: unknown[]
): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args)
  }
  for (const win of extraWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }
}
