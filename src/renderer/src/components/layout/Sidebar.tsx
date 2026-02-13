import React, { useEffect, useCallback } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useUIStore } from '../../stores/uiStore'
import { useTerminalStore } from '../../stores/terminalStore'
import CostTracker from '../common/CostTracker'
import ProjectTree from './ProjectTree'

export default function Sidebar() {
  const {
    currentPath, isGitRepo, recentProjects,
    expandedProjects, setProject, setRecent, toggleProjectExpanded
  } = useProjectStore()
  const {
    sessions, activeSessionId, setActiveSession, getLastSessionForProject
  } = useSessionStore()
  const {
    setSidePanelView, sidePanelView, projectSidePanelMemory, toggleTheme
  } = useUIStore()
  const { terminals, panelVisible, togglePanel, addTerminal } = useTerminalStore()

  useEffect(() => {
    window.api.project.recent().then(setRecent)
  }, [setRecent])

  const handleOpenProject = useCallback(async () => {
    const result = await window.api.project.open()
    if (result.success && result.path) {
      setProject(result.path, result.isGitRepo ?? false)
      window.api.project.recent().then(setRecent)
      // Restore that project's last session
      const lastSession = getLastSessionForProject(result.path)
      setActiveSession(lastSession)
      // Restore that project's side panel (or clear)
      const lastPanel = projectSidePanelMemory[result.path]
      setSidePanelView(lastPanel ? { type: lastPanel, projectPath: result.path } : null)
    }
  }, [setProject, setRecent, getLastSessionForProject, setActiveSession, projectSidePanelMemory, setSidePanelView])

  /**
   * Switch the entire workspace to a project.
   * Restores its last session, side panel, and terminal context.
   */
  const switchToProject = useCallback(async (path: string) => {
    if (path === currentPath) return
    const result = await window.api.project.selectRecent(path)
    if (!result.success) return
    setProject(result.path, result.isGitRepo)
    // Restore session
    const lastSession = getLastSessionForProject(path)
    setActiveSession(lastSession)
    // Restore side panel
    const lastPanel = projectSidePanelMemory[path]
    setSidePanelView(lastPanel ? { type: lastPanel, projectPath: path } : null)
  }, [currentPath, setProject, getLastSessionForProject, setActiveSession, projectSidePanelMemory, setSidePanelView])

  const handleNewSession = useCallback(async (projectPath: string) => {
    if (projectPath !== currentPath) {
      await switchToProject(projectPath)
    }
    // Clear active session — InputBar will create a new one on first message
    setActiveSession(null)
  }, [currentPath, switchToProject, setActiveSession])

  const handleSelectSession = useCallback(async (sessionId: string) => {
    const session = sessions[sessionId]
    if (session && session.projectPath !== currentPath) {
      await switchToProject(session.projectPath)
    }
    setActiveSession(sessionId)
  }, [sessions, currentPath, switchToProject, setActiveSession])

  const handleOpenBrowser = useCallback(async (projectPath: string) => {
    if (projectPath !== currentPath) {
      await switchToProject(projectPath)
    }
    setSidePanelView({ type: 'browser', projectPath })
  }, [currentPath, switchToProject, setSidePanelView])

  const handleOpenDiff = useCallback(async (projectPath: string) => {
    if (projectPath !== currentPath) {
      await switchToProject(projectPath)
    }
    setSidePanelView({ type: 'diff', projectPath })
  }, [currentPath, switchToProject, setSidePanelView])

  const handleOpenTerminal = useCallback(async (projectPath: string) => {
    if (projectPath !== currentPath) {
      await switchToProject(projectPath)
    }
    // Find existing terminals for this project
    const projectTerminals = terminals.filter(t => t.projectPath === projectPath)
    if (projectTerminals.length === 0) {
      // Create a new terminal for this project
      const result = await window.api.terminal.create(projectPath)
      if (result.success) {
        addTerminal({ id: result.id, projectPath: result.projectPath, pid: result.pid })
      }
    } else {
      togglePanel()
    }
  }, [currentPath, switchToProject, terminals, addTerminal, togglePanel])

  // Get sessions for a project
  const getSessionsForProject = (projectPath: string) => {
    return Object.values(sessions)
      .filter(s => s.projectPath === projectPath)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  // Terminal count per project
  const getTerminalCount = (projectPath: string) =>
    terminals.filter(t => t.projectPath === projectPath).length

  // Active session for footer
  const activeSession = activeSessionId ? sessions[activeSessionId] : null

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
      <div className="sidebar-projects">
        <div className="sidebar-section-label">Projects</div>

        {projectList.map(proj => (
          <ProjectTree
            key={proj.path}
            projectPath={proj.path}
            projectName={proj.name}
            isExpanded={expandedProjects.includes(proj.path)}
            isCurrentProject={proj.isCurrent}
            isGitRepo={proj.isGitRepo}
            sessions={getSessionsForProject(proj.path)}
            activeSessionId={activeSessionId}
            activeSidePanelType={sidePanelView?.type ?? null}
            activeSidePanelProject={sidePanelView?.projectPath ?? null}
            terminalCount={getTerminalCount(proj.path)}
            terminalActive={panelVisible && terminals.some(t => t.projectPath === proj.path)}
            onToggleExpanded={() => toggleProjectExpanded(proj.path)}
            onSwitchToProject={() => switchToProject(proj.path)}
            onSelectSession={handleSelectSession}
            onNewSession={() => handleNewSession(proj.path)}
            onOpenBrowser={() => handleOpenBrowser(proj.path)}
            onOpenDiff={() => handleOpenDiff(proj.path)}
            onOpenTerminal={() => handleOpenTerminal(proj.path)}
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
        <div className="sidebar-agent-status">
          <span className={`status-dot ${activeSession?.isProcessing ? 'status-active' : 'status-idle'}`} />
          <span>{activeSession?.isProcessing ? 'Running' : 'Idle'}</span>
          {activeSession?.model && (
            <span style={{ marginLeft: 'auto', fontSize: '10px' }}>
              {activeSession.model.split('-').slice(0, 2).join(' ')}
            </span>
          )}
        </div>
        <CostTracker />
        <div className="sidebar-footer-row">
          <button className="btn btn-sm" onClick={handleOpenProject} style={{ flex: 1 }}>
            Open project
          </button>
          <button className="btn btn-sm" onClick={toggleTheme}>
            Theme
          </button>
        </div>
      </div>
    </aside>
  )
}
