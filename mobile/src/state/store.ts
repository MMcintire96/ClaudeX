// Tiny custom store (no zustand dep needed for the mobile bundle).
// Keeps a Map<sessionId, SlimSessionState> updated from incoming WS events.

import { useEffect, useState } from 'react'
import {
  emptySlimState,
  reduceAgentEvent,
  SlimSessionState,
  UIMessage
} from '@shared/sessionEvents'
import type { ApiSession, RecentProject } from '../api'

interface State {
  sessions: ApiSession[]
  perSession: Map<string, SlimSessionState>
  projects: RecentProject[]
  selectedProjectPath: string | null
}

const state: State = { sessions: [], perSession: new Map(), projects: [], selectedProjectPath: null }
const listeners = new Set<() => void>()

function emit(): void {
  for (const l of listeners) l()
}

export function setSessions(list: ApiSession[]): void {
  state.sessions = list
  emit()
}

export function getSessions(): ApiSession[] {
  return state.sessions
}

export function setSessionMessages(sessionId: string, messages: UIMessage[]): void {
  const cur = state.perSession.get(sessionId) ?? emptySlimState()
  state.perSession.set(sessionId, { ...cur, messages })
  emit()
}

export function applyEvent(sessionId: string, event: unknown): void {
  const cur = state.perSession.get(sessionId) ?? emptySlimState()
  state.perSession.set(sessionId, reduceAgentEvent(cur, event))
  emit()
}

export function applyEvents(sessionId: string, events: unknown[]): void {
  let cur = state.perSession.get(sessionId) ?? emptySlimState()
  for (const e of events) cur = reduceAgentEvent(cur, e)
  state.perSession.set(sessionId, cur)
  emit()
}

export function setProcessing(sessionId: string, isProcessing: boolean): void {
  const cur = state.perSession.get(sessionId) ?? emptySlimState()
  state.perSession.set(sessionId, { ...cur, isProcessing, isStreaming: isProcessing ? cur.isStreaming : false })
  emit()
}

/** Append the user's outgoing text to the local message stream. The agent's
 *  response will arrive via WebSocket; the user's own message never echoes
 *  back through the agent event stream, so we have to record it ourselves. */
export function addUserMessage(sessionId: string, content: string): void {
  const cur = state.perSession.get(sessionId) ?? emptySlimState()
  const msg: UIMessage = {
    id: `user-${Date.now()}`,
    role: 'user',
    type: 'text',
    content,
    timestamp: Date.now()
  }
  state.perSession.set(sessionId, { ...cur, messages: [...cur.messages, msg] })
  emit()
}

export function getSlim(sessionId: string): SlimSessionState {
  return state.perSession.get(sessionId) ?? emptySlimState()
}

export function setSuggestion(sessionId: string, suggestion: string | null): void {
  const cur = state.perSession.get(sessionId) ?? emptySlimState()
  state.perSession.set(sessionId, { ...cur, suggestion })
  emit()
}

export function setSelectedModel(sessionId: string, model: string | null): void {
  const cur = state.perSession.get(sessionId) ?? emptySlimState()
  state.perSession.set(sessionId, { ...cur, selectedModel: model })
  emit()
}

export function setSelectedEffort(sessionId: string, effort: string | null): void {
  const cur = state.perSession.get(sessionId) ?? emptySlimState()
  state.perSession.set(sessionId, { ...cur, selectedEffort: effort })
  emit()
}

export function setProjects(list: RecentProject[]): void {
  state.projects = list
  // Auto-select most-recent if none selected.
  if (!state.selectedProjectPath && list.length > 0) {
    state.selectedProjectPath = list[0].path
  }
  emit()
}

export function getProjects(): RecentProject[] {
  return state.projects
}

export function getSelectedProjectPath(): string | null {
  return state.selectedProjectPath
}

export function setSelectedProjectPath(p: string | null): void {
  state.selectedProjectPath = p
  emit()
}

export function useSnapshot<T>(select: () => T): T {
  const [value, setValue] = useState(select)
  useEffect(() => {
    const update = (): void => setValue(select())
    listeners.add(update)
    return () => { listeners.delete(update) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return value
}
