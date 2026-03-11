import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useMcpStore, McpServer } from '../mcpStore'

const store = useMcpStore

const mockServers: McpServer[] = [
  { id: 's1', name: 'Server 1', running: true, enabled: true },
  { id: 's2', name: 'Server 2', running: false, enabled: false }
]

function resetStore(): void {
  store.setState({
    servers: [],
    loading: false,
    error: null
  })
}

function mockMcpApi(overrides: Record<string, unknown> = {}): void {
  ;(window as Record<string, unknown>).api = {
    ...(window as Record<string, unknown>).api as object,
    mcp: {
      list: vi.fn().mockResolvedValue(mockServers),
      refresh: vi.fn().mockResolvedValue(undefined),
      add: vi.fn().mockResolvedValue({ success: true }),
      update: vi.fn().mockResolvedValue({ success: true }),
      remove: vi.fn().mockResolvedValue({ success: true }),
      start: vi.fn().mockResolvedValue({ success: true }),
      stop: vi.fn().mockResolvedValue({ success: true }),
      setEnabled: vi.fn().mockResolvedValue({ success: true }),
      ...overrides
    }
  }
}

beforeEach(() => {
  resetStore()
  mockMcpApi()
})

describe('loadServers', () => {
  it('loads servers from API', async () => {
    await store.getState().loadServers()
    expect(store.getState().servers).toEqual(mockServers)
    expect(store.getState().loading).toBe(false)
  })

  it('sets loading state during fetch', async () => {
    const promise = store.getState().loadServers()
    expect(store.getState().loading).toBe(true)
    await promise
    expect(store.getState().loading).toBe(false)
  })

  it('handles errors', async () => {
    mockMcpApi({ list: vi.fn().mockRejectedValue(new Error('Network error')) })
    await store.getState().loadServers()
    expect(store.getState().error).toBe('Network error')
    expect(store.getState().loading).toBe(false)
  })
})

describe('refreshServers', () => {
  it('refreshes and reloads server list', async () => {
    await store.getState().refreshServers('/project')
    const api = (window as Record<string, unknown>).api as Record<string, Record<string, ReturnType<typeof vi.fn>>>
    expect(api.mcp.refresh).toHaveBeenCalledWith('/project')
    expect(store.getState().servers).toEqual(mockServers)
  })

  it('sets error on failure', async () => {
    mockMcpApi({ refresh: vi.fn().mockRejectedValue(new Error('Refresh failed')) })
    await store.getState().refreshServers()
    expect(store.getState().error).toBe('Refresh failed')
  })
})

describe('addServer', () => {
  it('adds server and reloads list on success', async () => {
    const result = await store.getState().addServer({
      name: 'New', command: 'node', args: ['server.js'], enabled: true, autoStart: false
    })
    expect(result.success).toBe(true)
    expect(store.getState().servers).toEqual(mockServers)
  })

  it('returns error on failure', async () => {
    mockMcpApi({ add: vi.fn().mockResolvedValue({ success: false, error: 'Duplicate' }) })
    const result = await store.getState().addServer({
      name: 'New', command: 'node', args: [], enabled: true, autoStart: false
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe('Duplicate')
  })

  it('catches thrown errors', async () => {
    mockMcpApi({ add: vi.fn().mockRejectedValue(new Error('Boom')) })
    const result = await store.getState().addServer({
      name: 'New', command: 'node', args: [], enabled: true, autoStart: false
    })
    expect(result).toEqual({ success: false, error: 'Boom' })
  })
})

describe('updateServer', () => {
  it('updates and reloads on success', async () => {
    const result = await store.getState().updateServer({
      id: 's1', name: 'Updated', command: 'node', args: [], enabled: true, autoStart: true
    })
    expect(result.success).toBe(true)
    expect(store.getState().servers).toEqual(mockServers)
  })
})

describe('removeServer', () => {
  it('removes and reloads on success', async () => {
    const result = await store.getState().removeServer('s1')
    expect(result.success).toBe(true)
  })

  it('does not reload on failure', async () => {
    const listFn = vi.fn().mockResolvedValue([])
    mockMcpApi({
      remove: vi.fn().mockResolvedValue({ success: false, error: 'Not found' }),
      list: listFn
    })
    await store.getState().removeServer('s1')
    expect(listFn).not.toHaveBeenCalled()
  })
})

describe('startServer / stopServer', () => {
  it('starts a server', async () => {
    const result = await store.getState().startServer('s1')
    expect(result.success).toBe(true)
  })

  it('stops a server', async () => {
    const result = await store.getState().stopServer('s1')
    expect(result.success).toBe(true)
  })

  it('returns error on start failure', async () => {
    mockMcpApi({ start: vi.fn().mockRejectedValue(new Error('Cannot start')) })
    const result = await store.getState().startServer('s1')
    expect(result).toEqual({ success: false, error: 'Cannot start' })
  })
})

describe('setEnabled', () => {
  it('updates local state optimistically on success', async () => {
    store.setState({ servers: [...mockServers] })
    await store.getState().setEnabled('s2', true)
    const s2 = store.getState().servers.find(s => s.id === 's2')
    expect(s2!.enabled).toBe(true)
  })

  it('does not update local state on failure', async () => {
    mockMcpApi({ setEnabled: vi.fn().mockResolvedValue({ success: false }) })
    store.setState({ servers: [...mockServers] })
    await store.getState().setEnabled('s2', true)
    const s2 = store.getState().servers.find(s => s.id === 's2')
    expect(s2!.enabled).toBe(false)
  })
})

describe('updateServersFromEvent', () => {
  it('replaces server list', () => {
    const newServers: McpServer[] = [{ id: 's3', name: 'New', running: true, enabled: true }]
    store.getState().updateServersFromEvent(newServers)
    expect(store.getState().servers).toEqual(newServers)
  })
})
