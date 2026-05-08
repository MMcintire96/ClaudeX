import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import webpush, { PushSubscription } from 'web-push'
import type { DevicePairing } from './DevicePairing'

interface VapidKeys {
  publicKey: string
  privateKey: string
  subject: string  // mailto:... required by web-push
}

const VAPID_FILE = 'remote-vapid.json'
const DEFAULT_SUBJECT = 'mailto:claudex@local'

export interface PushPayload {
  title: string
  body: string
  sessionId?: string
  url?: string  // optional deep link inside the PWA
}

export class PushNotifier {
  private keysPath: string
  private keys: VapidKeys | null = null
  private pairing: DevicePairing

  constructor(pairing: DevicePairing) {
    this.pairing = pairing
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    this.keysPath = join(dir, VAPID_FILE)
    this.loadOrGenerateKeys()
  }

  private loadOrGenerateKeys(): void {
    try {
      if (existsSync(this.keysPath)) {
        const raw = readFileSync(this.keysPath, 'utf-8')
        this.keys = JSON.parse(raw) as VapidKeys
      }
    } catch (err) {
      console.warn('[PushNotifier] failed to load vapid keys, regenerating:', err)
    }
    if (!this.keys) {
      const generated = webpush.generateVAPIDKeys()
      this.keys = { publicKey: generated.publicKey, privateKey: generated.privateKey, subject: DEFAULT_SUBJECT }
      try {
        writeFileSync(this.keysPath, JSON.stringify(this.keys, null, 2), 'utf-8')
      } catch (err) {
        console.error('[PushNotifier] failed to persist vapid keys:', err)
      }
    }
    webpush.setVapidDetails(this.keys.subject, this.keys.publicKey, this.keys.privateKey)
  }

  publicKey(): string {
    return this.keys!.publicKey
  }

  /** Send a push to every device that has a subscription. Best-effort, fire-and-forget. */
  async broadcast(payload: PushPayload): Promise<void> {
    const subs = this.pairing.pushSubscribers()
    if (subs.length === 0) return
    const json = JSON.stringify(payload)
    await Promise.all(subs.map(async d => {
      try {
        await webpush.sendNotification(d.pushSubscription as PushSubscription, json, { TTL: 60 })
      } catch (err: unknown) {
        const status = (err as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          // Subscription gone — clear it so we don't keep trying.
          this.pairing.setPushSubscription(d.id, null)
        } else {
          console.warn('[PushNotifier] push failed:', err)
        }
      }
    }))
  }
}
