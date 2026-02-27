import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import DiffView from './DiffView'
import CommitModal from '../git/CommitModal'
import { useSessionStore } from '../../stores/sessionStore'


interface FileStatus {
  path: string
  index: string
  working_dir: string
}

interface DiffPanelProps {
  projectPath: string
}

/** Group files by directory into a tree structure */
function buildFileTree(files: FileStatus[]): TreeNode[] {
  const root: TreeNode[] = []

  for (const f of files) {
    const parts = f.path.split('/')
    let current = root

    // Build intermediate directories
    for (let i = 0; i < parts.length - 1; i++) {
      const dirName = parts[i]
      let dirNode = current.find(n => n.type === 'dir' && n.name === dirName)
      if (!dirNode) {
        dirNode = { type: 'dir', name: dirName, path: parts.slice(0, i + 1).join('/'), children: [] }
        current.push(dirNode)
      }
      current = dirNode.children!
    }

    // Add file leaf
    current.push({ type: 'file', name: parts[parts.length - 1], path: f.path, file: f })
  }

  return root
}

interface TreeNode {
  type: 'dir' | 'file'
  name: string
  path: string
  children?: TreeNode[]
  file?: FileStatus
}

export default function DiffPanel({ projectPath }: DiffPanelProps) {
  const [diff, setDiff] = useState('')
  const [files, setFiles] = useState<FileStatus[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [selectedFileUntracked, setSelectedFileUntracked] = useState(false)
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'unstaged' | 'staged'>('unstaged')
  const [searchFilter, setSearchFilter] = useState('')
  const selectedFileRef = useRef<string | null>(null)
  selectedFileRef.current = selectedFile
  const selectedFileUntrackedRef = useRef(false)
  selectedFileUntrackedRef.current = selectedFileUntracked
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showCommitModal, setShowCommitModal] = useState(false)

  const toggleSidebar = useCallback(() => setSidebarCollapsed(prev => !prev), [])

  // If the active session runs in a worktree, show that worktree's diff
  const diffPath = useSessionStore(s => {
    const sessionId = s.activeSessionId
    if (!sessionId) return projectPath
    const session = s.sessions[sessionId]
    return session?.worktreePath || projectPath
  })

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; filePath: string } | null>(null)

  useEffect(() => {
    if (!contextMenu) return
    const close = () => setContextMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [contextMenu])

  const handleAddToClaude = useCallback((filePath: string) => {
    const cleanPath = filePath.replace(/^[ab]\//, '')
    window.dispatchEvent(new CustomEvent('claude-add-file', { detail: { filePath: cleanPath, projectPath } }))
    setContextMenu(null)
  }, [projectPath])

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

  // File tree
  const fileTree = useMemo(() => buildFileTree(filteredFiles), [filteredFiles])

  // Filter the diff content to match the file filter (when no specific file is selected)
  const displayDiff = useMemo(() => {
    if (selectedFile || !searchFilter.trim() || !diff) return diff
    const filteredPaths = new Set(filteredFiles.map(f => f.path))
    // Split unified diff into per-file sections and keep only matching ones
    const sections = diff.split(/(?=^diff --git )/m)
    return sections.filter(section => {
      const match = section.match(/^diff --git a\/(.*?) b\//)
      if (!match) return false
      return filteredPaths.has(match[1])
    }).join('')
  }, [diff, selectedFile, searchFilter, filteredFiles])

  /** Quiet refresh */
  const quietRefresh = useCallback(async () => {
    if (!diffPath) return
    try {
      const statusResult = await window.api.project.gitStatus(diffPath)
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
        ? await window.api.project.diffFile(diffPath, file, selectedFileUntrackedRef.current)
        : await window.api.project.diff(diffPath, staged)
      if (diffResult.success) {
        const newDiff = diffResult.diff || ''
        setDiff(prev => prev === newDiff ? prev : newDiff)
      }
    } catch { /* ignore */ }
  }, [diffPath, activeTab])

  const loadStatus = useCallback(async () => {
    if (!diffPath) return
    setLoading(true)
    try {
      const result = await window.api.project.gitStatus(diffPath)
      if (result.success && result.status) {
        const status = result.status as { files: FileStatus[] }
        setFiles(status.files || [])
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [diffPath])

  const loadDiff = useCallback(async (filePath?: string, untracked?: boolean) => {
    if (!diffPath) return
    setLoading(true)
    try {
      let result
      if (filePath) {
        result = await window.api.project.diffFile(diffPath, filePath, untracked)
      } else {
        const staged = activeTab === 'staged'
        result = await window.api.project.diff(diffPath, staged)
      }
      if (result.success) {
        setDiff(result.diff || '')
      }
    } catch { /* ignore */ }
    setLoading(false)
  }, [diffPath, activeTab])

  useEffect(() => {
    loadStatus()
    loadDiff()
    setSelectedFile(null)
  }, [loadStatus, loadDiff, diffPath])

  // Auto-refresh when agent session completes
  useEffect(() => {
    const unsubClosed = window.api.agent.onClosed(quietRefresh)

    return () => {
      unsubClosed()
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [projectPath, quietRefresh])

  const handleFileClick = useCallback((path: string, isUntracked?: boolean) => {
    if (selectedFile === path) {
      setSelectedFile(null)
      setSelectedFileUntracked(false)
      loadDiff()
    } else {
      setSelectedFile(path)
      setSelectedFileUntracked(!!isUntracked)
      loadDiff(path, isUntracked)
    }
  }, [loadDiff, selectedFile])

  const handleTabChange = useCallback((tab: 'unstaged' | 'staged') => {
    setActiveTab(tab)
    setSelectedFile(null)
    setSelectedFileUntracked(false)
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

  const toggleDir = useCallback((dirPath: string) => {
    setCollapsedDirs(prev => {
      const next = new Set(prev)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }, [])

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

  const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
    if (node.type === 'dir') {
      const isCollapsed = collapsedDirs.has(node.path)
      return (
        <div key={node.path} className="diff-tree-dir-group">
          <button
            className="diff-tree-dir-row"
            style={{ paddingLeft: 8 + depth * 16 }}
            onClick={() => toggleDir(node.path)}
          >
            <span className="diff-tree-chevron">{isCollapsed ? '\u25B8' : '\u25BE'}</span>
            <span className="diff-tree-dir-icon">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </span>
            <span className="diff-tree-dir-name">{node.name}</span>
          </button>
          {!isCollapsed && node.children?.map(child => renderTreeNode(child, depth + 1))}
        </div>
      )
    }

    const f = node.file!
    const badge = getStatusBadge(f)
    return (
      <button
        key={f.path}
        className={`diff-tree-file-row ${selectedFile === f.path ? 'active' : ''}`}
        style={{ paddingLeft: 8 + depth * 16 }}
        onClick={() => handleFileClick(f.path, f.index === '?')}
        onContextMenu={(e) => {
          e.preventDefault()
          setContextMenu({ x: e.clientX, y: e.clientY, filePath: f.path })
        }}
      >
        <span className="diff-tree-file-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        </span>
        <span className="diff-tree-file-name">{node.name}</span>
        <span className="diff-tree-file-badge" style={{ color: getStatusColor(badge) }}>
          {badge}
        </span>
      </button>
    )
  }

  return (
    <div className="diff-panel">
      {/* Top control bar */}
      <div className="diff-panel-topbar">
        <input
          className="diff-search-input"
          type="text"
          placeholder="Search files..."
          value={searchFilter}
          onChange={e => setSearchFilter(e.target.value)}
        />
        <button
          className="btn btn-sm btn-icon"
          onClick={async () => {
            const running = await window.api.neovim.isRunning(diffPath)
            if (!running) await window.api.neovim.create(diffPath)
            else await window.api.neovim.openFile(diffPath, '.')
          }}
          title="Open in editor"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </button>
        <button className="btn btn-sm" onClick={handleRefresh}>Refresh</button>
        <button className="btn btn-sm btn-primary" onClick={() => setShowCommitModal(true)}>Commit</button>
        <button
          className={`btn btn-sm btn-icon diff-sidebar-toggle ${!sidebarCollapsed ? 'active' : ''}`}
          onClick={toggleSidebar}
          title={sidebarCollapsed ? 'Show file tree' : 'Hide file tree'}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="16" y1="3" x2="16" y2="21"/>
          </svg>
        </button>
      </div>

      {/* Sub-header with title and tabs */}
      <div className="diff-panel-sub-header">
        <h3>Uncommitted changes</h3>
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
      </div>

      {/* Main body: diff left, file tree right */}
      <div className="diff-panel-body">
        {/* Left: diff content */}
        <div className="diff-content">
          {loading ? (
            <div className="diff-loading">Loading...</div>
          ) : (
            <DiffView diff={displayDiff} onAddToClaude={handleAddToClaude} onOpenInEditor={async (filePath) => {
              const running = await window.api.neovim.isRunning(diffPath)
              if (!running) await window.api.neovim.create(diffPath, filePath)
              else await window.api.neovim.openFile(diffPath, filePath)
            }} />
          )}
        </div>

        {/* Right: file tree sidebar */}
        {!sidebarCollapsed && (
          <div className="diff-sidebar">
            <div className="diff-sidebar-tree">
              {filteredFiles.length > 0 ? (
                fileTree.map(node => renderTreeNode(node, 0))
              ) : !loading ? (
                <div className="diff-tree-empty">
                  {searchFilter ? 'No matching files' : (activeTab === 'staged' ? 'No staged changes' : 'No unstaged changes')}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {showCommitModal && (
        <CommitModal
          projectPath={diffPath}
          onClose={() => setShowCommitModal(false)}
          onCommitted={handleRefresh}
        />
      )}

      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="context-menu-item"
            onClick={async () => {
              const running = await window.api.neovim.isRunning(diffPath)
              if (!running) await window.api.neovim.create(diffPath, contextMenu.filePath)
              else await window.api.neovim.openFile(diffPath, contextMenu.filePath)
              setContextMenu(null)
            }}
          >
            Open in editor
          </button>
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
