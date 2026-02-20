import * as http from 'http'
import * as crypto from 'crypto'
import { URL } from 'url'
import type { TerminalManager } from '../terminal/TerminalManager'
import type { BrowserManager } from '../browser/BrowserManager'

interface SessionMessage {
  from: string
  fromName: string
  content: string
  timestamp: number
}

/**
 * HTTP bridge server on localhost that exposes terminal and browser
 * operations to the MCP server process (which cannot use Electron IPC).
 */
export class ClaudexBridgeServer {
  private server: http.Server | null = null
  private _port = 0
  private _token: string

  private terminalManager: TerminalManager
  private browserManager: BrowserManager

  // Inter-session messaging: inbox per session ID
  private messageInboxes: Map<string, SessionMessage[]> = new Map()

  get port(): number {
    return this._port
  }

  get token(): string {
    return this._token
  }

  constructor(terminalManager: TerminalManager, browserManager: BrowserManager) {
    this.terminalManager = terminalManager
    this.browserManager = browserManager
    this._token = crypto.randomBytes(32).toString('hex')
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res))
      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address()
        if (addr && typeof addr === 'object') {
          this._port = addr.port
        }
        console.log(`[ClaudexBridge] Listening on 127.0.0.1:${this._port}`)
        resolve()
      })
      this.server.on('error', reject)
    })
  }

  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
  }

  private sendJson(res: http.ServerResponse, data: unknown, status = 200): void {
    const body = JSON.stringify(data)
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body)
    })
    res.end(body)
  }

  private sendError(res: http.ServerResponse, message: string, status = 400): void {
    this.sendJson(res, { error: message }, status)
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', reject)
    })
  }

  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    // Auth check
    const auth = req.headers.authorization
    if (auth !== `Bearer ${this._token}`) {
      this.sendError(res, 'Unauthorized', 401)
      return
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${this._port}`)
    const path = url.pathname

    try {
      if (req.method === 'GET' && path === '/terminal/list') {
        const projectPath = url.searchParams.get('projectPath') || ''
        const terminals = this.terminalManager.list(projectPath)
        this.sendJson(res, { terminals })
      } else if (req.method === 'GET' && path === '/terminal/read') {
        const id = url.searchParams.get('id') || ''
        const lines = parseInt(url.searchParams.get('lines') || '50', 10)
        const output = this.terminalManager.readOutput(id, lines)
        this.sendJson(res, { output })
      } else if (req.method === 'POST' && path === '/terminal/execute') {
        const body = JSON.parse(await this.readBody(req))
        const { command, projectPath } = body as { command: string; projectPath?: string }
        if (!command) {
          this.sendError(res, 'Missing "command" field')
          return
        }
        // Find or create a terminal for the project
        let terminalId = body.terminalId as string | undefined
        if (!terminalId && projectPath) {
          const terminals = this.terminalManager.list(projectPath)
          if (terminals.length > 0) {
            terminalId = terminals[0].id
          } else {
            const info = this.terminalManager.create(projectPath)
            terminalId = info.id
          }
        }
        if (!terminalId) {
          this.sendError(res, 'No terminal available — provide projectPath or terminalId')
          return
        }
        this.terminalManager.write(terminalId, command + '\n')
        this.sendJson(res, { success: true, terminalId })
      } else if (req.method === 'POST' && path === '/browser/navigate') {
        const body = JSON.parse(await this.readBody(req))
        const { url: navUrl } = body as { url: string }
        if (!navUrl) {
          this.sendError(res, 'Missing "url" field')
          return
        }
        await this.browserManager.navigate(navUrl)
        this.sendJson(res, { success: true })
      } else if (req.method === 'GET' && path === '/browser/url') {
        const currentUrl = this.browserManager.getCurrentUrl()
        this.sendJson(res, { url: currentUrl })
      } else if (req.method === 'GET' && path === '/browser/content') {
        const content = await this.browserManager.getPageContent()
        this.sendJson(res, { content })
      } else if (req.method === 'GET' && path === '/browser/screenshot') {
        const data = await this.browserManager.captureScreenshot()
        this.sendJson(res, { data })

      // --- Inter-session messaging ---
      } else if (req.method === 'GET' && path === '/sessions/list') {
        const projectPath = url.searchParams.get('projectPath') || ''
        // Return all claude terminals for the project with their names
        const allTerminals = this.terminalManager.list(projectPath)
        const sessions = allTerminals.map(t => ({
          id: t.id,
          name: this.terminalManager.getTerminalName(t.id) || t.id,
          projectPath: t.projectPath
        }))
        this.sendJson(res, { sessions })

      } else if (req.method === 'POST' && path === '/sessions/send') {
        const body = JSON.parse(await this.readBody(req))
        const { from, fromName, to, content } = body as {
          from: string; fromName?: string; to: string; content: string
        }
        if (!to || !content) {
          this.sendError(res, 'Missing "to" or "content" field')
          return
        }
        const msg: SessionMessage = {
          from: from || 'unknown',
          fromName: fromName || from || 'unknown',
          content,
          timestamp: Date.now()
        }
        if (!this.messageInboxes.has(to)) {
          this.messageInboxes.set(to, [])
        }
        const inbox = this.messageInboxes.get(to)!
        inbox.push(msg)
        // Cap inbox at 100 messages
        if (inbox.length > 100) inbox.shift()
        this.sendJson(res, { success: true })

      } else if (req.method === 'GET' && path === '/sessions/read') {
        const sessionId = url.searchParams.get('sessionId') || ''
        const clear = url.searchParams.get('clear') !== 'false' // default: clear after read
        const inbox = this.messageInboxes.get(sessionId) || []
        const messages = [...inbox]
        if (clear && inbox.length > 0) {
          this.messageInboxes.set(sessionId, [])
        }
        this.sendJson(res, { messages })

      } else {
        this.sendError(res, 'Not found', 404)
      }
    } catch (err) {
      console.error('[ClaudexBridge] Request error:', err)
      this.sendError(res, err instanceof Error ? err.message : String(err), 500)
    }
  }
}
