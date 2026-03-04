import React, { useEffect, useState, useCallback } from 'react'
import { useMcpStore, McpServer, McpServerConfig } from '../../stores/mcpStore'
import { useProjectStore } from '../../stores/projectStore'

interface EditingServer {
  id?: string
  name: string
  command: string
  args: string
  env: string
  enabled: boolean
  autoStart: boolean
}

const emptyServer: EditingServer = {
  name: '',
  command: '',
  args: '',
  env: '',
  enabled: true,
  autoStart: false
}

export default function MCPConfigPanel() {
  const { servers, loading, loadServers, refreshServers, addServer, updateServer, removeServer, startServer, stopServer, setEnabled, updateServersFromEvent } = useMcpStore()
  const currentPath = useProjectStore(s => s.currentPath)
  const [editing, setEditing] = useState<EditingServer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    // Load servers and refresh with current project path
    refreshServers(currentPath ?? undefined)

    // Subscribe to status changes
    const unsubStatus = window.api.mcp.onStatusChanged(({ servers }) => {
      updateServersFromEvent(servers)
    })
    const unsubConfig = window.api.mcp.onConfigChanged(({ servers }) => {
      updateServersFromEvent(servers)
    })

    return () => {
      unsubStatus()
      unsubConfig()
    }
  }, [currentPath, refreshServers, updateServersFromEvent])

  const handleAdd = useCallback(() => {
    setEditing({ ...emptyServer })
    setError(null)
  }, [])

  const handleEdit = useCallback(async (server: McpServer) => {
    // Load full config for editing
    const config = await window.api.mcp.getConfig(server.id)
    if (config) {
      setEditing({
        id: config.id,
        name: config.name,
        command: config.command,
        args: config.args.join(' '),
        env: config.env ? Object.entries(config.env).map(([k, v]) => `${k}=${v}`).join('\n') : '',
        enabled: config.enabled,
        autoStart: config.autoStart
      })
    } else {
      setEditing({
        id: server.id,
        name: server.name,
        command: '',
        args: '',
        env: '',
        enabled: server.enabled,
        autoStart: false
      })
    }
    setError(null)
  }, [])

  const handleCancel = useCallback(() => {
    setEditing(null)
    setError(null)
  }, [])

  const handleSave = useCallback(async () => {
    if (!editing) return

    if (!editing.name.trim()) {
      setError('Name is required')
      return
    }
    if (!editing.command.trim()) {
      setError('Command is required')
      return
    }

    setSaving(true)
    setError(null)

    try {
      // Parse args - split by spaces, respecting quotes
      const args = editing.args.trim() ? parseArgs(editing.args) : []
      
      // Parse env - format: KEY=value, one per line
      let env: Record<string, string> | undefined
      if (editing.env.trim()) {
        env = {}
        for (const line of editing.env.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed) continue
          const eqIndex = trimmed.indexOf('=')
          if (eqIndex > 0) {
            env[trimmed.slice(0, eqIndex)] = trimmed.slice(eqIndex + 1)
          }
        }
      }

      const config = {
        name: editing.name.trim(),
        command: editing.command.trim(),
        args,
        env,
        enabled: editing.enabled,
        autoStart: editing.autoStart
      }

      let result: { success: boolean; error?: string }
      if (editing.id) {
        result = await updateServer({ ...config, id: editing.id })
      } else {
        result = await addServer(config)
      }

      if (result.success) {
        setEditing(null)
      } else {
        setError(result.error || 'Failed to save')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [editing, addServer, updateServer])

  const handleDelete = useCallback(async (id: string) => {
    const result = await removeServer(id)
    if (!result.success) {
      setError(result.error || 'Failed to remove server')
    }
  }, [removeServer])

  const handleToggleEnabled = useCallback(async (server: McpServer) => {
    await setEnabled(server.id, !server.enabled)
  }, [setEnabled])

  const handleToggleRunning = useCallback(async (server: McpServer) => {
    if (server.running) {
      await stopServer(server.id)
    } else {
      await startServer(server.id)
    }
  }, [startServer, stopServer])

  return (
    <div className="mcp-config-panel">
      <div className="mcp-header">
        <div className="mcp-title">
          <span>MCP Servers</span>
          <span className="mcp-subtitle">Model Context Protocol servers for Claude</span>
        </div>
        <button className="btn btn-sm btn-primary" onClick={handleAdd}>
          + Add Server
        </button>
      </div>

      {loading && servers.length === 0 && (
        <div className="mcp-loading">Loading...</div>
      )}

      {!loading && servers.length === 0 && !editing && (
        <div className="mcp-empty">
          <span>No MCP servers configured</span>
          <span className="mcp-empty-hint">Add an MCP server to give Claude additional capabilities</span>
        </div>
      )}

      {servers.length > 0 && (
        <div className="mcp-server-list">
          {servers.map(server => (
            <div key={server.id} className={`mcp-server-item${server.error ? ' mcp-server-error' : ''}${server.builtin ? ' mcp-server-builtin' : ''}${server.external ? ' mcp-server-external' : ''}${server.claudeReported ? ' mcp-server-claude' : ''}`}>
              <div className="mcp-server-info">
                <div className="mcp-server-name-row">
                  <span className={`mcp-status-dot${server.running ? ' running' : ''}`} />
                  <span className="mcp-server-name">{server.name}</span>
                  {server.builtin && <span className="mcp-server-badge">Built-in</span>}
                  {server.external && <span className="mcp-server-badge mcp-badge-external">External</span>}
                  {server.claudeReported && <span className="mcp-server-badge mcp-badge-claude">Remote</span>}
                  {server.pid && <span className="mcp-server-pid">PID: {server.pid}</span>}
                </div>
                {server.source && (
                  <div className="mcp-server-source">{server.source}</div>
                )}
                {server.claudeReported && server.tools && server.tools.length > 0 && (
                  <div className="mcp-server-tools">
                    <span className="mcp-tools-label">Tools: </span>
                    <span className="mcp-tools-list">{server.tools.slice(0, 5).join(', ')}{server.tools.length > 5 ? `, +${server.tools.length - 5} more` : ''}</span>
                  </div>
                )}
                {server.error && (
                  <div className="mcp-server-error-msg">{server.error}</div>
                )}
              </div>
              <div className="mcp-server-actions">
                {!server.external && (
                  <label className="settings-toggle mcp-toggle" title={server.enabled ? 'Enabled for Claude' : 'Disabled for Claude'}>
                    <input
                      type="checkbox"
                      checked={server.enabled}
                      onChange={() => handleToggleEnabled(server)}
                    />
                    <span className="settings-toggle-slider" />
                  </label>
                )}
                {!server.builtin && !server.external && !server.claudeReported && (
                  <>
                    <button
                      className={`btn btn-sm${server.running ? ' btn-stop' : ' btn-start'}`}
                      onClick={() => handleToggleRunning(server)}
                      title={server.running ? 'Stop server' : 'Start server'}
                    >
                      {server.running ? 'Stop' : 'Start'}
                    </button>
                    <button
                      className="btn btn-sm btn-icon btn-edit"
                      onClick={() => handleEdit(server)}
                      title="Edit server"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                    <button
                      className="btn btn-sm btn-icon"
                      onClick={() => handleDelete(server.id)}
                      title="Delete server"
                    >
                      &times;
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <div className="mcp-edit-form">
          <div className="mcp-edit-title">
            {editing.id ? 'Edit Server' : 'Add Server'}
          </div>
          
          {error && (
            <div className="mcp-edit-error">{error}</div>
          )}

          <div className="mcp-edit-field">
            <label>Name</label>
            <input
              type="text"
              value={editing.name}
              onChange={e => setEditing({ ...editing, name: e.target.value })}
              placeholder="My MCP Server"
              autoFocus
            />
          </div>

          <div className="mcp-edit-field">
            <label>Command</label>
            <input
              type="text"
              value={editing.command}
              onChange={e => setEditing({ ...editing, command: e.target.value })}
              placeholder="node, python, npx, etc."
            />
          </div>

          <div className="mcp-edit-field">
            <label>Arguments <span className="mcp-field-hint">(space-separated)</span></label>
            <input
              type="text"
              value={editing.args}
              onChange={e => setEditing({ ...editing, args: e.target.value })}
              placeholder="/path/to/server.js --port 8080"
            />
          </div>

          <div className="mcp-edit-field">
            <label>Environment <span className="mcp-field-hint">(KEY=value, one per line)</span></label>
            <textarea
              value={editing.env}
              onChange={e => setEditing({ ...editing, env: e.target.value })}
              placeholder="API_KEY=xxx&#10;DEBUG=true"
              rows={3}
            />
          </div>

          <div className="mcp-edit-row">
            <label className="mcp-checkbox">
              <input
                type="checkbox"
                checked={editing.enabled}
                onChange={e => setEditing({ ...editing, enabled: e.target.checked })}
              />
              <span>Enable for Claude</span>
            </label>
            <label className="mcp-checkbox">
              <input
                type="checkbox"
                checked={editing.autoStart}
                onChange={e => setEditing({ ...editing, autoStart: e.target.checked })}
              />
              <span>Auto-start on launch</span>
            </label>
          </div>

          <div className="mcp-edit-actions">
            <button className="btn btn-sm" onClick={handleCancel} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-sm btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Parse command line arguments, respecting quotes
function parseArgs(input: string): string[] {
  const args: string[] = []
  let current = ''
  let inQuote: string | null = null

  for (let i = 0; i < input.length; i++) {
    const char = input[i]
    
    if (inQuote) {
      if (char === inQuote) {
        inQuote = null
      } else {
        current += char
      }
    } else if (char === '"' || char === "'") {
      inQuote = char
    } else if (char === ' ' || char === '\t') {
      if (current) {
        args.push(current)
        current = ''
      }
    } else {
      current += char
    }
  }

  if (current) {
    args.push(current)
  }

  return args
}
