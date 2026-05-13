import { ipcMain } from 'electron'
import type { RemoteServer } from '../remote/RemoteServer'
import type { SettingsManager } from '../settings/SettingsManager'

export function registerRemoteHandlers(
  remote: RemoteServer,
  settingsManager: SettingsManager
): void {
  ipcMain.handle('remote:status', () => ({
    running: remote.running,
    bindHost: remote.bindHost,
    bindSource: remote.bindSource,
    port: remote.port,
    configuredPort: remote.configuredPort,
    lastError: remote.lastError,
    devices: remote.pairing.list().map(d => ({
      id: d.id,
      label: d.label,
      pairedAt: d.pairedAt,
      lastSeenAt: d.lastSeenAt,
      hasPush: !!d.pushSubscription
    }))
  }))

  ipcMain.handle('remote:pair-start', async (_e, label?: string) => {
    return await remote.generatePairingQR(label)
  })

  ipcMain.handle('remote:pair-revoke', (_e, deviceId: string) => {
    return { ok: remote.pairing.revoke(deviceId) }
  })

  ipcMain.handle('remote:set-keep-awake', (_e, on: boolean) => {
    remote.setKeepAwakeEnabled(on)
    return { ok: true }
  })

  ipcMain.handle('remote:start', async () => {
    try {
      await remote.start()
      return { ok: true, port: remote.port }
    } catch (err) {
      return { ok: false, error: (err as Error).message || String(err) }
    }
  })

  ipcMain.handle('remote:stop', async () => {
    try {
      await remote.stop()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: (err as Error).message || String(err) }
    }
  })

  /**
   * Restart the remote server, optionally persisting a new port first.
   * - `port === undefined` → restart with current configured port (no change)
   * - `port === null`      → persist null (auto-assigned) and restart
   * - `port === number`    → persist and restart on that port
   */
  ipcMain.handle('remote:restart', async (_e, port?: number | null) => {
    try {
      if (port !== undefined) {
        await settingsManager.update({ remoteServerPort: port })
        await remote.restart(port)
      } else {
        await remote.restart()
      }
      return { ok: true, port: remote.port }
    } catch (err) {
      return { ok: false, error: (err as Error).message || String(err) }
    }
  })
}
