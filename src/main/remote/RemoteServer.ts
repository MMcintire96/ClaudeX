import * as http from 'http'
import * as os from 'os'
import * as fs from 'fs'
import * as path from 'path'
import { app, BrowserWindow } from 'electron'
import { WebSocketServer, WebSocket } from 'ws'
import QRCode from 'qrcode'
import { addRemoteSubscriber, broadcastSend, RemoteSubscriber } from '../broadcast'
import type { AgentManager } from '../agent/AgentManager'
import type { SessionPersistence } from '../session/SessionPersistence'
import { DevicePairing, PairedDevice } from './DevicePairing'
import { PushNotifier } from './PushNotifier'
import { Caffeinate } from './Caffeinate'
import { dispatchRpc, RpcManagers, RpcRequest } from './rpcHandlers'

/** Channels that we forward to remote clients. Anything else is desktop-only. */
const REMOTE_CHANNELS = new Set([
  'agent:event',
  'agent:events',
  'agent:closed',
  'agent:error',
  'agent:title',
  'agent:suggestion',
  'agent:forwarded-review'
])

const RING_BUFFER_SIZE = 500

interface RingEntry {
  seq: number
  channel: string
  args: unknown[]
}

interface SocketMeta {
  device: PairedDevice
  /** Last seq number this socket has received (for replay on reconnect). */
  lastSeq: number
}

/** What the bind interface lookup returns. */
interface BindResult {
  host: string
  source: 'env' | 'tailscale' | 'localhost'
}

/**
 * Auto-detect the Tailscale interface IP. Falls back to loopback if not present.
 * Override with CLAUDEX_REMOTE_BIND_IP. Never binds 0.0.0.0.
 */
function pickBindHost(): BindResult {
  const override = process.env.CLAUDEX_REMOTE_BIND_IP
  if (override) return { host: override, source: 'env' }

  const ifaces = os.networkInterfaces()
  // Tailscale on Linux is `tailscale0`; on macOS it can be `utun3` etc., but
  // the magic IP range is 100.64.0.0/10 (CGNAT) so we filter on that too.
  for (const [name, list] of Object.entries(ifaces)) {
    if (!list) continue
    for (const i of list) {
      if (i.family !== 'IPv4' || i.internal) continue
      if (name.startsWith('tailscale') || i.address.startsWith('100.')) {
        return { host: i.address, source: 'tailscale' }
      }
    }
  }
  return { host: '127.0.0.1', source: 'localhost' }
}

export interface RemoteServerOptions {
  agentManager: AgentManager
  sessionPersistence: SessionPersistence
  /** Optional override port. Defaults to 0 (random). */
  port?: number
  /** Path to built mobile PWA static assets. Optional; if missing, no static serving. */
  pwaDistDir?: string
  /**
   * Bag of managers exposed to the RPC dispatcher (`POST /api/rpc`). Optional
   * but strongly recommended — without it the phone can't query project
   * status, run git operations, etc.
   */
  rpcManagers?: Partial<RpcManagers>
}

export class RemoteServer {
  private opts: RemoteServerOptions
  private server: http.Server | null = null
  private wss: WebSocketServer | null = null
  private _bind: BindResult = { host: '127.0.0.1', source: 'localhost' }
  private _port = 0
  pairing: DevicePairing
  push: PushNotifier
  private caffeinate = new Caffeinate()
  private mainWindow: BrowserWindow | null = null
  private sockets: Map<WebSocket, SocketMeta> = new Map()
  private ringPerSession: Map<string, RingEntry[]> = new Map()
  private nextSeq = 1
  private unsubscribeBroadcast: (() => void) | null = null

  constructor(opts: RemoteServerOptions) {
    this.opts = opts
    this.pairing = new DevicePairing()
    this.push = new PushNotifier(this.pairing)
  }

