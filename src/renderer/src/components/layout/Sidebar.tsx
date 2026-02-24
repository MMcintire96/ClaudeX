import React, { useEffect, useCallback, useState, useRef } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useUIStore } from '../../stores/uiStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import ProjectTree from './ProjectTree'

export default function Sidebar() {
  const [creatingThread, setCreatingThread] = useState(false)
  const {
    currentPath, isGitRepo, recentProjects,
    setProject, setRecent, removeProject, reorderProjects,
    gitBranches, setGitBranch
  } = useProjectStore()
  const {
    setSidePanelView, projectSidePanelMemory
  } = useUIStore()
  const { loadSettings } = useSettingsStore()
  const {
    terminals, removeTerminal, switchToProjectTerminals
  } = useTerminalStore()

  const activeSessionId = useSessionStore(s => s.activeSessionId)
  const sessions = useSessionStore(s => s.sessions)
  const createSession = useSessionStore(s => s.createSession)
  const setActiveSession = useSessionStore(s => s.setActiveSession)
  const removeSession = useSessionStore(s => s.removeSession)

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
      const store = useSessionStore.getState()

      // Create a restored session so the lazy reconnect works on first message
      store.restoreSession({
        id: entry.claudeSessionId,
        projectPath: entry.projectPath,
        name: cleanName,
        createdAt: Date.now(),
        worktreePath: entry.worktreePath,
        isWorktree: entry.isWorktree
      })

      setHistoryByProject(prev => ({
        ...prev,
        [entry.projectPath]: (prev[entry.projectPath] || []).filter(e => e.claudeSessionId !== entry.claudeSessionId)
      }))
      if (entry.projectPath !== currentPath) {
        await switchToProject(entry.projectPath)
      }
    } finally {
      setCreatingThread(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath])

  const getSessionsForProject = (projectPath: string) => {
    return Object.values(sessions)
      .filter(s => s.projectPath === projectPath)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  const ensureSession = useCallback((projectPath: string) => {
    const existing = Object.values(useSessionStore.getState().sessions)
      .filter(s => s.projectPath === projectPath)
    if (existing.length > 0) return
    // Create an empty SDK session for the project
    const sessionId = `sdk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    createSession(projectPath, sessionId)
  }, [createSession])

  const handleNewThread = useCallback(async (projectPath: string) => {
    setCreatingThread(true)
    try {
      const count = Object.values(useSessionStore.getState().sessions)
        .filter(s => s.projectPath === projectPath).length
      const sessionId = `sdk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      createSession(projectPath, sessionId)
      useSessionStore.getState().renameSession(sessionId, `Claude Code${count > 0 ? ` ${count + 1}` : ''}`)
    } finally {
      setCreatingThread(false)
    }
  }, [createSession])

  const handleSelectSession = useCallback(async (sessionId: string) => {
    const session = useSessionStore.getState().sessions[sessionId]
    if (session && session.projectPath !== currentPath) {
      await switchToProject(session.projectPath)
    }
    setActiveSession(sessionId)
  }, [currentPath, setActiveSession])

  const handleOpenProject = useCallback(async () => {
    const result = await window.api.project.open()
    if (result.success && result.path) {
      setProject(result.path, result.isGitRepo ?? false)
      window.api.project.recent().then(setRecent)
      const lastPanel = projectSidePanelMemory[result.path]
      setSidePanelView(lastPanel ? { type: lastPanel, projectPath: result.path } : null)
      switchToProjectTerminals(result.path)
      ensureSession(result.path)
    }
  }, [setProject, setRecent, projectSidePanelMemory, setSidePanelView, switchToProjectTerminals, ensureSession])

  const switchToProject = useCallback(async (path: string) => {
    if (path === currentPath) return
    const result = await window.api.project.selectRecent(path)
    if (!result.success) return
    setProject(result.path, result.isGitRepo)
    const lastPanel = projectSidePanelMemory[path]
    setSidePanelView(lastPanel ? { type: lastPanel, projectPath: path } : null)
    switchToProjectTerminals(path)
    // Set active session to last known for this project
    const lastSession = useSessionStore.getState().getLastSessionForProject(path)
    if (lastSession) {
      setActiveSession(lastSession)
    } else {
      ensureSession(path)
    }
  }, [currentPath, setProject, projectSidePanelMemory, setSidePanelView, switchToProjectTerminals, ensureSession, setActiveSession])

  const handleCloseSession = useCallback((sessionId: string) => {
    const session = useSessionStore.getState().sessions[sessionId]
    if (session && session.messages.length > 0) {
      window.api.session.addHistory({
        id: sessionId,
        claudeSessionId: sessionId,
        projectPath: session.projectPath,
        name: session.name,
        createdAt: session.createdAt,
        endedAt: Date.now(),
        worktreePath: session.worktreePath,
        isWorktree: session.isWorktree
      }).catch(() => {})
    }
    window.api.agent.stop(sessionId).catch(() => {})
    removeSession(sessionId)
    fetchHistory()
  }, [removeSession, fetchHistory])

  const handleClearOldSessions = useCallback(async (projectPath: string) => {
    await window.api.session.clearHistory(projectPath)
    setHistoryByProject(prev => ({ ...prev, [projectPath]: [] }))
  }, [])

  const handleForkSession = useCallback(async (sessionId: string) => {
    const session = useSessionStore.getState().sessions[sessionId]
    console.log('[handleForkSession] sessionId:', sessionId, 'session:', session ? { messages: session.messages.length, projectPath: session.projectPath, worktreePath: session.worktreePath } : null)
    if (!session || session.messages.length === 0) return

    // Stop the agent if running
    await window.api.agent.stop(sessionId).catch(() => {})

    const sdkSessionId = session.sessionId
    const effectivePath = session.worktreePath || session.projectPath
    console.log('[handleForkSession] calling fork:', { sdkSessionId, effectivePath })

    const result = await window.api.agent.fork(sessionId, effectivePath, sdkSessionId)
    console.log('[handleForkSession] result:', result)
    if (!result.success || !result.forkA || !result.forkB) return

    const parentName = session.name || 'Session'
    const store = useSessionStore.getState()

    store.restoreSession({
      id: result.forkA.sessionId,
      projectPath: session.projectPath,
      name: `${parentName} (Fork A)`,
      messages: [...session.messages],
      model: session.model,
      totalCostUsd: session.totalCostUsd,
      numTurns: session.numTurns,
      selectedModel: session.selectedModel,
      createdAt: Date.now(),
      worktreePath: result.forkA.worktreePath,
      isWorktree: true,
      worktreeSessionId: result.forkA.worktreeSessionId,
      forkedFrom: sessionId,
      forkLabel: 'A'
    })

    store.restoreSession({
      id: result.forkB.sessionId,
      projectPath: session.projectPath,
      name: `${parentName} (Fork B)`,
      messages: [...session.messages],
      model: session.model,
      totalCostUsd: session.totalCostUsd,
      numTurns: session.numTurns,
      selectedModel: session.selectedModel,
      createdAt: Date.now(),
      worktreePath: result.forkB.worktreePath,
      isWorktree: true,
      worktreeSessionId: result.forkB.worktreeSessionId,
      forkedFrom: sessionId,
      forkLabel: 'B'
    })

    store.markAsForked(sessionId, [result.forkA.sessionId, result.forkB.sessionId])
    store.setActiveSession(result.forkA.sessionId)
  }, [])

  const handleRemoveProject = useCallback((projectPath: string) => {
    // Close shell terminals
    const projectTerminals = terminals.filter(t => t.projectPath === projectPath)
    for (const t of projectTerminals) {
      window.api.terminal.close(t.id)
      removeTerminal(t.id)
    }
    // Close SDK sessions
    const projectSessions = Object.values(sessions).filter(s => s.projectPath === projectPath)
    for (const s of projectSessions) {
      window.api.agent.stop(s.sessionId).catch(() => {})
      removeSession(s.sessionId)
    }
    removeProject(projectPath)
    window.api.project.removeRecent(projectPath)
    setSidePanelView(null)
  }, [terminals, sessions, removeTerminal, removeSession, removeProject, setSidePanelView])

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

  // --- Drag-to-reorder state ---
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const dragNodeRef = useRef<HTMLDivElement | null>(null)

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDragIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(index))
    if (dragNodeRef.current) {
      e.dataTransfer.setDragImage(dragNodeRef.current, 0, 0)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverIndex(index)
  }, [])

  const handleDragEnd = useCallback(() => {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      const reordered = [...projectList]
      const [moved] = reordered.splice(dragIndex, 1)
      reordered.splice(dragOverIndex, 0, moved)
      const newPaths = reordered.map(p => p.path)
      reorderProjects(newPaths)
      window.api.project.reorderRecent(newPaths)
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }, [dragIndex, dragOverIndex, projectList, reorderProjects])

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null)
  }, [])

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-header-drag" />
      </div>

      {/* New Thread button */}
      <div className="sidebar-new-thread">
        <button
          className="btn btn-primary btn-new-thread"
          onClick={() => currentPath && handleNewThread(currentPath)}
          disabled={!currentPath || creatingThread}
        >
          {creatingThread ? 'Starting...' : '+ New thread'}
        </button>
      </div>

      {/* Threads */}
      <div className="sidebar-projects">
        <div className="sidebar-section-label">Threads</div>

        {projectList.map((proj, index) => (
          <div
            key={proj.path}
            className={`sidebar-project-drag-wrapper${dragOverIndex === index && dragIndex !== index ? ' drag-over' : ''}${dragIndex === index ? ' dragging' : ''}`}
            draggable
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            onDragLeave={handleDragLeave}
            ref={dragIndex === index ? dragNodeRef : undefined}
          >
            <ProjectTree
              projectPath={proj.path}
              projectName={proj.name}
              isCurrentProject={proj.isCurrent}
              isGitRepo={proj.isGitRepo}
              sdkSessions={getSessionsForProject(proj.path)}
              activeSessionId={activeSessionId}
              onSwitchToProject={() => switchToProject(proj.path)}
              onSelectSession={handleSelectSession}
              onRenameSession={(id, name) => useSessionStore.getState().renameSession(id, name)}
              onCloseSession={handleCloseSession}
              onNewThread={() => handleNewThread(proj.path)}
              onRemoveProject={() => handleRemoveProject(proj.path)}
              onClearOldSessions={() => handleClearOldSessions(proj.path)}
              onForkSession={handleForkSession}
              historyEntries={historyByProject[proj.path] || []}
              onResumeHistory={handleResumeHistory}
            />
          </div>
        ))}

        {projectList.length === 0 && (
          <div style={{ padding: '8px 10px', fontSize: '12px', color: 'var(--text-muted)' }}>
            No projects yet
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-footer-row">
          <button className="btn" onClick={handleOpenProject} style={{ flex: 1 }}>
            Open project
          </button>
        </div>
      </div>
    </aside>
  )
}
