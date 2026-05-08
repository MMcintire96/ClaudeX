import { ipcMain } from 'electron'
import type { RemoteServer } from '../remote/RemoteServer'

export function registerRemoteHandlers(remote: RemoteServer): void {
  ipcMain.handle('remote:status', () => ({
    bindHost: remote.bindHost,
    bindSource: remote.bindSource,
    port: remote.port,
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
}
