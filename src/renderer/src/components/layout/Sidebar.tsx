import React, { useEffect, useCallback, useState } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useUIStore } from '../../stores/uiStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSettingsStore } from '../../stores/settingsStore'
import CostTracker from '../common/CostTracker'
import ProjectTree from './ProjectTree'

export default function Sidebar() {
  const [creatingThread, setCreatingThread] = useState(false)
  const {
    currentPath, isGitRepo, recentProjects,
    setProject, setRecent, removeProject,
    gitBranches, setGitBranch
  } = useProjectStore()
  const {
    setSidePanelView, projectSidePanelMemory, toggleSidebar
  } = useUIStore()
  const { loadSettings } = useSettingsStore()
  const {
    terminals, addTerminal, removeTerminal, switchToProjectTerminals,
    manualRenameTerminal,
    claudeStatuses, activeClaudeId, setActiveClaudeId
  } = useTerminalStore()

  useEffect(() => {
    window.api.project.recent().then(setRecent)
    loadSettings()
  }, [setRecent, loadSettings])

  // Fetch git branches for projects
  const fetchBranches = useCallback(() => {
    const paths = recentProjects.map(p => p.path)
    if (currentPath && !paths.includes(currentPath)) paths.unshift(currentPath)
    for (const path of paths) {
      window.api.project.gitBranch(path).then(result => {
        if (result.success && result.branch) {
          setGitBranch(path, result.branch)
        }
      })
    }
  }, [recentProjects, currentPath, setGitBranch])

  useEffect(() => {
    fetchBranches()
    const interval = setInterval(fetchBranches, 10000)
    return () => clearInterval(interval)
  }, [fetchBranches])

  // Session history state
  const [historyByProject, setHistoryByProject] = useState<Record<string, Array<{ id: string; claudeSessionId?: string; projectPath: string; name: string; createdAt: number; endedAt: number; worktreePath?: string | null; isWorktree?: boolean }>>>({})

  const fetchHistory = useCallback(() => {
    const paths = recentProjects.map(p => p.path)
    if (currentPath && !paths.includes(currentPath)) paths.unshift(currentPath)
    for (const path of paths) {
      window.api.session.history(path).then(entries => {
        setHistoryByProject(prev => ({ ...prev, [path]: entries }))
      })
    }
  }, [recentProjects, currentPath])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  const handleResumeHistory = useCallback(async (entry: { claudeSessionId?: string; projectPath: string; name: string; worktreePath?: string | null; isWorktree?: boolean }) => {
    if (!entry.claudeSessionId) return
    setCreatingThread(true)
    try {
      const cleanName = entry.name.replace(/^[^\w\s]+\s*/, '') || entry.name
      // If this was a worktree session, resume in the worktree path if it still exists
      const resumePath = entry.worktreePath || entry.projectPath
      const result = await window.api.terminal.createClaudeResume(
        resumePath,
        entry.claudeSessionId,
        cleanName
      )
      if (result.success && result.id) {
        addTerminal({
          id: result.id,
          projectPath: entry.projectPath,
          pid: result.pid!,
          name: cleanName,
          type: 'claude',
          worktreePath: entry.worktreePath || undefined
        })
        // Preserve the old name — prevent OSC title sequences from overwriting
        manualRenameTerminal(result.id, cleanName)
        setActiveClaudeId(entry.projectPath, result.id)
        // Remove from history so it doesn't show as duplicate
        setHistoryByProject(prev => ({
          ...prev,
          [entry.projectPath]: (prev[entry.projectPath] || []).filter(e => e.claudeSessionId !== entry.claudeSessionId)
        }))
        if (entry.projectPath !== currentPath) {
          await switchToProject(entry.projectPath)
        }
      }
    } finally {
      setCreatingThread(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addTerminal, manualRenameTerminal, setActiveClaudeId, currentPath])

  const getClaudeTerminalsForProject = (projectPath: string) =>
    terminals.filter(t => t.projectPath === projectPath && t.type === 'claude')

  const ensureClaudeTerminal = useCallback(async (projectPath: string) => {
    // Read fresh from store to avoid stale closure (e.g. after resume adds a terminal)
    const current = useTerminalStore.getState().terminals
    const existing = current.filter(t => t.type === 'claude' && t.projectPath === projectPath)
    if (existing.length > 0) return
    const result = await window.api.terminal.createClaude(projectPath)
    if (result.success && result.id) {
      addTerminal({
        id: result.id,
        projectPath: result.projectPath!,
        pid: result.pid!,
        name: 'Claude Code',
        type: 'claude'
      })
      setActiveClaudeId(projectPath, result.id)
    }
  }, [addTerminal, setActiveClaudeId])

  const handleNewClaudeTerminal = useCallback(async (projectPath: string) => {
    setCreatingThread(true)
    try {
      const result = await window.api.terminal.createClaude(projectPath)
      if (result.success && result.id) {
        const count = terminals.filter(t => t.type === 'claude' && t.projectPath === projectPath).length
        addTerminal({
          id: result.id,
          projectPath: result.projectPath!,
          pid: result.pid!,
          name: `Claude Code${count > 0 ? ` ${count + 1}` : ''}`,
          type: 'claude'
        })
        setActiveClaudeId(projectPath, result.id)
      }
    } finally {
      setCreatingThread(false)
    }
  }, [terminals, addTerminal, setActiveClaudeId])

  const handleSelectClaudeTerminal = useCallback(async (terminalId: string) => {
    const tab = terminals.find(t => t.id === terminalId)
    if (tab && tab.projectPath !== currentPath) {
      await switchToProject(tab.projectPath)
    }
    setActiveClaudeId(tab?.projectPath || currentPath || '', terminalId)
  }, [terminals, currentPath, setActiveClaudeId])

  const handleOpenProject = useCallback(async () => {
    const result = await window.api.project.open()
    if (result.success && result.path) {
      setProject(result.path, result.isGitRepo ?? false)
      window.api.project.recent().then(setRecent)
      const lastPanel = projectSidePanelMemory[result.path]
      setSidePanelView(lastPanel ? { type: lastPanel, projectPath: result.path } : null)
      switchToProjectTerminals(result.path)
      ensureClaudeTerminal(result.path)
    }
  }, [setProject, setRecent, projectSidePanelMemory, setSidePanelView, switchToProjectTerminals, ensureClaudeTerminal])

  const switchToProject = useCallback(async (path: string) => {
    if (path === currentPath) return
    const result = await window.api.project.selectRecent(path)
    if (!result.success) return
    setProject(result.path, result.isGitRepo)
    const lastPanel = projectSidePanelMemory[path]
    setSidePanelView(lastPanel ? { type: lastPanel, projectPath: path } : null)
    switchToProjectTerminals(path)
    ensureClaudeTerminal(path)
  }, [currentPath, setProject, projectSidePanelMemory, setSidePanelView, switchToProjectTerminals, ensureClaudeTerminal])

  const handleCloseTerminal = useCallback((id: string) => {
    window.api.terminal.close(id)
    removeTerminal(id)
  }, [removeTerminal])

  const handleRemoveProject = useCallback((projectPath: string) => {
    const projectTerminals = terminals.filter(t => t.projectPath === projectPath)
    for (const t of projectTerminals) {
      window.api.terminal.close(t.id)
      removeTerminal(t.id)
    }
    removeProject(projectPath)
    window.api.project.removeRecent(projectPath)
    setSidePanelView(null)
  }, [terminals, removeTerminal, removeProject, setSidePanelView])

  const projectList = recentProjects.map(p => ({
    path: p.path,
    name: p.name,
    isCurrent: p.path === currentPath,
    isGitRepo: p.path === currentPath ? isGitRepo : false
  }))

  if (currentPath && !recentProjects.some(p => p.path === currentPath)) {
    const name = currentPath.split('/').pop() ?? currentPath
    projectList.unshift({
      path: currentPath,
      name,
      isCurrent: true,
      isGitRepo
    })
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-drag" />
        <button className="sidebar-collapse-btn" onClick={toggleSidebar} title="Collapse sidebar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>
      </div>

      {/* New Thread button */}
      <div className="sidebar-new-thread">
        <button
          className="btn btn-primary btn-new-thread"
          onClick={() => currentPath && handleNewClaudeTerminal(currentPath)}
          disabled={!currentPath || creatingThread}
        >
          {creatingThread ? 'Starting...' : '+ New thread'}
        </button>
      </div>

      {/* Threads */}
      <div className="sidebar-projects">
        <div className="sidebar-section-label">Threads</div>

        {projectList.map(proj => (
          <ProjectTree
            key={proj.path}
            projectPath={proj.path}
            projectName={proj.name}
            isCurrentProject={proj.isCurrent}
            isGitRepo={proj.isGitRepo}
            claudeTerminals={getClaudeTerminalsForProject(proj.path)}
            claudeStatuses={claudeStatuses}
            activeClaudeId={activeClaudeId[proj.path] || null}
            onSwitchToProject={() => switchToProject(proj.path)}
            onSelectClaudeTerminal={handleSelectClaudeTerminal}
            onRenameClaudeTerminal={manualRenameTerminal}
            onCloseTerminal={handleCloseTerminal}
            onNewThread={() => handleNewClaudeTerminal(proj.path)}
            onRemoveProject={() => handleRemoveProject(proj.path)}
            historyEntries={historyByProject[proj.path] || []}
            onResumeHistory={handleResumeHistory}
          />
        ))}

        {projectList.length === 0 && (
          <div style={{ padding: '8px 10px', fontSize: '12px', color: 'var(--text-muted)' }}>
            No projects yet
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <CostTracker />
        <div className="sidebar-footer-row">
          <button className="btn btn-sm" onClick={handleOpenProject} style={{ flex: 1 }}>
            Open project
          </button>
        </div>
      </div>
    </aside>
  )
}
