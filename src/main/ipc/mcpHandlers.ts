import { ipcMain } from 'electron'
import { McpManager, McpServerConfig, McpServerStatus } from '../mcp/McpManager'
import { SettingsManager } from '../settings/SettingsManager'
import { broadcastSend } from '../broadcast'

export function registerMcpHandlers(
  mcpManager: McpManager,
  settingsManager: SettingsManager
): void {
  // Get all MCP servers with their status
  ipcMain.handle('mcp:list', (): McpServerStatus[] => {
    return mcpManager.getServers()
  })

  // Get a single server's full config
  ipcMain.handle('mcp:get-config', (_event, id: string): McpServerConfig | null => {
    return mcpManager.getServerConfig(id)
  })

  // Add a new MCP server
  ipcMain.handle('mcp:add', async (_event, config: Omit<McpServerConfig, 'id'>): Promise<{ success: boolean; server?: McpServerConfig; error?: string }> => {
    try {
      const id = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const server: McpServerConfig = { ...config, id }
      mcpManager.upsertServer(server)
      await settingsManager.updateMcpServers(mcpManager.getConfigs())
      
      // Auto-start if configured
      if (server.autoStart) {
        mcpManager.startServer(id)
      }
      
      return { success: true, server }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Update an existing MCP server
  ipcMain.handle('mcp:update', async (_event, config: McpServerConfig): Promise<{ success: boolean; error?: string }> => {
    try {
      mcpManager.upsertServer(config)
      await settingsManager.updateMcpServers(mcpManager.getConfigs())
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Remove an MCP server
  ipcMain.handle('mcp:remove', async (_event, id: string): Promise<{ success: boolean; error?: string }> => {
    try {
      mcpManager.removeServer(id)
      await settingsManager.updateMcpServers(mcpManager.getConfigs())
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Start an MCP server
  ipcMain.handle('mcp:start', (_event, id: string): { success: boolean; error?: string } => {
    try {
      const result = mcpManager.startServer(id)
      return { success: result }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Stop an MCP server
  ipcMain.handle('mcp:stop', (_event, id: string): { success: boolean; error?: string } => {
    try {
      mcpManager.stopServer(id)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Toggle whether Claude uses this server
  ipcMain.handle('mcp:set-enabled', async (_event, id: string, enabled: boolean): Promise<{ success: boolean; error?: string }> => {
    try {
      // Handle built-in bridge separately
      if (id === 'claudex-bridge') {
        mcpManager.setBridgeEnabled(enabled)
        return { success: true }
      }
      mcpManager.setEnabled(id, enabled)
      await settingsManager.updateMcpServers(mcpManager.getConfigs())
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Refresh external configs (called when project changes)
  ipcMain.handle('mcp:refresh', async (_event, projectPath?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      await mcpManager.loadExternalConfigs(projectPath)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // Listen for status changes and broadcast to renderer
  mcpManager.on('statusChanged', (id: string) => {
    broadcastSend(mcpManager.getMainWindow(), 'mcp:status-changed', { servers: mcpManager.getServers() })
  })

  mcpManager.on('configChanged', () => {
    broadcastSend(mcpManager.getMainWindow(), 'mcp:config-changed', { servers: mcpManager.getServers() })
  })
}
