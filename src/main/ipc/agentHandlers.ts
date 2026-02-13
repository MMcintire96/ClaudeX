import { ipcMain } from 'electron'
import { AgentManager } from '../agent/AgentManager'

export function registerAgentHandlers(agentManager: AgentManager): void {
  ipcMain.handle('agent:start', (_event, projectPath: string, prompt: string) => {
    try {
      const sessionId = agentManager.startAgent({ projectPath }, prompt)
      return { success: true, sessionId }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('agent:send', (_event, sessionId: string, content: string) => {
    try {
      agentManager.sendMessage(sessionId, content)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('agent:stop', (_event, sessionId: string) => {
    agentManager.stopAgent(sessionId)
    return { success: true }
  })

  ipcMain.handle('agent:status', (_event, sessionId: string) => {
    return agentManager.getStatus(sessionId)
  })

  ipcMain.handle('agent:set-model', (_event, sessionId: string, model: string | null) => {
    agentManager.setModel(sessionId, model)
    return { success: true }
  })
}
