import { useCallback } from 'react'
import { useSessionStore } from '../stores/sessionStore'
import { useProjectStore } from '../stores/projectStore'

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

  const startNewSession = useCallback(async (prompt: string): Promise<string | null> => {
    if (!currentPath) {
      return null
    }

    const result = await window.api.agent.start(currentPath, prompt, 'claude-opus-4-6')
    if (!result.success || !result.sessionId) {
      return null
    }

    const newSessionId = result.sessionId
    createSession(currentPath, newSessionId)
    addUserMessage(newSessionId, prompt)
    setProcessing(newSessionId, true)
    return newSessionId
  }, [currentPath, createSession, addUserMessage, setProcessing])

  const sendMessage = useCallback(async (content: string) => {
    if (!sessionId) return
    addUserMessage(sessionId, content)
    setProcessing(sessionId, true)
    const result = await window.api.agent.send(sessionId, content)
    if (!result.success) {
      setProcessing(sessionId, false)
      setError(sessionId, result.error ?? 'Failed to send message')
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
