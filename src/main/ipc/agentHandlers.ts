import { ipcMain } from 'electron'
import { AgentManager } from '../agent/AgentManager'
import { WorktreeManager } from '../worktree/WorktreeManager'
import { SessionPersistence, HistoryEntry } from '../session/SessionPersistence'
import { ClaudexBridgeServer } from '../bridge/ClaudexBridgeServer'
import { randomUUID } from 'crypto'
import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

interface WorktreeOptions {
  useWorktree: boolean
  baseBranch?: string
  includeChanges?: boolean
}

const SCRATCH_PROJECT_PATH = '__scratch__'

/** Match the SDK's project-path hashing (Cx function in cli.js) */
function sdkPathHash(p: string): string {
  const hash = p.replace(/[^a-zA-Z0-9]/g, '-')
  if (hash.length <= 200) return hash
  // SDK truncates long paths and appends a simple hash
  let h = 0
  for (let i = 0; i < p.length; i++) {
    h = (h << 5) - h + p.charCodeAt(i)
    h |= 0
  }
  return `${hash.slice(0, 200)}-${Math.abs(h).toString(36)}`
}

export function registerAgentHandlers(agentManager: AgentManager, worktreeManager?: WorktreeManager, sessionPersistence?: SessionPersistence, bridgeServer?: ClaudexBridgeServer): void {
  ipcMain.handle('agent:start', async (_event, projectPath: string, prompt: string, model?: string | null, worktreeOptions?: WorktreeOptions, effort?: string | null) => {
    try {
      let effectivePath = projectPath
      let worktreePath: string | undefined

      // Quick chats: resolve sentinel to home directory, skip worktrees
      if (projectPath === SCRATCH_PROJECT_PATH) {
        effectivePath = homedir()
        const sessionId = await agentManager.startAgent({ projectPath: effectivePath, model: model ?? 'claude-opus-4-6', effort }, prompt)
        return { success: true, sessionId }
      }

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

        const agentSessionId = await agentManager.startAgent({ projectPath: effectivePath, model: model ?? 'claude-opus-4-6', effort }, prompt)
        return { success: true, sessionId: agentSessionId, worktreePath, worktreeSessionId: sessionId }
      }

      const sessionId = await agentManager.startAgent({ projectPath: effectivePath, model: model ?? 'claude-opus-4-6', effort }, prompt)
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

  ipcMain.handle('agent:set-effort', (_event, sessionId: string, effort: string | null) => {
    agentManager.setEffort(sessionId, effort)
    return { success: true }
  })

  ipcMain.handle('agent:resume', async (_event, sessionId: string, projectPath: string, message: string, model?: string | null, effort?: string | null) => {
    try {
      const effectivePath = projectPath === SCRATCH_PROJECT_PATH ? homedir() : projectPath
      await agentManager.resumeAgent(sessionId, effectivePath, model ?? null, message, effort ?? null)
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
      if (projectPath === SCRATCH_PROJECT_PATH) {
        return { success: false, error: 'Quick chats cannot be forked' }
      }

      console.log(`[agent:fork] sourceSessionId=${sourceSessionId}, projectPath=${projectPath}, sourceSdkSessionId=${sourceSdkSessionId}`)

      // 1. Stop agent if running
      agentManager.stopAgent(sourceSessionId)

      // 2. Determine the effective SDK session ID
      const sdkSessionId = sourceSdkSessionId || sourceSessionId

      // 3. Locate the SDK session file
      //    The SDK stores sessions at ~/.claude/projects/{pathHash}/{sessionId}.jsonl
      //    where pathHash = every non-alphanumeric char replaced by -
      const projectPathHash = sdkPathHash(projectPath)
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
      //    We must rewrite sessionId and cwd in every JSONL line so the SDK
      //    recognises the file as belonging to the fork session.
      const sessionFileContent = readFileSync(sourceSessionFile, 'utf-8')

      // Also check for session subdirectory (subagents, etc.)
      const sourceSessionDir = join(sdkProjectDir, sdkSessionId)
      const hasSessionDir = existsSync(sourceSessionDir)

      for (const [forkId, worktreeInfo] of [[forkAId, worktreeA], [forkBId, worktreeB]] as const) {
        // Create per-worktree plansDirectory so forked sessions don't share
        // the global ~/.claude/plans/ directory. The SDK's module-level
        // session state can cause concurrent forks to resolve the same plan
        // file slug, leading to plan overwrites.
        const wtClaudeDir = join(worktreeInfo.worktreePath, '.claude')
        mkdirSync(wtClaudeDir, { recursive: true })
        const localSettingsPath = join(wtClaudeDir, 'settings.local.json')
        if (!existsSync(localSettingsPath)) {
          writeFileSync(localSettingsPath, JSON.stringify({ plansDirectory: '.claude/plans' }, null, 2), 'utf-8')
        }

        const wtPathHash = sdkPathHash(worktreeInfo.worktreePath)
        const wtSdkDir = join(homedir(), '.claude', 'projects', wtPathHash)
        mkdirSync(wtSdkDir, { recursive: true })

        // Rewrite sessionId and cwd in each JSONL line to match the fork
        const rewrittenContent = sessionFileContent
          .split('\n')
          .map(line => {
            if (!line.trim()) return line
            try {
              const obj = JSON.parse(line)
              if (obj.sessionId) obj.sessionId = forkId
              if (obj.cwd) obj.cwd = worktreeInfo.worktreePath
              return JSON.stringify(obj)
            } catch {
              return line
            }
          })
          .join('\n')

        writeFileSync(join(wtSdkDir, `${forkId}.jsonl`), rewrittenContent, 'utf-8')

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

  ipcMain.handle('agent:pair-sessions', (_event, sessionA: string, sessionB: string) => {
    agentManager.pairSessions(sessionA, sessionB)
    return { success: true }
  })

  ipcMain.handle('agent:unpair-sessions', (_event, sessionId: string) => {
    agentManager.unpairSession(sessionId)
    return { success: true }
  })

  ipcMain.handle('agent:link-sessions', (
    _event,
    sessionA: { id: string; name: string },
    sessionB: { id: string; name: string }
  ) => {
    if (!bridgeServer) {
      return { success: false, error: 'Bridge server not available' }
    }

    // Deposit an introduction message in each session's MCP inbox
    bridgeServer.injectMessage(
      sessionA.id,
      sessionB.id,
      sessionB.name,
      `[Collaboration link] You are now paired with another Claude session named "${sessionB.name}" (session ID: ${sessionB.id}). ` +
      `You can send messages to them with session_send(to="${sessionB.id}", content="...") and read their messages with session_read(). ` +
      `Coordinate your work — they can see the same project files you can.`
    )

    bridgeServer.injectMessage(
      sessionB.id,
      sessionA.id,
      sessionA.name,
      `[Collaboration link] You are now paired with another Claude session named "${sessionA.name}" (session ID: ${sessionA.id}). ` +
      `You can send messages to them with session_send(to="${sessionA.id}", content="...") and read their messages with session_read(). ` +
      `Coordinate your work — they can see the same project files you can.`
    )

    return { success: true }
  })
}
