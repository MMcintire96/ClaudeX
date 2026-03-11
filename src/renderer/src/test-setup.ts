import { vi } from 'vitest'

// Mock window.api used by stores and hooks
const windowApi = {
  agent: {
    unpairSessions: vi.fn(),
    start: vi.fn(),
    send: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
    fork: vi.fn()
  },
  project: {
    getStartConfig: vi.fn().mockResolvedValue(null)
  },
  terminal: {
    rename: vi.fn(),
    create: vi.fn().mockResolvedValue({ success: false }),
    write: vi.fn().mockResolvedValue({ success: true })
  },
  mcp: {
    getServers: vi.fn(),
    addServer: vi.fn(),
    updateServer: vi.fn(),
    removeServer: vi.fn(),
    startServer: vi.fn(),
    stopServer: vi.fn(),
    setEnabled: vi.fn()
  },
  settings: {
    get: vi.fn(),
    set: vi.fn()
  }
}

if (typeof globalThis.window !== 'undefined' && globalThis.window.document) {
  // jsdom environment (hook tests) — extend existing window
  ;(window as any).api = windowApi
} else {
  // Node environment (store/utility tests) — create minimal window
  Object.defineProperty(globalThis, 'window', {
    value: { api: windowApi, innerWidth: 1920 },
    writable: true
  })
}
