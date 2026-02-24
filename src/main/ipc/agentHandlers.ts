import { ipcMain } from 'electron'
import { AgentManager } from '../agent/AgentManager'
import { WorktreeManager } from '../worktree/WorktreeManager'
import { SessionPersistence, HistoryEntry } from '../session/SessionPersistence'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export interface WorktreeOptions {
  useWorktree: boolean
  baseBranch?: string
  includeChanges?: boolean
}

export function registerAgentHandlers(agentManager: AgentManager, worktreeManager?: WorktreeManager, sessionPersistence?: SessionPersistence): void {
  ipcMain.handle('agent:start', async (_event, projectPath: string, prompt: string, model?: string | null, worktreeOptions?: WorktreeOptions) => {
    try {
      let effectivePath = projectPath
      let worktreePath: string | undefined

      if (worktreeOptions?.useWorktree && worktreeManager) {
        const sessionId = randomUUID()
        const info = await worktreeManager.create({
          projectPath,
          sessionId,
          baseBranch: worktreeOptions.baseBranch,
          includeChanges: worktreeOptions.includeChanges
        })
        effectivePath = info.worktreePath
        worktreePath = info.worktreePath

        const agentSessionId = agentManager.startAgent({ projectPath: effectivePath, model: model ?? 'claude-opus-4-6' }, prompt)
        return { success: true, sessionId: agentSessionId, worktreePath, worktreeSessionId: sessionId }
      }

      const sessionId = agentManager.startAgent({ projectPath: effectivePath, model: model ?? 'claude-opus-4-6' }, prompt)
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

  ipcMain.handle('agent:resume', (_event, sessionId: string, projectPath: string, message: string, model?: string | null) => {
    try {
      agentManager.resumeAgent(sessionId, projectPath, model ?? null, message)
      return { success: true, sessionId }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('session:add-history', (_event, entry: HistoryEntry) => {
    if (!sessionPersistence) return { success: false }
    sessionPersistence.addToHistory(entry)
    return { success: true }
  })

  ipcMain.handle('agent:fork', async (
    _event,
    sourceSessionId: string,
    projectPath: string,
    sourceSdkSessionId: string | null
  ) => {
    try {
      console.log(`[agent:fork] sourceSessionId=${sourceSessionId}, projectPath=${projectPath}, sourceSdkSessionId=${sourceSdkSessionId}`)

      // 1. Stop agent if running
      agentManager.stopAgent(sourceSessionId)

      // 2. Determine the effective SDK session ID
      const sdkSessionId = sourceSdkSessionId || sourceSessionId

      // 3. Locate the SDK session file
      //    The SDK stores sessions at ~/.claude/projects/{pathHash}/{sessionId}.jsonl
      //    where pathHash = absolute path with / replaced by -
      const projectPathHash = projectPath.replace(/\//g, '-')
      const sdkProjectDir = join(homedir(), '.claude', 'projects', projectPathHash)
      const sourceSessionFile = join(sdkProjectDir, `${sdkSessionId}.jsonl`)
      console.log(`[agent:fork] Looking for session file: ${sourceSessionFile}, exists=${existsSync(sourceSessionFile)}`)

      if (!existsSync(sourceSessionFile)) {
        return { success: false, error: 'SDK session file not found. The session may not have had any agent turns yet.' }
      }

      // 4. Generate new session IDs for forks
      const forkAId = randomUUID()
      const forkBId = randomUUID()

      // 5. Create worktrees
      if (!worktreeManager) {
        return { success: false, error: 'Worktree manager not available' }
      }

      const worktreeASessionId = randomUUID()
      const worktreeBSessionId = randomUUID()

      const [worktreeA, worktreeB] = await Promise.all([
        worktreeManager.create({
          projectPath,
          sessionId: worktreeASessionId,
          includeChanges: true
        }),
        worktreeManager.create({
          projectPath,
          sessionId: worktreeBSessionId,
          includeChanges: true
        })
      ])

      // 6. Copy SDK session file for each fork
      //    Each fork runs in its own worktree, so the SDK will look for session
      //    files under the worktree path's hash directory.
      const sessionFileContent = readFileSync(sourceSessionFile, 'utf-8')

      // Also check for session subdirectory (subagents, etc.)
      const sourceSessionDir = join(sdkProjectDir, sdkSessionId)
      const hasSessionDir = existsSync(sourceSessionDir)

      for (const [forkId, worktreeInfo] of [[forkAId, worktreeA], [forkBId, worktreeB]] as const) {
        const wtPathHash = worktreeInfo.worktreePath.replace(/\//g, '-')
        const wtSdkDir = join(homedir(), '.claude', 'projects', wtPathHash)
        mkdirSync(wtSdkDir, { recursive: true })

        // Write the copied session file with the fork's session ID
        writeFileSync(join(wtSdkDir, `${forkId}.jsonl`), sessionFileContent, 'utf-8')

        // Copy session subdirectory if it exists
        if (hasSessionDir) {
          try {
            cpSync(sourceSessionDir, join(wtSdkDir, forkId), { recursive: true })
          } catch {
            // Non-critical — subagent data is optional
          }
        }
      }

      // 7. Return fork data for the renderer to create UI sessions
      return {
        success: true,
        forkA: {
          sessionId: forkAId,
          worktreePath: worktreeA.worktreePath,
          worktreeSessionId: worktreeASessionId
        },
        forkB: {
          sessionId: forkBId,
          worktreePath: worktreeB.worktreePath,
          worktreeSessionId: worktreeBSessionId
        }
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })
}
