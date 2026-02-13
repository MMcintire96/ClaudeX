import { BrowserWindow } from 'electron'
import { AgentProcess, AgentProcessOptions } from './AgentProcess'
import type { AgentEvent } from './types'

/**
 * Manages multiple agent sessions, keyed by sessionId.
 * Each project can have multiple concurrent sessions.
 */
export class AgentManager {
  private agents: Map<string, AgentProcess> = new Map()
  private mainWindow: BrowserWindow | null = null

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  private wireEvents(sessionId: string, agent: AgentProcess): void {
    agent.on('event', (event: AgentEvent) => {
      this.mainWindow?.webContents.send('agent:event', { sessionId, event })
    })

    agent.on('close', (code: number | null) => {
      this.mainWindow?.webContents.send('agent:closed', { sessionId, code })
    })

    agent.on('error', (err: Error) => {
      this.mainWindow?.webContents.send('agent:error', { sessionId, error: err.message })
    })

    agent.on('stderr', (data: string) => {
      this.mainWindow?.webContents.send('agent:stderr', { sessionId, data })
    })
  }

  startAgent(options: AgentProcessOptions, initialPrompt: string): string {
    const agent = new AgentProcess(options)
    const sessionId = agent.sessionId
    this.wireEvents(sessionId, agent)
    agent.start(initialPrompt)
    this.agents.set(sessionId, agent)
    return sessionId
  }

  /**
   * Send a follow-up message to an existing session.
   * This re-spawns the CLI with --resume since -p mode exits after each turn.
   */
  sendMessage(sessionId: string, content: string): void {
    const agent = this.agents.get(sessionId)
    if (!agent) {
      throw new Error(`No agent session found for ${sessionId}`)
    }

    if (agent.isRunning) {
      throw new Error('Agent is still processing — wait for it to finish')
    }

    // Re-wire events since we'll get a new process
    agent.removeAllListeners()
    this.wireEvents(sessionId, agent)
    agent.resume(content)
  }

  /**
   * Change the model used for subsequent agent spawns.
   */
  setModel(sessionId: string, model: string | null): void {
    const agent = this.agents.get(sessionId)
    if (agent) {
      agent.setModel(model)
    }
  }

  stopAgent(sessionId: string): void {
    const agent = this.agents.get(sessionId)
    agent?.stop()
  }

  getStatus(sessionId: string): {
    isRunning: boolean
    sessionId: string | null
    projectPath: string | null
    hasSession: boolean
  } {
    const agent = this.agents.get(sessionId)
    return {
      isRunning: agent?.isRunning ?? false,
      sessionId: agent?.sessionId ?? null,
      projectPath: agent?.projectPath ?? null,
      hasSession: agent?.hasCompletedFirstTurn ?? false
    }
  }
}
