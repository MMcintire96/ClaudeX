import { useCallback } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { useProjectStore } from '../stores/projectStore'
import { useTerminalStore } from '../stores/terminalStore'
import { DEFAULT_MODEL, DEFAULT_EFFORT } from '../constants/models'
import { SCRATCH_PROJECT_PATH } from '../constants/scratch'

export interface WorktreeOptions {
  useWorktree: boolean
  baseBranch?: string
  includeChanges?: boolean
}

export function useAgent(sessionId: string | null) {
  const session = useSessionStore(s => sessionId ? s.sessions[sessionId] ?? null : null)
  const createSession = useSessionStore(s => s.createSession)
  const replaceSessionId = useSessionStore(s => s.replaceSessionId)
  const addUserMessage = useSessionStore(s => s.addUserMessage)
  const setProcessing = useSessionStore(s => s.setProcessing)
  const setError = useSessionStore(s => s.setError)
  const setActiveSession = useSessionStore(s => s.setActiveSession)
  const restoreSession = useSessionStore(s => s.restoreSession)
  const markAsForked = useSessionStore(s => s.markAsForked)
  const currentPath = useProjectStore(s => s.currentPath)

  const isProcessing = session?.isProcessing ?? false
  const isStreaming = session?.isStreaming ?? false
  const isRunning = !!session

  const startNewSession = useCallback(async (prompt: string, worktreeOptions?: WorktreeOptions, overrideProjectPath?: string, images?: Array<{ path: string; previewUrl: string }>): Promise<string | null> => {
    const effectivePath = overrideProjectPath || currentPath
    if (!effectivePath) {
      return null
    }

    // Use the session's selected model and effort, or fall back to defaults
    const currentSession = sessionId ? useSessionStore.getState().sessions[sessionId] : null
    const model = currentSession?.selectedModel || DEFAULT_MODEL
    const effort = currentSession?.selectedEffort || DEFAULT_EFFORT
    const result = await window.api.agent.start(effectivePath, prompt, model, worktreeOptions, effort)
    if (!result.success || !result.sessionId) {
      return null
    }

    const newSessionId = result.sessionId
    const worktreeOpts = {
      worktreePath: result.worktreePath,
      worktreeSessionId: result.worktreeSessionId
    }

    // If we already have an active empty session (only system messages at most), re-key it
    // to the agent's session ID instead of creating a duplicate
    const existingMessages = sessionId ? useSessionStore.getState().sessions[sessionId]?.messages : undefined
    const hasAgentMessages = existingMessages?.some(m => m.type !== 'system') ?? false
    if (sessionId && !hasAgentMessages) {
      replaceSessionId(sessionId, newSessionId, worktreeOpts)
    } else {
      createSession(effectivePath, newSessionId, worktreeOpts)
    }
    addUserMessage(newSessionId, prompt, images)
    setProcessing(newSessionId, true)

    // Run auto-run actions only when a worktree is created (fork or worktree mode)
    if (worktreeOptions?.useWorktree && effectivePath !== SCRATCH_PROJECT_PATH) {
      window.api.project.getStartConfig(effectivePath).then(config => {
        const autoActions = (config?.actions || []).filter(a => a.autoRun && a.name && a.command)
        for (const action of autoActions) {
          window.api.terminal.create(effectivePath).then(result => {
            if (result.success && result.id) {
              useTerminalStore.getState().addTerminal({
                id: result.id,
                projectPath: effectivePath,
                pid: result.pid || 0,
                name: action.name
              })
              window.api.terminal.write(result.id, action.command + '\r')
            }
          })
        }
      })
    }

    return newSessionId
  }, [currentPath, sessionId, createSession, replaceSessionId, addUserMessage, setProcessing])

  const sendMessage = useCallback(async (content: string, images?: Array<{ path: string; previewUrl: string }>) => {
    if (!sessionId) return
    const currentSession = useSessionStore.getState().sessions[sessionId]
    addUserMessage(sessionId, content, images)
    setProcessing(sessionId, true)

    if (currentSession?.isRestored) {
      // First message to a restored session — reconnect via SDK resume
      // Use worktree path as CWD so the SDK finds the session file in the correct hash directory
      const effectivePath = currentSession.worktreePath || currentSession.projectPath
      const result = await window.api.agent.resume(
        sessionId, effectivePath, content, currentSession.selectedModel, currentSession.selectedEffort
      )
      if (result.success) {
        useSessionStore.getState().clearRestored(sessionId)
      } else {
        setProcessing(sessionId, false)
        setError(sessionId, result.error ?? 'Failed to resume session')
      }
    } else {
      const result = await window.api.agent.send(sessionId, content)
      if (!result.success) {
        setProcessing(sessionId, false)
        setError(sessionId, result.error ?? 'Failed to send message')
      }
    }
  }, [sessionId, addUserMessage, setProcessing, setError])

  const stopAgent = useCallback(async () => {
    if (!sessionId) return
    await window.api.agent.stop(sessionId)
    setProcessing(sessionId, false)
  }, [sessionId, setProcessing])

  const forkSession = useCallback(async (): Promise<{ forkAId: string; forkBId: string } | null> => {
    if (!sessionId || !currentPath) return null

    const currentSession = useSessionStore.getState().sessions[sessionId]
    if (currentSession?.projectPath === SCRATCH_PROJECT_PATH) return null
    if (!currentSession || currentSession.messages.length === 0) return null

    // The SDK session ID may differ from the UI session ID
    const sdkSessionId = currentSession.sessionId
    const effectivePath = currentSession.worktreePath || currentSession.projectPath

    const result = await window.api.agent.fork(sessionId, effectivePath, sdkSessionId)
    if (!result.success || !result.forkA || !result.forkB) {
      setError(sessionId, result.error ?? 'Failed to fork session')
      return null
    }

    const parentName = currentSession.name || 'Session'

    // Create Fork A UI session
    restoreSession({
      id: result.forkA.sessionId,
      projectPath: currentSession.projectPath,
      name: `${parentName} (Fork A)`,
      messages: [...currentSession.messages],
      model: currentSession.model,
      totalCostUsd: currentSession.totalCostUsd,
      numTurns: currentSession.numTurns,
      selectedModel: currentSession.selectedModel,
      createdAt: Date.now(),
      worktreePath: result.forkA.worktreePath,
      isWorktree: true,
      worktreeSessionId: result.forkA.worktreeSessionId,
      forkedFrom: sessionId,
      forkLabel: 'A'
    })

    // Create Fork B UI session
    restoreSession({
      id: result.forkB.sessionId,
      projectPath: currentSession.projectPath,
      name: `${parentName} (Fork B)`,
      messages: [...currentSession.messages],
      model: currentSession.model,
      totalCostUsd: currentSession.totalCostUsd,
      numTurns: currentSession.numTurns,
      selectedModel: currentSession.selectedModel,
      createdAt: Date.now(),
      worktreePath: result.forkB.worktreePath,
      isWorktree: true,
      worktreeSessionId: result.forkB.worktreeSessionId,
      forkedFrom: sessionId,
      forkLabel: 'B'
    })

    // Mark the original session as forked (read-only)
    markAsForked(sessionId, [result.forkA.sessionId, result.forkB.sessionId])

    // Switch to Fork A
    setActiveSession(result.forkA.sessionId)

    return { forkAId: result.forkA.sessionId, forkBId: result.forkB.sessionId }
  }, [sessionId, currentPath, restoreSession, markAsForked, setActiveSession, setError])

  return {
    startNewSession,
    sendMessage,
    stopAgent,
    forkSession,
    isRunning,
    isProcessing,
    isStreaming
  }
}