  get bindHost(): string { return this._bind.host }
  get bindSource(): BindResult['source'] { return this._bind.source }
  get port(): number { return this._port }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  async start(): Promise<void> {
    this._bind = pickBindHost()
    this.server = http.createServer((req, res) => this.handleHttp(req, res))
    this.wss = new WebSocketServer({ noServer: true })
    this.server.on('upgrade', (req, socket, head) => this.handleUpgrade(req, socket, head))

    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.opts.port ?? 0, this._bind.host, () => {
        const addr = this.server!.address()
        if (addr && typeof addr === 'object') this._port = addr.port
        console.log(`[RemoteServer] listening on http://${this._bind.host}:${this._port} (source=${this._bind.source})`)
        resolve()
      })
    })

    // Subscribe to broadcasted IPC events; fan out to WS clients + ring buffer.
    const sink: RemoteSubscriber = (channel, args) => {
      if (!REMOTE_CHANNELS.has(channel)) return
      this.handleBroadcast(channel, args)
    }
    this.unsubscribeBroadcast = addRemoteSubscriber(sink)
  }

  stop(): void {
    this.caffeinate.destroy()
    if (this.unsubscribeBroadcast) {
      this.unsubscribeBroadcast()
      this.unsubscribeBroadcast = null
    }
    for (const ws of this.sockets.keys()) {
      try { ws.close() } catch { /* ignore */ }
    }
    this.sockets.clear()
    if (this.wss) {
      this.wss.close()
      this.wss = null
    }
    if (this.server) {
      this.server.close()
      this.server = null
    }
  }

  // --- HTTP routing ---

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url || '/', `http://${this._bind.host}:${this._port}`)
    const pathname = url.pathname

    // Public endpoints (no auth):
    if (pathname === '/api/pair/redeem' && req.method === 'POST') {
      return this.handleRedeem(req, res)
    }
    if (pathname === '/api/push/vapid-public-key' && req.method === 'GET') {
      return this.json(res, 200, { publicKey: this.push.publicKey() })
    }

    // Authed endpoints:
    if (pathname.startsWith('/api/')) {
      const device = this.authenticate(req)
      if (!device) return this.json(res, 401, { error: 'unauthorized' })
      return this.handleApi(req, res, device, pathname, url)
    }

    // Otherwise: serve the PWA static assets (if built).
    return this.serveStatic(req, res, pathname)
  }

  private handleApi(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    device: PairedDevice,
    pathname: string,
    url: URL
  ): void {
    if (pathname === '/api/sessions' && req.method === 'GET') {
      const state = this.opts.sessionPersistence.loadState()
      const sessions = (state.sessions ?? []).map(s => ({
        id: s.id,
        projectPath: s.projectPath,
        name: s.name,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
        model: s.model ?? null,
        worktreePath: s.worktreePath ?? null,
        isWorktree: !!s.isWorktree
      }))
      return this.json(res, 200, { sessions })
    }

    if (pathname.startsWith('/api/sessions/') && req.method === 'GET') {
      const id = decodeURIComponent(pathname.slice('/api/sessions/'.length).split('/')[0])
      const state = this.opts.sessionPersistence.loadState()
      const session = (state.sessions ?? []).find(s => s.id === id)
      if (!session) return this.json(res, 404, { error: 'not found' })
      return this.json(res, 200, {
        id: session.id,
        projectPath: session.projectPath,
        name: session.name,
        messages: session.messages ?? [],
        model: session.model ?? null,
        worktreePath: session.worktreePath ?? null,
        isWorktree: !!session.isWorktree
      })
    }

    if (pathname === '/api/agent/send' && req.method === 'POST') {
      return this.readJson(req, res, (body) => {
        const { sessionId, content } = body as { sessionId?: string; content?: string }
        if (!sessionId || typeof content !== 'string') {
          return this.json(res, 400, { error: 'sessionId and content required' })
        }
        try {
          this.opts.agentManager.sendMessage(sessionId, content)
          // Mirror remote-originated user messages into the desktop renderer
          // so the chat shows what the phone typed. Channel is not in
          // REMOTE_CHANNELS so it won't echo back to phone WS clients.
          broadcastSend(this.mainWindow, 'agent:user-message', { sessionId, content })
          return this.json(res, 200, { ok: true })
        } catch (err) {
          return this.json(res, 400, { error: (err as Error).message })
        }
      })
    }

    if (pathname === '/api/agent/stop' && req.method === 'POST') {
      return this.readJson(req, res, (body) => {
        const { sessionId } = body as { sessionId?: string }
        if (!sessionId) return this.json(res, 400, { error: 'sessionId required' })
        this.opts.agentManager.stopAgent(sessionId)
        return this.json(res, 200, { ok: true })
      })
    }

    if (pathname === '/api/agent/set-model' && req.method === 'POST') {
      return this.readJson(req, res, (body) => {
        const { sessionId, model } = body as { sessionId?: string; model?: string | null }
        if (!sessionId) return this.json(res, 400, { error: 'sessionId required' })
        this.opts.agentManager.setModel(sessionId, model ?? null)
        return this.json(res, 200, { ok: true })
      })
    }

    if (pathname === '/api/agent/set-effort' && req.method === 'POST') {
      return this.readJson(req, res, (body) => {
        const { sessionId, effort } = body as { sessionId?: string; effort?: string | null }
        if (!sessionId) return this.json(res, 400, { error: 'sessionId required' })
        this.opts.agentManager.setEffort(sessionId, effort ?? null)
        return this.json(res, 200, { ok: true })
      })
    }

    if (pathname.startsWith('/api/agent/status/') && req.method === 'GET') {
      const id = decodeURIComponent(pathname.slice('/api/agent/status/'.length))
      return this.json(res, 200, this.opts.agentManager.getStatus(id))
    }

    if (pathname === '/api/push/subscribe' && req.method === 'POST') {
      return this.readJson(req, res, (body) => {
        const sub = body as { endpoint?: string; keys?: { p256dh: string; auth: string } }
        if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
          return this.json(res, 400, { error: 'invalid subscription' })
        }
        this.pairing.setPushSubscription(device.id, {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }
        })
        return this.json(res, 200, { ok: true })
      })
    }

    if (pathname === '/api/devices' && req.method === 'GET') {
      // The phone can list devices but only its own metadata for confirmation.
      return this.json(res, 200, {
        device: { id: device.id, label: device.label, pairedAt: device.pairedAt }
      })
    }

    if (pathname === '/api/rpc' && req.method === 'POST') {
      return this.readJson(req, res, async (body) => {
        const rpcReq = body as RpcRequest
        const managers = this.opts.rpcManagers as RpcManagers | undefined
        if (!managers) return this.json(res, 503, { ok: false, error: 'RPC not configured' })
        const result = await dispatchRpc(managers, rpcReq)
        return this.json(res, result.ok ? 200 : 400, result)
      })
    }

    void url  // reserved for future querystring use
    return this.json(res, 404, { error: 'not found' })
  }

  // --- Pairing redemption ---

  private handleRedeem(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.readJson(req, res, (body) => {
      const { code, label } = body as { code?: string; label?: string }
      if (!code) return this.json(res, 400, { error: 'code required' })
      const device = this.pairing.redeemPairingCode(code, label)
      if (!device) return this.json(res, 400, { error: 'invalid or expired code' })
      return this.json(res, 200, {
        deviceId: device.id,
        token: device.token,
        label: device.label
      })
    })
  }

  // --- Auth ---

  private authenticate(req: http.IncomingMessage): PairedDevice | null {
    const auth = req.headers['authorization']
    if (typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ')) {
      return this.pairing.authenticate(auth.slice(7).trim())
    }
    return null
  }

  // --- WebSocket ---

  private handleUpgrade(req: http.IncomingMessage, socket: import('net').Socket, head: Buffer): void {
    const url = new URL(req.url || '/', `http://${this._bind.host}:${this._port}`)
    if (url.pathname !== '/api/events') {
      socket.destroy()
      return
    }
    const token = url.searchParams.get('token')
      ?? (req.headers['authorization'] as string | undefined)?.replace(/^bearer\s+/i, '').trim()
      ?? null
    const device = token ? this.pairing.authenticate(token) : null
    if (!device) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    this.wss!.handleUpgrade(req, socket, head, (ws) => {
      this.attachSocket(ws, device, url)
    })
  }

  private attachSocket(ws: WebSocket, device: PairedDevice, url: URL): void {
    const since = Number(url.searchParams.get('since') ?? '0')
    this.sockets.set(ws, { device, lastSeq: since })
    this.caffeinate.acquire()

    // Replay any missed events from the ring buffer.
    if (since > 0) {
      for (const ring of this.ringPerSession.values()) {
        for (const entry of ring) {
          if (entry.seq > since) this.sendEntry(ws, entry)
        }
      }
    }

    ws.on('close', () => {
      this.sockets.delete(ws)
      this.caffeinate.release()
    })
    ws.on('error', () => {
      this.sockets.delete(ws)
      this.caffeinate.release()
    })
    ws.on('message', (data) => {
      // Lightweight client-side ping support; reply with pong + current seq.
      try {
        const msg = JSON.parse(String(data))
        if (msg?.type === 'ping') ws.send(JSON.stringify({ type: 'pong', seq: this.nextSeq - 1 }))
      } catch { /* ignore */ }
    })

    ws.send(JSON.stringify({ type: 'hello', deviceId: device.id, seq: this.nextSeq - 1 }))
    void device
  }

  private handleBroadcast(channel: string, args: unknown[]): void {
    const seq = this.nextSeq++
    const entry: RingEntry = { seq, channel, args }

    // Bucket the entry into the ring keyed by sessionId, if extractable.
    const sessionId = this.extractSessionId(args)
    if (sessionId) {
      const ring = this.ringPerSession.get(sessionId) ?? []
      ring.push(entry)
      if (ring.length > RING_BUFFER_SIZE) ring.shift()
      this.ringPerSession.set(sessionId, ring)
    }

    for (const [ws, meta] of this.sockets) {
      if (ws.readyState !== WebSocket.OPEN) continue
      this.sendEntry(ws, entry)
      meta.lastSeq = seq
    }
  }

  private extractSessionId(args: unknown[]): string | null {
    const first = args[0] as { sessionId?: string } | undefined
    return first?.sessionId ?? null
  }

  private sendEntry(ws: WebSocket, entry: RingEntry): void {
    try {
      ws.send(JSON.stringify({ type: 'event', seq: entry.seq, channel: entry.channel, args: entry.args }))
    } catch { /* ignore */ }
  }

  // --- Static PWA serving ---

  private serveStatic(req: http.IncomingMessage, res: http.ServerResponse, pathname: string): void {
    const dir = this.opts.pwaDistDir
    if (!dir) return this.notFound(res)

    const safePath = pathname === '/' ? '/index.html' : pathname
    // Prevent path traversal — restrict to dir.
    const resolved = path.resolve(dir, '.' + safePath)
    if (!resolved.startsWith(path.resolve(dir))) return this.notFound(res)

    fs.stat(resolved, (err, stat) => {
      if (err || !stat.isFile()) {
        // SPA fallback to index.html.
        const fallback = path.join(dir, 'index.html')
        fs.readFile(fallback, (e2, buf) => {
          if (e2) return this.notFound(res)
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(buf)
        })
        return
      }
      fs.readFile(resolved, (e2, buf) => {
        if (e2) return this.notFound(res)
        const type = mimeFor(resolved)
        res.writeHead(200, { 'content-type': type })
        res.end(buf)
      })
    })
    void req
  }

  // --- Utility ---

  private notFound(res: http.ServerResponse): void {
    res.writeHead(404, { 'content-type': 'text/plain' })
    res.end('not found')
  }

  private json(res: http.ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }

  private readJson(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    handler: (body: unknown) => void
  ): void {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8')
        const body = raw ? JSON.parse(raw) : {}
        handler(body)
      } catch {
        this.json(res, 400, { error: 'invalid json' })
      }
    })
  }

  // --- Pairing helpers (used by IPC -> Settings UI) ---

  async generatePairingQR(label?: string): Promise<{
    code: string
    expiresAt: number
    url: string
    qrDataUrl: string
    bindHost: string
    bindSource: BindResult['source']
    port: number
  }> {
    const { code, expiresAt } = this.pairing.createPairingCode(label || 'iPhone')
    const url = `http://${this._bind.host}:${this._port}/pair?code=${code}`
    const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, scale: 8 })
    return {
      code,
      expiresAt,
      url,
      qrDataUrl,
      bindHost: this._bind.host,
      bindSource: this._bind.source,
      port: this._port
    }
  }

  setKeepAwakeEnabled(on: boolean): void {
    this.caffeinate.setEnabled(on)
  }

  // Trigger pushes from outside (e.g. AgentManager close handler).
  async pushAgentFinished(sessionId: string, body: string): Promise<void> {
    await this.push.broadcast({
      title: 'Claude finished',
      body,
      sessionId,
      url: `/chat/${sessionId}`
    })
  }

  async pushNeedsInput(sessionId: string, projectName: string | null): Promise<void> {
    await this.push.broadcast({
      title: 'Agent needs input',
      body: projectName ? `Question pending · ${projectName}` : 'Question pending',
      sessionId,
      url: `/chat/${sessionId}`
    })
  }
}

function mimeFor(file: string): string {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8'
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8'
  if (file.endsWith('.css')) return 'text/css; charset=utf-8'
  if (file.endsWith('.json')) return 'application/json'
  if (file.endsWith('.svg')) return 'image/svg+xml'
  if (file.endsWith('.png')) return 'image/png'
  if (file.endsWith('.webmanifest')) return 'application/manifest+json'
  return 'application/octet-stream'
}

// Make helper accessible from main without forcing app dep at import time.
export function defaultPwaDistDir(): string {
  // In dev, build artifacts land in mobile/dist/. In packaged app we'll
  // copy them to resources/ — mirrored handling below.
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'mobile')
  }
  return path.join(app.getAppPath(), 'mobile', 'dist')
}
