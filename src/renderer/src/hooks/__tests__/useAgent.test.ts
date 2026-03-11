// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAgent } from '../useAgent'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'

const api = window.api as any

// Reset stores and mocks between tests
beforeEach(() => {
  useSessionStore.setState({
    sessions: {},
    activeSessionId: null,
    sessionOrder: []
  })
  useProjectStore.setState({
    currentPath: '/test/project',
    projects: {},
    projectOrder: [],
    expandedProjects: []
  })
  vi.clearAllMocks()
})

describe('useAgent - derived state', () => {
  it('returns default state when no session', () => {
    const { result } = renderHook(() => useAgent(null))
    expect(result.current.isRunning).toBe(false)
    expect(result.current.isProcessing).toBe(false)
    expect(result.current.isStreaming).toBe(false)
  })

  it('returns default state for missing sessionId', () => {
    const { result } = renderHook(() => useAgent('nonexistent'))
    expect(result.current.isRunning).toBe(false)
    expect(result.current.isProcessing).toBe(false)
  })

  it('reflects session state', () => {
    useSessionStore.getState().createSession('/test/project', 'sess-1')
    useSessionStore.getState().setProcessing('sess-1', true)

    const { result } = renderHook(() => useAgent('sess-1'))
    expect(result.current.isRunning).toBe(true)
    expect(result.current.isProcessing).toBe(true)
  })
})

describe('useAgent - startNewSession', () => {
  it('starts a new session via IPC', async () => {
    api.agent.start.mockResolvedValue({
      success: true,
      sessionId: 'new-sess',
      worktreePath: undefined,
      worktreeSessionId: undefined
    })

    const { result } = renderHook(() => useAgent(null))

    let newId: string | null = null
    await act(async () => {
      newId = await result.current.startNewSession('hello')
    })

    expect(newId).toBe('new-sess')
    expect(api.agent.start).toHaveBeenCalledWith(
      '/test/project', 'hello', expect.any(String), undefined, expect.any(String)
    )
    // Session should exist in store
    expect(useSessionStore.getState().sessions['new-sess']).toBeDefined()
  })

  it('returns null when no project path', async () => {
    useProjectStore.setState({ currentPath: null })

    const { result } = renderHook(() => useAgent(null))

    let newId: string | null = null
    await act(async () => {
      newId = await result.current.startNewSession('hello')
    })

    expect(newId).toBeNull()
    expect(api.agent.start).not.toHaveBeenCalled()
  })

  it('returns null when IPC fails', async () => {
    api.agent.start.mockResolvedValue({ success: false })

    const { result } = renderHook(() => useAgent(null))

    let newId: string | null = null
    await act(async () => {
      newId = await result.current.startNewSession('hello')
    })

    expect(newId).toBeNull()
  })

  it('replaces empty session instead of creating new one', async () => {
    // Create an empty session first
    useSessionStore.getState().createSession('/test/project', 'empty-sess')
    useSessionStore.getState().setActiveSession('empty-sess')

    api.agent.start.mockResolvedValue({
      success: true,
      sessionId: 'real-sess'
    })

    const { result } = renderHook(() => useAgent('empty-sess'))

    await act(async () => {
      await result.current.startNewSession('hello')
    })

    // Old session should be gone, new one should exist
    expect(useSessionStore.getState().sessions['empty-sess']).toBeUndefined()
    expect(useSessionStore.getState().sessions['real-sess']).toBeDefined()
  })

  it('uses override project path', async () => {
    api.agent.start.mockResolvedValue({
      success: true,
      sessionId: 'new-sess'
    })

    const { result } = renderHook(() => useAgent(null))

    await act(async () => {
      await result.current.startNewSession('hello', undefined, '/override/path')
    })

    expect(api.agent.start).toHaveBeenCalledWith(
      '/override/path', 'hello', expect.any(String), undefined, expect.any(String)
    )
  })
})

