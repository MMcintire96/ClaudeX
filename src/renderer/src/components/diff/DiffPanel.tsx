import React, { useState, useEffect, useCallback, useRef } from 'react'
import DiffView from './DiffView'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSettingsStore } from '../../stores/settingsStore'

interface FileStatus {
  path: string
  index: string
  working_dir: string
}

interface DiffPanelProps {
  projectPath: string
}

/** Write text to the active Claude terminal, handling vim mode (ESC → i) if enabled. */
async function writeToClaudeTerminal(terminalId: string, text: string, vimMode: boolean): Promise<void> {
  if (vimMode) {
    await window.api.terminal.write(terminalId, '\x1b')
    await new Promise(r => setTimeout(r, 50))
    await window.api.terminal.write(terminalId, 'i')
    await new Promise(r => setTimeout(r, 50))
  }
  await window.api.terminal.write(terminalId, text)
}

export default function DiffPanel({ projectPath }: DiffPanelProps) {
  const [diff, setDiff] = useState('')
  const [files, setFiles] = useState<FileStatus[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [filesCollapsed, setFilesCollapsed] = useState(true)
  const selectedFileRef = useRef<string | null>(null)
  selectedFileRef.current = selectedFile
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeClaudeId = useTerminalStore(s => s.activeClaudeId)
  const terminals = useTerminalStore(s => s.terminals)
  const vimMode = useSettingsStore(s => s.vimMode)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; filePath: string } | null>(null)

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [contextMenu])

  const handleAddToClaude = useCallback((filePath: string) => {
    const terminalId = activeClaudeId[projectPath]
    if (!terminalId) return
    const cleanPath = filePath.replace(/^[ab]\//, '')
    writeToClaudeTerminal(terminalId, '@' + cleanPath + ' ', vimMode)
    setContextMenu(null)
  }, [projectPath, activeClaudeId, vimMode])

  /** Quiet refresh: no loading spinner, only updates state if data changed. */
  const quietRefresh = useCallback(async () => {
    if (!projectPath) return
    try {
      const statusResult = await window.api.project.gitStatus(projectPath)
      if (statusResult.success && statusResult.status) {
        const newFiles = (statusResult.status as { files: FileStatus[] }).files || []
        setFiles(prev => {
          const prevJson = JSON.stringify(prev)
          const newJson = JSON.stringify(newFiles)
          return prevJson === newJson ? prev : newFiles
        })
      }
    } catch { /* ignore */ }
    try {
      const file = selectedFileRef.current
      const diffResult = file
        ? await window.api.project.diffFile(projectPath, file)
        : await window.api.project.diff(projectPath)
      if (diffResult.success) {
        const newDiff = diffResult.diff || ''
        setDiff(prev => prev === newDiff ? prev : newDiff)
      }
    } catch { /* ignore */ }
  }, [projectPath])

  const loadStatus = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const result = await window.api.project.gitStatus(projectPath)
      if (result.success && result.status) {
        const status = result.status as { files: FileStatus[] }
        setFiles(status.files || [])
      }
    } catch {
      // ignore
    }
    setLoading(false)
  }, [projectPath])

  const loadDiff = useCallback(async (filePath?: string) => {
    if (!projectPath) return
    setLoading(true)
    try {
      let result
      if (filePath) {
        result = await window.api.project.diffFile(projectPath, filePath)
      } else {
        result = await window.api.project.diff(projectPath)
      }
      if (result.success) {
        setDiff(result.diff || '')
      }
    } catch {
      // ignore
    }
    setLoading(false)
  }, [projectPath])

  useEffect(() => {
    loadStatus()
    loadDiff()
    setSelectedFile(null)
  }, [loadStatus, loadDiff, projectPath])

  // Auto-refresh: debounce on Claude terminal output, refresh on agent close
  useEffect(() => {
    const claudeIds = new Set(
      terminals.filter(t => t.type === 'claude' && t.projectPath === projectPath).map(t => t.id)
    )

    const unsubData = window.api.terminal.onData((id: string) => {
      if (!claudeIds.has(id)) return
      if (debounceRef.current) clearTimeout(debounceRef.current)
      debounceRef.current = setTimeout(quietRefresh, 1500)
    })

    const unsubClosed = window.api.agent.onClosed(quietRefresh)

    return () => {
      unsubData()
      unsubClosed()
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [terminals, projectPath, quietRefresh])

  const handleFileClick = useCallback((path: string) => {
    setSelectedFile(path)
    loadDiff(path)
  }, [loadDiff])

  const handleRefresh = useCallback(() => {
    loadStatus()
    if (selectedFile) {
      loadDiff(selectedFile)
    } else {
      loadDiff()
    }
  }, [loadStatus, loadDiff, selectedFile])

  return (
    <div className="diff-panel">
      <div className="diff-panel-header">
        <h3>Changes</h3>
        <button className="btn btn-sm" onClick={handleRefresh}>
          Refresh
        </button>
      </div>

      {files.length > 0 && (
        <div className="diff-file-section">
          <button
            className="diff-file-section-toggle"
            onClick={() => setFilesCollapsed(!filesCollapsed)}
          >
            <span className="diff-file-section-chevron">
              {filesCollapsed ? '\u25B8' : '\u25BE'}
            </span>
            <span className="diff-file-section-label">
              Files changed
            </span>
            <span className="diff-file-section-count">{files.length}</span>
          </button>

          {!filesCollapsed && (
            <div className="diff-file-list">
              <button
                className={`diff-file-item ${!selectedFile ? 'active' : ''}`}
                onClick={() => { setSelectedFile(null); loadDiff() }}
              >
                All changes
              </button>
              {files.map(f => (
                <button
                  key={f.path}
                  className={`diff-file-item ${selectedFile === f.path ? 'active' : ''}`}
                  onClick={() => handleFileClick(f.path)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setContextMenu({ x: e.clientX, y: e.clientY, filePath: f.path })
                  }}
                >
                  <span className="diff-file-status">
                    {f.working_dir !== ' ' ? f.working_dir : f.index}
                  </span>
                  {f.path}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="diff-content">
        {loading ? (
          <div className="diff-loading">Loading...</div>
        ) : (
          <DiffView diff={diff} onAddToClaude={handleAddToClaude} />
        )}
      </div>

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="context-menu-item"
            onClick={() => handleAddToClaude(contextMenu.filePath)}
          >
            Add to Claude
          </button>
        </div>
      )}
    </div>
  )
}
