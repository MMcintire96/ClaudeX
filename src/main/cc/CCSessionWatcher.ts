import { FSWatcher, watch, statSync, openSync, readSync, closeSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { BrowserWindow } from 'electron'
import { broadcastSend } from '../broadcast'
import { sdkPathHash } from '../utils/sdkPathHash'

interface CCWatcherOptions {
  /** The UUID passed to --session-id (= JSONL filename stem) */
  sessionId: string
  /** The project CWD (used to compute pathHash) */
  projectPath: string
  /** The ClaudeX session ID the renderer knows about */
  rendererSessionId: string
}

export class CCSessionWatcher {
  private watcher: FSWatcher | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private fileOffset = 0
  private partialLine = ''
  private readonly jsonlPath: string
  private mainWindow: BrowserWindow | null = null
  private readonly rendererSessionId: string
  private stopped = false
  // Track seen message UUIDs to avoid duplicate events from multiple JSONL lines with same message
  private seenUuids = new Set<string>()

  constructor(options: CCWatcherOptions) {
    this.rendererSessionId = options.rendererSessionId
    const pathHash = sdkPathHash(options.projectPath)
    this.jsonlPath = join(
      homedir(), '.claude', 'projects', pathHash,
      `${options.sessionId}.jsonl`
    )
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  start(): void {
    this.stopped = false
    this._tryAttach()
  }

  stop(): void {
    this.stopped = true
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private _tryAttach(): void {
    if (this.stopped) return

    if (!existsSync(this.jsonlPath)) {
      // File doesn't exist yet — poll every 500ms
      this.pollTimer = setInterval(() => {
        if (this.stopped) {
          clearInterval(this.pollTimer!)
          this.pollTimer = null
          return
        }
        if (existsSync(this.jsonlPath)) {
          clearInterval(this.pollTimer!)
          this.pollTimer = null
          this._attachWatcher()
        }
      }, 500)
      return
    }

    this._attachWatcher()
  }

  private _attachWatcher(): void {
    if (this.stopped) return

    // Read any content that already exists
    this._readNewContent()

    this.watcher = watch(this.jsonlPath, { persistent: false }, (eventType) => {
      if (this.stopped) return
      if (eventType === 'change') {
        this._readNewContent()
      } else if (eventType === 'rename') {
        // File was rotated/deleted
        this.stop()
      }
    })

    this.watcher.on('error', () => this.stop())
  }

  private _readNewContent(): void {
    let fd: number
    try {
      fd = openSync(this.jsonlPath, 'r')
    } catch {
      return
    }

    try {
      const size = statSync(this.jsonlPath).size
      if (size <= this.fileOffset) {
        closeSync(fd)
        return
      }

      const chunkSize = size - this.fileOffset
      const buf = Buffer.allocUnsafe(chunkSize)
      const bytesRead = readSync(fd, buf, 0, chunkSize, this.fileOffset)
      this.fileOffset += bytesRead

      const text = buf.subarray(0, bytesRead).toString('utf-8')
      this.partialLine += text

      const lines = this.partialLine.split('\n')
      // Last element is either '' (text ended with \n) or an incomplete line
      this.partialLine = lines.pop()!

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        this._parseLine(trimmed)
      }
    } finally {
      closeSync(fd)
    }
  }

  private _parseLine(line: string): void {
    let record: Record<string, unknown>
    try {
      record = JSON.parse(line)
    } catch {
      return
    }

    this._processRecord(record)
  }

  private _processRecord(record: Record<string, unknown>): void {
    if (this.stopped || !this.mainWindow || this.mainWindow.isDestroyed()) return

    const type = record.type as string
    const uuid = record.uuid as string | undefined

    if (type === 'assistant') {
      // Deduplicate: same message.id can appear in multiple JSONL lines (streaming chunks)
      // We only want the latest one, so always emit — processEvent's dedup handles the rest
      if (uuid && this.seenUuids.has(uuid)) return
      if (uuid) this.seenUuids.add(uuid)

      const msg = record.message as Record<string, unknown> | undefined
      if (!msg) return

      broadcastSend(this.mainWindow, 'cc:session-event', {
        sessionId: this.rendererSessionId,
        event: { type: 'assistant', message: msg }
      })

      // CC CLI signals turn completion via stop_reason on the assistant message
      // (there is no separate "result" record in the JSONL)
      const stopReason = msg.stop_reason as string | undefined
      if (stopReason === 'end_turn') {
        broadcastSend(this.mainWindow, 'cc:session-event', {
          sessionId: this.rendererSessionId,
          event: {
            type: 'result',
            cost_usd: (record as Record<string, unknown>).cost_usd ?? 0,
            total_cost_usd: (record as Record<string, unknown>).total_cost_usd ?? 0,
            num_turns: (record as Record<string, unknown>).num_turns ?? 0,
            is_error: false
          }
        })
      }
    } else if (type === 'user') {
      const msg = record.message as Record<string, unknown> | undefined
      if (!msg) return

      const content = msg.content
      // CC CLI writes user input as a plain string, not a content block array
      if (typeof content === 'string') {
        if (content.trim()) {
          broadcastSend(this.mainWindow, 'cc:session-event', {
            sessionId: this.rendererSessionId,
            event: {
              type: 'cc_user_text',
              content
            }
          })
        }
        return
      }

      if (!Array.isArray(content)) return

      for (const block of (content as Array<Record<string, unknown>>)) {
        if (block.type === 'tool_result') {
          broadcastSend(this.mainWindow, 'cc:session-event', {
            sessionId: this.rendererSessionId,
            event: {
              type: 'tool_result',
              tool_use_id: block.tool_use_id,
              content: block.content,
              is_error: block.is_error ?? false
            }
          })
        } else if (block.type === 'text') {
          broadcastSend(this.mainWindow, 'cc:session-event', {
            sessionId: this.rendererSessionId,
            event: {
              type: 'cc_user_text',
              content: block.text
            }
          })
        }
      }
    } else if (type === 'result') {
      broadcastSend(this.mainWindow, 'cc:session-event', {
        sessionId: this.rendererSessionId,
        event: {
          type: 'result',
          cost_usd: record.cost_usd,
          total_cost_usd: record.total_cost_usd,
          num_turns: record.num_turns,
          is_error: false
        }
      })
    }
    // Skip queue-operation, system, summary records
  }
}
