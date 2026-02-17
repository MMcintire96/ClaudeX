import React, { useEffect, useCallback, useState, useRef } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useUIStore } from '../../stores/uiStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSettingsStore } from '../../stores/settingsStore'
import CostTracker from '../common/CostTracker'
import ProjectTree from './ProjectTree'
import SettingsPanel from '../settings/SettingsPanel'
import StartConfigModal from './StartConfigModal'

export default function Sidebar() {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [startConfigPath, setStartConfigPath] = useState<string | null>(null)
  const [startConfigFlags, setStartConfigFlags] = useState<Record<string, boolean>>({})
  const {
    currentPath, isGitRepo, recentProjects,
    expandedProjects, setProject, setRecent, toggleProjectExpanded, removeProject,
    reorderProjects, gitBranches, setGitBranch
  } = useProjectStore()
  const {
    setSidePanelView, projectSidePanelMemory
  } = useUIStore()
  const { loadSettings } = useSettingsStore()
  const {
    terminals, activeTerminalId, panelVisible, togglePanel,
    setActiveTerminal, addTerminal, removeTerminal, switchToProjectTerminals, renameTerminal,
    manualRenameTerminal,
    claudeStatuses, activeClaudeId, setActiveClaudeId, subAgents
  } = useTerminalStore()

  useEffect(() => {
    window.api.project.recent().then(setRecent)
    loadSettings()
  }, [setRecent, loadSettings])

  // Check start config existence for projects
  useEffect(() => {
    const paths = recentProjects.map(p => p.path)
    if (currentPath && !paths.includes(currentPath)) paths.unshift(currentPath)
    for (const path of paths) {
      window.api.project.hasStartConfig(path).then(has => {
        setStartConfigFlags(prev => {
          if (prev[path] === has) return prev
          return { ...prev, [path]: has }
        })
      })
    }
  }, [recentProjects, currentPath])

  const handleRunStart = useCallback(async (projectPath: string) => {
    const result = await window.api.project.runStart(projectPath)
    if (result.success && result.terminals) {
      for (const t of result.terminals) {
        addTerminal({ id: t.id, projectPath: t.projectPath, pid: t.pid, name: t.name })
      }
    } else if (result.success && result.terminalIds) {
      // Fallback for backwards compatibility
      for (const tid of result.terminalIds) {
        addTerminal({ id: tid, projectPath, pid: 0 })
      }
    }
    // Navigate browser to URL if configured
    if (result.success && result.browserUrl) {
      const url = result.browserUrl
      const currentPanel = useUIStore.getState().sidePanelView
      const browserAlreadyOpen = currentPanel?.type === 'browser' && currentPanel?.projectPath === projectPath
      if (browserAlreadyOpen) {
        // Already open — just navigate directly
        window.api.browser.navigate(url)
      } else {
        // Store the pending URL, then open the browser panel
        useUIStore.getState().setPendingBrowserUrl(url)
        setSidePanelView({ type: 'browser', projectPath })
      }
    }
  }, [addTerminal, setSidePanelView])

  // Fetch git branches for expanded projects and poll every 10s
  const fetchBranches = useCallback(() => {
    const paths = expandedProjects.length > 0 ? expandedProjects : (currentPath ? [currentPath] : [])
    for (const path of paths) {
      window.api.project.gitBranch(path).then(result => {
        if (result.success && result.branch) {
          setGitBranch(path, result.branch)
        }
      })
    }
  }, [expandedProjects, currentPath, setGitBranch])

  useEffect(() => {
    fetchBranches()
    const interval = setInterval(fetchBranches, 10000)
    return () => clearInterval(interval)
  }, [fetchBranches])

  // Session history state
  const [historyByProject, setHistoryByProject] = useState<Record<string, Array<{ id: string; claudeSessionId?: string; projectPath: string; name: string; createdAt: number; endedAt: number }>>>({})

  // Fetch history for expanded projects
  const fetchHistory = useCallback(() => {
    const paths = expandedProjects.length > 0 ? expandedProjects : (currentPath ? [currentPath] : [])
    for (const path of paths) {
      window.api.session.history(path).then(entries => {
        setHistoryByProject(prev => ({ ...prev, [path]: entries }))
      })
    }
  }, [expandedProjects, currentPath])

  useEffect(() => {
    fetchHistory()
  }, [fetchHistory])

  const handleResumeHistory = useCallback(async (entry: { claudeSessionId?: string; projectPath: string; name: string }) => {
    if (!entry.claudeSessionId) return
    const result = await window.api.terminal.createClaudeResume(
      entry.projectPath,
      entry.claudeSessionId,
      entry.name
    )
    if (result.success && result.id) {
      addTerminal({
        id: result.id,
        projectPath: result.projectPath!,
        pid: result.pid!,
        name: entry.name,
        type: 'claude'
      })
      setActiveClaudeId(entry.projectPath, result.id)
      if (entry.projectPath !== currentPath) {
        await switchToProject(entry.projectPath)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addTerminal, setActiveClaudeId, currentPath])

  const handleClearHistory = useCallback((projectPath: string) => {
    window.api.session.clearHistory(projectPath).then(() => {
      setHistoryByProject(prev => ({ ...prev, [projectPath]: [] }))
    })
  }, [])

  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const dragSourcePath = useRef<string | null>(null)

  const handleProjectDragStart = useCallback((e: React.DragEvent, path: string) => {
    dragSourcePath.current = path
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', path)
  }, [])

  const handleProjectDragOver = useCallback((e: React.DragEvent, path: string) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragSourcePath.current && dragSourcePath.current !== path) {
      setDragOverPath(path)
    }
  }, [])

  const handleProjectDrop = useCallback((e: React.DragEvent, targetPath: string) => {
    e.preventDefault()
    setDragOverPath(null)
    const sourcePath = dragSourcePath.current
    dragSourcePath.current = null
    if (!sourcePath || sourcePath === targetPath) return

    const paths = recentProjects.map(p => p.path)
    // Include currentPath if not in recent list
    if (currentPath && !paths.includes(currentPath)) {
      paths.unshift(currentPath)
    }
    const sourceIdx = paths.indexOf(sourcePath)
    const targetIdx = paths.indexOf(targetPath)
    if (sourceIdx < 0 || targetIdx < 0) return

    paths.splice(sourceIdx, 1)
    paths.splice(targetIdx, 0, sourcePath)

    reorderProjects(paths)
    window.api.project.reorderRecent(paths)
  }, [recentProjects, currentPath, reorderProjects])

  const getClaudeTerminalsForProject = (projectPath: string) =>
    terminals.filter(t => t.projectPath === projectPath && t.type === 'claude')

  /** Ensure a Claude Code terminal exists for the given project path */
  const ensureClaudeTerminal = useCallback(async (projectPath: string) => {
    const existing = terminals.filter(t => t.type === 'claude' && t.projectPath === projectPath)
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
  }, [terminals, addTerminal, setActiveClaudeId])

  const handleNewClaudeTerminal = useCallback(async (projectPath: string) => {
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
      // Restore that project's side panel (or clear)
      const lastPanel = projectSidePanelMemory[result.path]
      setSidePanelView(lastPanel ? { type: lastPanel, projectPath: result.path } : null)
      // Restore terminal context
      switchToProjectTerminals(result.path)
      // Auto-launch Claude Code terminal
      ensureClaudeTerminal(result.path)
    }
  }, [setProject, setRecent, projectSidePanelMemory, setSidePanelView, switchToProjectTerminals, ensureClaudeTerminal])

  /**
   * Switch the entire workspace to a project.
   * Restores its side panel and terminal context, and ensures Claude terminal exists.
   */
  const switchToProject = useCallback(async (path: string) => {
    if (path === currentPath) return
    const result = await window.api.project.selectRecent(path)
    if (!result.success) return
    setProject(result.path, result.isGitRepo)
    // Restore side panel
    const lastPanel = projectSidePanelMemory[path]
    setSidePanelView(lastPanel ? { type: lastPanel, projectPath: path } : null)
    // Restore terminal context
    switchToProjectTerminals(path)
    // Auto-launch Claude Code terminal
    ensureClaudeTerminal(path)
  }, [currentPath, setProject, projectSidePanelMemory, setSidePanelView, switchToProjectTerminals, ensureClaudeTerminal])

  const handleSelectTerminal = useCallback(async (terminalId: string) => {
    // Find which project this terminal belongs to
    const tab = terminals.find(t => t.id === terminalId)
    if (tab && tab.projectPath !== currentPath) {
      await switchToProject(tab.projectPath)
    }
    setActiveTerminal(terminalId)
    if (!panelVisible) {
      togglePanel()
    }
  }, [terminals, currentPath, switchToProject, setActiveTerminal, panelVisible, togglePanel])

  const handleCloseTerminal = useCallback((id: string) => {
    window.api.terminal.close(id)
    removeTerminal(id)
  }, [removeTerminal])

  const handleRemoveProject = useCallback((projectPath: string) => {
    // Close all terminals belonging to this project
    const projectTerminals = terminals.filter(t => t.projectPath === projectPath)
    for (const t of projectTerminals) {
      window.api.terminal.close(t.id)
      removeTerminal(t.id)
    }
    // Remove from store and persist
    removeProject(projectPath)
    window.api.project.removeRecent(projectPath)
    // Clear side panel if it belongs to this project
    setSidePanelView(null)
  }, [terminals, removeTerminal, removeProject, setSidePanelView])

  const handleNewTerminal = useCallback(async (projectPath: string) => {
    if (projectPath !== currentPath) {
      await switchToProject(projectPath)
    }
    const result = await window.api.terminal.create(projectPath)
    if (result.success) {
      addTerminal({ id: result.id, projectPath: result.projectPath, pid: result.pid })
    }
  }, [currentPath, switchToProject, addTerminal])

  // Get shell terminals for a project (exclude claude terminals)
  const getTerminalsForProject = (projectPath: string) =>
    terminals.filter(t => t.projectPath === projectPath && t.type !== 'claude')

  // Render projects in stable recentProjects order — never re-arrange
  // Current project is just highlighted, not hoisted
  const projectList = recentProjects.map(p => ({
    path: p.path,
    name: p.name,
    isCurrent: p.path === currentPath,
    isGitRepo: p.path === currentPath ? isGitRepo : false
  }))

  // If current project isn't in recent list yet (freshly opened), prepend it
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
      {/* Drag region for window controls */}
      <div className="sidebar-drag-region" />

      {/* Projects */}
      <div className="sidebar-projects" onDragEnd={() => setDragOverPath(null)}>
        <div className="sidebar-section-label">Projects</div>

        {projectList.map(proj => (
          <ProjectTree
            key={proj.path}
            projectPath={proj.path}
            projectName={proj.name}
            isExpanded={expandedProjects.includes(proj.path)}
            isCurrentProject={proj.isCurrent}
            isGitRepo={proj.isGitRepo}
            gitBranch={gitBranches[proj.path] || null}
            terminalTabs={getTerminalsForProject(proj.path)}
            activeTerminalId={activeTerminalId}
            terminalPanelVisible={panelVisible}
            claudeTerminals={getClaudeTerminalsForProject(proj.path)}
            claudeStatuses={claudeStatuses}
            subAgents={subAgents}
            activeClaudeId={activeClaudeId[proj.path] || null}
            onToggleExpanded={() => toggleProjectExpanded(proj.path)}
            onSwitchToProject={() => switchToProject(proj.path)}
            onSelectTerminal={handleSelectTerminal}
            onNewTerminal={() => handleNewTerminal(proj.path)}
            onRenameTerminal={renameTerminal}
            onSelectClaudeTerminal={handleSelectClaudeTerminal}
            onNewClaudeTerminal={() => handleNewClaudeTerminal(proj.path)}
            onRenameClaudeTerminal={manualRenameTerminal}
            onCloseTerminal={handleCloseTerminal}
            onRemoveProject={() => handleRemoveProject(proj.path)}
            onDragStart={(e) => handleProjectDragStart(e, proj.path)}
            onDragOver={(e) => handleProjectDragOver(e, proj.path)}
            onDrop={(e) => handleProjectDrop(e, proj.path)}
            isDragOver={dragOverPath === proj.path}
            historyEntries={historyByProject[proj.path] || []}
            onResumeHistory={handleResumeHistory}
            onClearHistory={() => handleClearHistory(proj.path)}
            hasStartConfig={startConfigFlags[proj.path] || false}
            onRunStart={() => handleRunStart(proj.path)}
            onEditStartConfig={() => setStartConfigPath(proj.path)}
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
        {settingsOpen && <SettingsPanel />}
        <div className="sidebar-footer-row">
          <button className="btn btn-sm" onClick={handleOpenProject} style={{ flex: 1 }}>
            Open project
          </button>
          <button className="btn btn-sm" onClick={() => setSettingsOpen(o => !o)}>
            Settings
          </button>
        </div>
      </div>
      {startConfigPath && (
        <StartConfigModal
          projectPath={startConfigPath}
          onClose={() => setStartConfigPath(null)}
          onSaved={() => {
            setStartConfigFlags(prev => ({ ...prev, [startConfigPath]: true }))
          }}
        />
      )}
    </aside>
  )
}
