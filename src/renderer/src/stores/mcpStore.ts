import { create } from 'zustand'

export interface McpServer {
  id: string
  name: string
  running: boolean
  pid?: number
  error?: string
  enabled: boolean
  builtin?: boolean
  external?: boolean
  claudeReported?: boolean
  source?: string
  tools?: string[]
}

export interface McpServerConfig {
  id: string
  name: string
  command: string
  args: string[]
  env?: Record<string, string>
  enabled: boolean
  autoStart: boolean
}

interface McpState {
  servers: McpServer[]
  loading: boolean
  error: string | null

  loadServers: () => Promise<void>
  refreshServers: (projectPath?: string) => Promise<void>
  addServer: (config: Omit<McpServerConfig, 'id'>) => Promise<{ success: boolean; error?: string }>
  updateServer: (config: McpServerConfig) => Promise<{ success: boolean; error?: string }>
  removeServer: (id: string) => Promise<{ success: boolean; error?: string }>
  startServer: (id: string) => Promise<{ success: boolean; error?: string }>
  stopServer: (id: string) => Promise<{ success: boolean; error?: string }>
  setEnabled: (id: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>
  updateServersFromEvent: (servers: McpServer[]) => void
}

export const useMcpStore = create<McpState>((set, get) => ({
  servers: [],
  loading: false,
  error: null,

  loadServers: async (): Promise<void> => {
    set({ loading: true, error: null })
    try {
      const servers = await window.api.mcp.list()
      set({ servers, loading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  refreshServers: async (projectPath?: string): Promise<void> => {
    try {
      await window.api.mcp.refresh(projectPath)
      const servers = await window.api.mcp.list()
      set({ servers })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  addServer: async (config): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await window.api.mcp.add(config)
      if (result.success) {
        await get().loadServers()
      }
      return result
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  updateServer: async (config): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await window.api.mcp.update(config)
      if (result.success) {
        await get().loadServers()
      }
      return result
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  removeServer: async (id): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await window.api.mcp.remove(id)
      if (result.success) {
        await get().loadServers()
      }
      return result
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  startServer: async (id): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await window.api.mcp.start(id)
      // Status will be updated via event
      return result
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  stopServer: async (id): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await window.api.mcp.stop(id)
      // Status will be updated via event
      return result
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  setEnabled: async (id, enabled): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await window.api.mcp.setEnabled(id, enabled)
      if (result.success) {
        // Update local state immediately for responsiveness
        set(state => ({
          servers: state.servers.map(s => s.id === id ? { ...s, enabled } : s)
        }))
      }
      return result
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  updateServersFromEvent: (servers): void => {
    set({ servers })
  }
}))
