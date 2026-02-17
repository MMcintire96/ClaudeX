import { ipcMain } from 'electron'
import { SessionFileWatcher } from '../session/SessionFileWatcher'

export function registerSessionFileHandlers(sessionFileWatcher: SessionFileWatcher): void {
  ipcMain.handle('session-file:watch', (_event, terminalId: string, claudeSessionId: string, projectPath: string) => {
    try {
      const entries = sessionFileWatcher.watch(terminalId, claudeSessionId, projectPath)
      return { success: true, entries }
    } catch (error) {
      console.error('[SessionFile] Watch error:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('session-file:unwatch', (_event, terminalId: string) => {
    try {
      sessionFileWatcher.unwatch(terminalId)
      return { success: true }
    } catch (error) {
      console.error('[SessionFile] Unwatch error:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('session-file:find-latest', (_event, projectPath: string, afterTimestamp?: number) => {
    try {
      const sessionId = sessionFileWatcher.findLatestSessionId(projectPath, afterTimestamp)
      return { success: true, sessionId }
    } catch (error) {
      console.error('[SessionFile] Find latest error:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('session-file:read', (_event, claudeSessionId: string, projectPath: string) => {
    try {
      const entries = sessionFileWatcher.readAll(claudeSessionId, projectPath)
      return { success: true, entries }
    } catch (error) {
      console.error('[SessionFile] Read error:', error)
      return { success: false, error: String(error) }
    }
  })
}
