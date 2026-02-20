import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
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

/** Write text to the active Claude terminal, handling vim mode (ESC -> i) if enabled. */
async function writeToClaudeTerminal(terminalId: string, text: string, vimMode: boolean): Promise<void> {
  if (vimMode) {
    await window.api.terminal.write(terminalId, '\x1b')
    await new Promise(r => setTimeout(r, 50))
    await window.api.terminal.write(terminalId, 'i')
    await new Promise(r => setTimeout(r, 50))
  }
  await window.api.terminal.write(terminalId, text)
}

/** Group files by directory */
function groupByDirectory(files: FileStatus[]): Map<string, FileStatus[]> {
  const groups = new Map<string, FileStatus[]>()
  for (const f of files) {
    const lastSlash = f.path.lastIndexOf('/')
    const dir = lastSlash >= 0 ? f.path.substring(0, lastSlash) : '.'
    if (!groups.has(dir)) groups.set(dir, [])
    groups.get(dir)!.push(f)
  }
  return groups
}

export default function DiffPanel({ projectPath }: DiffPanelProps) {
  const [diff, setDiff] = useState('')
  const [files, setFiles] = useState<FileStatus[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'unstaged' | 'staged'>('unstaged')
  const [searchFilter, setSearchFilter] = useState('')
  const selectedFileRef = useRef<string | null>(null)
  selectedFileRef.current = selectedFile
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const activeClaudeId = useTerminalStore(s => s.activeClaudeId)
  const terminals = useTerminalStore(s => s.terminals)
  const vimMode = useSettingsStore(s => s.vimMode)

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; filePath: string } | null>(null)

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

  // Filter files by tab (staged vs unstaged)
  const filteredByTab = useMemo(() => {
    if (activeTab === 'staged') {
      return files.filter(f => f.index !== ' ' && f.index !== '?')
    }
    return files.filter(f => f.working_dir !== ' ' || f.index === '?')
  }, [files, activeTab])

  // Filter by search
  const filteredFiles = useMemo(() => {
    if (!searchFilter.trim()) return filteredByTab
    const q = searchFilter.toLowerCase()
    return filteredByTab.filter(f => f.path.toLowerCase().includes(q))
  }, [filteredByTab, searchFilter])

  // Counts for tab badges
  const unstagedCount = useMemo(() =>
    files.filter(f => f.working_dir !== ' ' || f.index === '?').length
  , [files])
  const stagedCount = useMemo(() =>
    files.filter(f => f.index !== ' ' && f.index !== '?').length
  , [files])

  // Grouped files
  const groupedFiles = useMemo(() => groupByDirectory(filteredFiles), [filteredFiles])

  /** Quiet refresh */
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
      const staged = activeTab === 'staged'
      const diffResult = file
        ? await window.api.project.diffFile(projectPath, file)
        : await window.api.project.diff(projectPath, staged)
      if (diffResult.success) {
        const newDiff = diffResult.diff || ''
        setDiff(prev => prev === newDiff ? prev : newDiff)
      }
    } catch { /* ignore */ }
  }, [projectPath, activeTab])

  const loadStatus = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const result = await window.api.project.gitStatus(projectPath)
      if (result.success && result.status) {
        const status = result.status as { files: FileStatus[] }
        setFiles(status.files || [])
      }
    } catch { /* ignore */ }
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
        const staged = activeTab === 'staged'
        result = await window.api.project.diff(projectPath, staged)
      }
      if (result.success) {
        setDiff(result.diff || '')
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [projectPath, activeTab])

  useEffect(() => {
    loadStatus()
    loadDiff()
    setSelectedFile(null)
  }, [loadStatus, loadDiff, projectPath])

  // Auto-refresh on Claude terminal output
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

  const handleTabChange = useCallback((tab: 'unstaged' | 'staged') => {
    setActiveTab(tab)
    setSelectedFile(null)
    setSearchFilter('')
  }, [])

  const handleRefresh = useCallback(() => {
    loadStatus()
    if (selectedFile) {
      loadDiff(selectedFile)
    } else {
      loadDiff()
    }
  }, [loadStatus, loadDiff, selectedFile])

  const getStatusBadge = (f: FileStatus) => {
    if (activeTab === 'staged') {
      if (f.index === 'A') return 'A'
      if (f.index === 'D') return 'D'
      if (f.index === 'R') return 'R'
      return 'M'
    }
    if (f.index === '?') return 'U'
    if (f.working_dir === 'D') return 'D'
    return 'M'
  }

  const getStatusColor = (badge: string) => {
    switch (badge) {
      case 'A': case 'U': return 'var(--diff-add-text, #50fa7b)'
      case 'D': return 'var(--diff-del-text, #ff5555)'
      case 'R': return 'var(--warning, #f0a030)'
      default: return 'var(--warning, #f0a030)'
    }
  }

  return (
    <div className="diff-panel">
      <div className="diff-panel-header">
        <h3>Uncommitted changes</h3>
        <button className="btn btn-sm" onClick={handleRefresh}>
          Refresh
        </button>
      </div>

      {/* Tab row */}
      <div className="diff-tab-row">
        <button
          className={`diff-tab ${activeTab === 'unstaged' ? 'active' : ''}`}
          onClick={() => handleTabChange('unstaged')}
        >
          Unstaged
          {unstagedCount > 0 && <span className="diff-tab-count">{unstagedCount}</span>}
        </button>
        <button
          className={`diff-tab ${activeTab === 'staged' ? 'active' : ''}`}
          onClick={() => handleTabChange('staged')}
        >
          Staged
          {stagedCount > 0 && <span className="diff-tab-count">{stagedCount}</span>}
        </button>
      </div>

      {/* Search input */}
      <div className="diff-search-wrapper">
        <input
          className="diff-search-input"
          type="text"
          placeholder="Filter files..."
          value={searchFilter}
          onChange={e => setSearchFilter(e.target.value)}
        />
      </div>

      {/* File tree */}
      {filteredFiles.length > 0 && (
        <div className="diff-file-tree">
          {selectedFile && (
            <button
              className="diff-file-tree-item diff-file-tree-back"
              onClick={() => { setSelectedFile(null); loadDiff() }}
            >
              All changes
            </button>
          )}
          {Array.from(groupedFiles.entries()).map(([dir, dirFiles]) => (
            <div key={dir} className="diff-file-tree-group">
              {groupedFiles.size > 1 && (
                <div className="diff-file-tree-dir">
                  <span className="diff-file-tree-dir-icon">{'\uD83D\uDCC1'}</span>
                  {dir}
                </div>
              )}
              {dirFiles.map(f => {
                const badge = getStatusBadge(f)
                const fileName = f.path.includes('/') ? f.path.split('/').pop()! : f.path
                return (
                  <button
                    key={f.path}
                    className={`diff-file-tree-item ${selectedFile === f.path ? 'active' : ''}`}
                    onClick={() => handleFileClick(f.path)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setContextMenu({ x: e.clientX, y: e.clientY, filePath: f.path })
                    }}
                  >
                    <span className="diff-file-tree-badge" style={{ color: getStatusColor(badge) }}>
                      {badge}
                    </span>
                    <span className="diff-file-tree-name">
                      {groupedFiles.size > 1 ? fileName : f.path}
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {filteredFiles.length === 0 && !loading && (
        <div className="diff-file-tree-empty">
          {searchFilter ? 'No matching files' : (activeTab === 'staged' ? 'No staged changes' : 'No unstaged changes')}
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
