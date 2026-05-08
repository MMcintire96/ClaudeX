import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomBytes } from 'crypto'

export interface PairedDevice {
  id: string            // 16-byte hex
  token: string         // 32-byte hex bearer token
  label: string         // user-supplied or default ("iPhone")
  pairedAt: number
  lastSeenAt: number
  pushSubscription?: {
    endpoint: string
    keys: { p256dh: string; auth: string }
  } | null
}

interface PairingRecord {
  code: string
  expiresAt: number
  label: string
}

interface PairingFile {
  devices: PairedDevice[]
}

const PAIRING_CODE_TTL_MS = 60_000

export class DevicePairing {
  private path: string
  private devices: Map<string, PairedDevice> = new Map()
  private pendingCodes: Map<string, PairingRecord> = new Map()

  constructor() {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.path = join(dir, 'remote-devices.json')
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.path)) {
        const raw = readFileSync(this.path, 'utf-8')
        const parsed = JSON.parse(raw) as PairingFile
        for (const d of parsed.devices ?? []) this.devices.set(d.id, d)
      }
    } catch (err) {
      console.warn('[DevicePairing] failed to load:', err)
    }
  }

  private persist(): void {
    try {
      const data: PairingFile = { devices: [...this.devices.values()] }
      writeFileSync(this.path, JSON.stringify(data, null, 2), 'utf-8')
    } catch (err) {
      console.error('[DevicePairing] failed to persist:', err)
    }
  }

  /** Mint a short-lived pairing code. Returns the code that should be displayed (e.g. in a QR). */
  createPairingCode(label = 'iPhone'): { code: string; expiresAt: number } {
    const code = randomBytes(4).toString('hex').toUpperCase()
    const expiresAt = Date.now() + PAIRING_CODE_TTL_MS
    this.pendingCodes.set(code, { code, expiresAt, label })
    // Garbage-collect expired codes opportunistically.
    for (const [k, v] of this.pendingCodes) {
      if (v.expiresAt < Date.now()) this.pendingCodes.delete(k)
    }
    return { code, expiresAt }
  }

  /** Consume a pairing code, returning a fresh device record (or null if invalid/expired). */
  redeemPairingCode(code: string, deviceLabel?: string): PairedDevice | null {
    const record = this.pendingCodes.get(code.toUpperCase())
    if (!record) return null
    if (record.expiresAt < Date.now()) {
      this.pendingCodes.delete(code.toUpperCase())
      return null
    }
    this.pendingCodes.delete(code.toUpperCase())

    const device: PairedDevice = {
      id: randomBytes(8).toString('hex'),
      token: randomBytes(32).toString('hex'),
      label: deviceLabel || record.label,
      pairedAt: Date.now(),
      lastSeenAt: Date.now(),
      pushSubscription: null
    }
    this.devices.set(device.id, device)
    this.persist()
    return device
  }

  /** Look up a device by bearer token. Updates lastSeenAt on success. */
  authenticate(token: string): PairedDevice | null {
    if (!token) return null
    for (const d of this.devices.values()) {
      if (d.token === token) {
        d.lastSeenAt = Date.now()
        return d
      }
    }
    return null
  }

  list(): PairedDevice[] {
    return [...this.devices.values()].sort((a, b) => b.lastSeenAt - a.lastSeenAt)
  }

  revoke(deviceId: string): boolean {
    const ok = this.devices.delete(deviceId)
    if (ok) this.persist()
    return ok
  }

  setPushSubscription(deviceId: string, sub: PairedDevice['pushSubscription']): void {
    const d = this.devices.get(deviceId)
    if (!d) return
    d.pushSubscription = sub
    this.persist()
  }

  /** Devices that have a push subscription registered. */
  pushSubscribers(): PairedDevice[] {
    return [...this.devices.values()].filter(d => d.pushSubscription)
  }
}
