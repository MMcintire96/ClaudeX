import { BrowserWindow } from 'electron'

/**
 * Tracks all renderer windows (main + popouts) and provides
 * a broadcast send that delivers IPC events to all of them.
 *
 * Events sent before the main window's renderer has finished loading
 * are queued and replayed once the window fires 'did-finish-load'.
 */
const extraWindows: Set<BrowserWindow> = new Set()
const readyWindows: WeakSet<BrowserWindow> = new WeakSet()
const pendingQueues: WeakMap<BrowserWindow, Array<{ channel: string; args: unknown[] }>> = new WeakMap()

export function addBroadcastWindow(win: BrowserWindow): void {
  extraWindows.add(win)
  win.on('closed', () => extraWindows.delete(win))
}

export function removeBroadcastWindow(win: BrowserWindow): void {
  extraWindows.delete(win)
}

/**
 * Mark a window as ready to receive IPC events (call after did-finish-load).
 * Flushes any queued events that were sent before the renderer was ready.
 */
export function markWindowReady(win: BrowserWindow): void {
  readyWindows.add(win)
  const queue = pendingQueues.get(win)
  if (queue && queue.length > 0) {
    console.log(`[broadcast] Flushing ${queue.length} queued events to renderer`)
    for (const { channel, args } of queue) {
      if (!win.isDestroyed()) {
        win.webContents.send(channel, ...args)
      }
    }
  }
  pendingQueues.delete(win)
}

/**
 * Send an IPC event to mainWindow + all extra windows.
 * If a window hasn't finished loading yet, events are queued and replayed later.
 */
export function broadcastSend(
  mainWindow: BrowserWindow | null,
  channel: string,
  ...args: unknown[]
): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (readyWindows.has(mainWindow)) {
      mainWindow.webContents.send(channel, ...args)
    } else {
      // Queue until renderer is ready
      let queue = pendingQueues.get(mainWindow)
      if (!queue) {
        queue = []
        pendingQueues.set(mainWindow, queue)
      }
      queue.push({ channel, args })
    }
  }
  for (const win of extraWindows) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, ...args)
    }
  }
}
