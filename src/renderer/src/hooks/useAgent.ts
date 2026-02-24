import { useCallback } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { useProjectStore } from '../stores/projectStore'

export interface WorktreeOptions {
  useWorktree: boolean
  baseBranch?: string
  includeChanges?: boolean
}

export function useAgent(sessionId: string | null) {
  const session = useSessionStore(s => sessionId ? s.sessions[sessionId] ?? null : null)
  const createSession = useSessionStore(s => s.createSession)
  const addUserMessage = useSessionStore(s => s.addUserMessage)
  const setProcessing = useSessionStore(s => s.setProcessing)
  const setError = useSessionStore(s => s.setError)
  const setActiveSession = useSessionStore(s => s.setActiveSession)
  const currentPath = useProjectStore(s => s.currentPath)

  const isProcessing = session?.isProcessing ?? false
  const isStreaming = session?.isStreaming ?? false
  const isRunning = !!session

  const startNewSession = useCallback(async (prompt: string, worktreeOptions?: WorktreeOptions): Promise<string | null> => {
    if (!currentPath) {
      return null
    }

    const result = await window.api.agent.start(currentPath, prompt, 'claude-opus-4-6', worktreeOptions)
    if (!result.success || !result.sessionId) {
      return null
    }

    const newSessionId = result.sessionId
    createSession(currentPath, newSessionId, {
      worktreePath: result.worktreePath,
      worktreeSessionId: result.worktreeSessionId
    })
    addUserMessage(newSessionId, prompt)
    setProcessing(newSessionId, true)
    return newSessionId
  }, [currentPath, createSession, addUserMessage, setProcessing])

  const sendMessage = useCallback(async (content: string) => {
    if (!sessionId) return
    const currentSession = useSessionStore.getState().sessions[sessionId]
    addUserMessage(sessionId, content)
    setProcessing(sessionId, true)

    if (currentSession?.isRestored) {
      // First message to a restored session — reconnect via SDK resume
      const result = await window.api.agent.resume(
        sessionId, currentSession.projectPath, content, currentSession.selectedModel
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

  return {
    startNewSession,
    sendMessage,
    stopAgent,
    isRunning,
    isProcessing,
    isStreaming
  }
}