describe('useAgent - sendMessage', () => {
  it('sends message via IPC', async () => {
    useSessionStore.getState().createSession('/test/project', 'sess-1')
    useSessionStore.getState().setActiveSession('sess-1')
    api.agent.send.mockResolvedValue({ success: true })

    const { result } = renderHook(() => useAgent('sess-1'))

    await act(async () => {
      await result.current.sendMessage('hello')
    })

    expect(api.agent.send).toHaveBeenCalledWith('sess-1', 'hello')
    // Should have added user message
    const msgs = useSessionStore.getState().sessions['sess-1'].messages
    expect(msgs.some((m: any) => m.type === 'text' && m.role === 'user' && m.content === 'hello')).toBe(true)
  })

  it('sets error on send failure', async () => {
    useSessionStore.getState().createSession('/test/project', 'sess-1')
    api.agent.send.mockResolvedValue({ success: false, error: 'network error' })

    const { result } = renderHook(() => useAgent('sess-1'))

    await act(async () => {
      await result.current.sendMessage('hello')
    })

    expect(useSessionStore.getState().sessions['sess-1'].error).toBe('network error')
  })

  it('resumes restored session instead of sending', async () => {
    useSessionStore.getState().createSession('/test/project', 'sess-1')
    useSessionStore.setState(s => ({
      sessions: {
        ...s.sessions,
        'sess-1': { ...s.sessions['sess-1'], isRestored: true }
      }
    }))
    api.agent.resume.mockResolvedValue({ success: true })

    const { result } = renderHook(() => useAgent('sess-1'))

    await act(async () => {
      await result.current.sendMessage('hello')
    })

    expect(api.agent.resume).toHaveBeenCalled()
    expect(api.agent.send).not.toHaveBeenCalled()
  })

  it('does nothing when no sessionId', async () => {
    const { result } = renderHook(() => useAgent(null))

    await act(async () => {
      await result.current.sendMessage('hello')
    })

    expect(api.agent.send).not.toHaveBeenCalled()
  })
})

describe('useAgent - stopAgent', () => {
  it('stops agent via IPC', async () => {
    useSessionStore.getState().createSession('/test/project', 'sess-1')
    useSessionStore.getState().setProcessing('sess-1', true)
    api.agent.stop.mockResolvedValue(undefined)

    const { result } = renderHook(() => useAgent('sess-1'))

    await act(async () => {
      await result.current.stopAgent()
    })

    expect(api.agent.stop).toHaveBeenCalledWith('sess-1')
    expect(useSessionStore.getState().sessions['sess-1'].isProcessing).toBe(false)
  })

  it('does nothing when no sessionId', async () => {
    const { result } = renderHook(() => useAgent(null))

    await act(async () => {
      await result.current.stopAgent()
    })

    expect(api.agent.stop).not.toHaveBeenCalled()
  })
})

describe('useAgent - forkSession', () => {
  it('forks session and creates two new sessions', async () => {
    useSessionStore.getState().createSession('/test/project', 'sess-1')
    useSessionStore.getState().addUserMessage('sess-1', 'hello')
    useSessionStore.getState().setActiveSession('sess-1')

    api.agent.fork.mockResolvedValue({
      success: true,
      forkA: { sessionId: 'fork-a', worktreePath: '/wt/a', worktreeSessionId: 'wt-a' },
      forkB: { sessionId: 'fork-b', worktreePath: '/wt/b', worktreeSessionId: 'wt-b' }
    })

    const { result } = renderHook(() => useAgent('sess-1'))

    let forkResult: any
    await act(async () => {
      forkResult = await result.current.forkSession()
    })

    expect(forkResult).toEqual({ forkAId: 'fork-a', forkBId: 'fork-b' })
    expect(useSessionStore.getState().sessions['fork-a']).toBeDefined()
    expect(useSessionStore.getState().sessions['fork-b']).toBeDefined()
    // Original should be marked as forked
    expect(useSessionStore.getState().sessions['sess-1'].isForkParent).toBe(true)
    // Active session should be fork A
    expect(useSessionStore.getState().activeSessionId).toBe('fork-a')
  })

  it('returns null when no sessionId', async () => {
    const { result } = renderHook(() => useAgent(null))

    let forkResult: any
    await act(async () => {
      forkResult = await result.current.forkSession()
    })

    expect(forkResult).toBeNull()
  })

  it('returns null for empty session', async () => {
    useSessionStore.getState().createSession('/test/project', 'sess-1')
    useSessionStore.getState().setActiveSession('sess-1')

    const { result } = renderHook(() => useAgent('sess-1'))

    let forkResult: any
    await act(async () => {
      forkResult = await result.current.forkSession()
    })

    expect(forkResult).toBeNull()
    expect(api.agent.fork).not.toHaveBeenCalled()
  })

  it('returns null for scratch project', async () => {
    useSessionStore.getState().createSession('__scratch__', 'sess-1')
    useSessionStore.getState().addUserMessage('sess-1', 'hello')
    useSessionStore.getState().setActiveSession('sess-1')

    const { result } = renderHook(() => useAgent('sess-1'))

    let forkResult: any
    await act(async () => {
      forkResult = await result.current.forkSession()
    })

    expect(forkResult).toBeNull()
  })

  it('sets error on fork failure', async () => {
    useSessionStore.getState().createSession('/test/project', 'sess-1')
    useSessionStore.getState().addUserMessage('sess-1', 'hello')
    useSessionStore.getState().setActiveSession('sess-1')

    api.agent.fork.mockResolvedValue({ success: false, error: 'fork failed' })

    const { result } = renderHook(() => useAgent('sess-1'))

    let forkResult: any
    await act(async () => {
      forkResult = await result.current.forkSession()
    })

    expect(forkResult).toBeNull()
    expect(useSessionStore.getState().sessions['sess-1'].error).toBe('fork failed')
  })
})
