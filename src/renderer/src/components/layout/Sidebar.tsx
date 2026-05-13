import React, { useEffect, useCallback, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useProjectStore, ProjectGroup } from '../../stores/projectStore'
import { useUIStore } from '../../stores/uiStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useSessionStore, sessionNeedsInput } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useEditorStore } from '../../stores/editorStore'
import { SCRATCH_PROJECT_PATH } from '../../constants/scratch'
import ProjectTree from './ProjectTree'
import { useSessionPreview } from '../../hooks/useSessionPreview'
import SessionPreviewCard from './SessionPreviewCard'

export default function Sidebar() {
  const [creatingThread, setCreatingThread] = useState(false)
  const [sectionsCollapsed, setSectionsCollapsed] = useState<Record<string, boolean>>({})
  const [quickChatContextMenu, setQuickChatContextMenu] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!quickChatContextMenu) return
    const dismiss = () => setQuickChatContextMenu(null)
    window.addEventListener('click', dismiss)
    window.addEventListener('contextmenu', dismiss)
    return () => {
      window.removeEventListener('click', dismiss)
      window.removeEventListener('contextmenu', dismiss)
    }
  }, [quickChatContextMenu])
  const toggleSection = useCallback((section: string) => {
    setSectionsCollapsed(prev => ({ ...prev, [section]: !prev[section] }))
  }, [])
  const {
    currentPath, isGitRepo, recentProjects,
    setProject, setRecent, removeProject, reorderProjects,
    gitBranches, setGitBranch,
    expandedProjects, toggleProjectExpanded,
    groups, groupOrder, collapsedGroups,
    setGroups, toggleGroupCollapsed,
    addGroupLocally, updateGroupLocally, removeGroupLocally,
    moveProjectToGroupLocally, reorderGroupOrder, reorderWithinGroupLocally
  } = useProjectStore()
  const {
    setSidePanelView, projectSidePanelMemory
  } = useUIStore()
  const splitView = useUIStore(s => s.splitView)
  const splitSessionId = useUIStore(s => s.splitSessionId)
  const projectPairMemory = useUIStore(s => s.projectPairMemory)
  const { loadSettings } = useSettingsStore()
  const {
    terminals, removeTerminal, switchToProjectTerminals
  } = useTerminalStore()

  const sessionPreview = useSessionPreview()

  const activeSessionId = useSessionStore(s => s.activeSessionId)
  const sessions = useSessionStore(s => s.sessions)
  const createSession = useSessionStore(s => s.createSession)
  const setActiveSession = useSessionStore(s => s.setActiveSession)
  const markAsRead = useSessionStore(s => s.markAsRead)
  const removeSession = useSessionStore(s => s.removeSession)

  useEffect(() => {
    window.api.project.recent().then((data: any) => {
      // Handle both old array format and new object format
      if (Array.isArray(data)) {
        setRecent(data)
        setGroups([], data.map((p: any) => p.path))
      } else if (data && data.version === 2) {
        setRecent(data.projects)
        setGroups(data.groups || [], data.groupOrder || data.projects.map((p: any) => p.path))
      }
    })
    loadSettings()
  }, [setRecent, setGroups, loadSettings])

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
    // Also fetch scratch/quick chat history
    if (!paths.includes(SCRATCH_PROJECT_PATH)) paths.push(SCRATCH_PROJECT_PATH)
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
      if (entry.projectPath !== SCRATCH_PROJECT_PATH && entry.projectPath !== currentPath) {
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
      .sort((a, b) => b.createdAt - a.createdAt)
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

  const handleNewQuickChat = useCallback(() => {
    setCreatingThread(true)
    try {
      const scratchSessions = Object.values(useSessionStore.getState().sessions)
        .filter(s => s.projectPath === SCRATCH_PROJECT_PATH)
      const count = scratchSessions.length
      const sessionId = `sdk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      createSession(SCRATCH_PROJECT_PATH, sessionId)
      useSessionStore.getState().renameSession(sessionId, `Quick Chat${count > 0 ? ` ${count + 1}` : ''}`)
    } finally {
      setCreatingThread(false)
    }
  }, [createSession])

  const handleSelectSession = useCallback(async (sessionId: string) => {
    const session = useSessionStore.getState().sessions[sessionId]
    if (session && session.projectPath !== SCRATCH_PROJECT_PATH && session.projectPath !== currentPath) {
      await switchToProject(session.projectPath)
    }
    const uiState = useUIStore.getState()

    // If clicking a session that's part of the active split pair, just focus its pane
    if (uiState.splitView && uiState.splitSessionId) {
      const currentActive = useSessionStore.getState().activeSessionId
      if (sessionId === currentActive) {
        uiState.setFocusedSplitPane('left')
        markAsRead(sessionId)
        return
      }
      if (sessionId === uiState.splitSessionId) {
        uiState.setFocusedSplitPane('right')
        markAsRead(sessionId)
        return
      }
    }

    // If clicking a session in a stored pair (split view suspended), restore split view
    if (!uiState.splitView && session) {
      const pair = uiState.projectPairMemory[session.projectPath]
      if (pair && (sessionId === pair.writerId || sessionId === pair.reviewerId)) {
        const allSessions = useSessionStore.getState().sessions
        if (allSessions[pair.writerId] && allSessions[pair.reviewerId]) {
          setActiveSession(pair.writerId)
          uiState.restoreSplitView(pair.reviewerId)
          markAsRead(sessionId)
          return
        } else {
          // One session was closed, clear stale pair
          uiState.clearProjectPair(session.projectPath)
        }
      }
    }

    // Save current session's tab before switching, then restore target session's tab
    const editorState = useEditorStore.getState()
    const currentActive = useSessionStore.getState().activeSessionId
    if (currentActive && currentActive !== sessionId) {
      editorState.setSessionTab(currentActive, editorState.mainPanelTab)
    }
    // Restore target session's tab — default to 'chat' if never explicitly set
    const rememberedTab = editorState.sessionTabMemory[sessionId] ?? 'chat'
    editorState.setMainPanelTab(rememberedTab)

    if (uiState.splitView && uiState.focusedSplitPane === 'right') {
      uiState.setSplitSessionId(sessionId)
    } else {
      setActiveSession(sessionId)
    }
    markAsRead(sessionId)
  }, [currentPath, setActiveSession, markAsRead])

  const handleOpenProject = useCallback(async () => {
    const uiState = useUIStore.getState()
    if (uiState.splitView) uiState.suspendSplitView()
    const result = await window.api.project.open()
    if (result.success && result.path) {
      setProject(result.path, result.isGitRepo ?? false)
      window.api.project.recent().then((data: any) => {
        if (Array.isArray(data)) {
          setRecent(data)
        } else if (data && data.version === 2) {
          setRecent(data.projects)
          setGroups(data.groups || [], data.groupOrder || data.projects.map((p: any) => p.path))
        }
      })
      const lastPanel = projectSidePanelMemory[result.path]
      setSidePanelView(lastPanel ? { type: lastPanel, projectPath: result.path } : null)
      switchToProjectTerminals(result.path)
      ensureSession(result.path)
    }
  }, [setProject, setRecent, setGroups, projectSidePanelMemory, setSidePanelView, switchToProjectTerminals, ensureSession])

  const switchToProject = useCallback(async (path: string) => {
    if (path === currentPath) return
    // Suspend split view when switching projects — pair memory is preserved for restoration
    const uiState = useUIStore.getState()
    if (uiState.splitView) uiState.suspendSplitView()
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
    if (session && session.messages.length > 0 && session.projectPath !== SCRATCH_PROJECT_PATH) {
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
    window.api.checkpoint.cleanup(sessionId).catch(() => {})
    removeSession(sessionId)
    fetchHistory()
  }, [removeSession, fetchHistory])

  const handleClearOldSessions = useCallback(async (projectPath: string) => {
    await window.api.session.clearHistory(projectPath)
    setHistoryByProject(prev => ({ ...prev, [projectPath]: [] }))
  }, [])

  const handleClearAllSessions = useCallback(async (projectPath: string) => {
    // Close all active sessions for this project
    const projectSessions = Object.values(useSessionStore.getState().sessions)
      .filter(s => s.projectPath === projectPath)
    for (const s of projectSessions) {
      window.api.agent.stop(s.sessionId).catch(() => {})
      removeSession(s.sessionId)
    }
    // Clear history
    await window.api.session.clearHistory(projectPath)
    setHistoryByProject(prev => ({ ...prev, [projectPath]: [] }))
  }, [removeSession])

  const handleClearQuickChats = useCallback(async () => {
    // Close all active quick chat sessions
    const scratchSessions = Object.values(useSessionStore.getState().sessions)
      .filter(s => s.projectPath === SCRATCH_PROJECT_PATH)
    for (const s of scratchSessions) {
      window.api.agent.stop(s.sessionId).catch(() => {})
      removeSession(s.sessionId)
    }
    // Clear quick chat history
    await window.api.session.clearHistory(SCRATCH_PROJECT_PATH)
    setHistoryByProject(prev => ({ ...prev, [SCRATCH_PROJECT_PATH]: [] }))
  }, [removeSession])

  const handleForkSession = useCallback(async (sessionId: string) => {
    const session = useSessionStore.getState().sessions[sessionId]
    if (!session || session.messages.length === 0) return

    // Stop the agent if running
    await window.api.agent.stop(sessionId).catch(() => {})

    const sdkSessionId = session.sessionId
    const effectivePath = session.worktreePath || session.projectPath
    const result = await window.api.agent.fork(sessionId, effectivePath, sdkSessionId)
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

  // --- Group management ---
  const handleMoveToGroup = useCallback(async (projectPath: string, groupId: string | null) => {
    moveProjectToGroupLocally(projectPath, groupId)
    await window.api.project.moveToGroup(projectPath, groupId)
  }, [moveProjectToGroupLocally])

  const handleCreateGroup = useCallback(async (name: string, initialProjectPath?: string) => {
    const result = await window.api.project.createGroup(name)
    if (result.success && result.group) {
      addGroupLocally(result.group)
      if (initialProjectPath) {
        moveProjectToGroupLocally(initialProjectPath, result.group.id)
        await window.api.project.moveToGroup(initialProjectPath, result.group.id)
      }
    }
  }, [addGroupLocally, moveProjectToGroupLocally])

  const handleRenameGroup = useCallback(async (groupId: string, name: string) => {
    updateGroupLocally(groupId, { name })
    await window.api.project.renameGroup(groupId, name)
  }, [updateGroupLocally])

  const handleDeleteGroup = useCallback(async (groupId: string) => {
    removeGroupLocally(groupId)
    await window.api.project.deleteGroup(groupId)
  }, [removeGroupLocally])

  // Group context menu state
  const [groupContextMenu, setGroupContextMenu] = useState<{ x: number; y: number; groupId: string } | null>(null)
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null)
  const [newGroupInput, setNewGroupInput] = useState<string | null>(null) // projectPath that triggered "New group..."

  useEffect(() => {
    if (!groupContextMenu) return
    const dismiss = () => setGroupContextMenu(null)
    window.addEventListener('click', dismiss)
    window.addEventListener('contextmenu', dismiss)
    return () => {
      window.removeEventListener('click', dismiss)
      window.removeEventListener('contextmenu', dismiss)
    }
  }, [groupContextMenu])

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

  const projectByPath = new Map(projectList.map(p => [p.path, p]))

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
      const reordered = [...groupOrder]
      const [moved] = reordered.splice(dragIndex, 1)
      reordered.splice(dragOverIndex, 0, moved)
      reorderGroupOrder(reordered)
      window.api.project.reorderAll(reordered)
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }, [dragIndex, dragOverIndex, groupOrder, reorderGroupOrder])

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null)
  }, [])

  // Helper to render a project tree for a given path
  const renderProjectTree = (projPath: string, inGroup?: boolean) => {
    const proj = projectByPath.get(projPath)
    if (!proj) return null
    return (
      <ProjectTree
        projectPath={proj.path}
        projectName={proj.name}
        isCurrentProject={proj.isCurrent}
        isGitRepo={proj.isGitRepo}
        sdkSessions={getSessionsForProject(proj.path)}
        activeSessionId={activeSessionId}
        collapsed={!expandedProjects.includes(proj.path)}
        onToggleCollapse={() => toggleProjectExpanded(proj.path)}
        onSwitchToProject={() => switchToProject(proj.path)}
        onSelectSession={handleSelectSession}
        onRenameSession={(id, name) => useSessionStore.getState().renameSession(id, name)}
        onCloseSession={handleCloseSession}
        onNewThread={() => handleNewThread(proj.path)}
        onRemoveProject={() => handleRemoveProject(proj.path)}
        onClearOldSessions={() => handleClearOldSessions(proj.path)}
        onClearAllSessions={() => handleClearAllSessions(proj.path)}
        onForkSession={handleForkSession}
        historyEntries={historyByProject[proj.path] || []}
        onResumeHistory={handleResumeHistory}
        sessionPreview={sessionPreview}
        pairedWriterId={projectPairMemory[proj.path]?.writerId ?? null}
        pairedReviewerId={projectPairMemory[proj.path]?.reviewerId ?? null}
        groups={groups}
        currentGroupId={inGroup ? groups.find(g => g.projectPaths.includes(proj.path))?.id ?? null : null}
        onMoveToGroup={handleMoveToGroup}
        onCreateGroup={handleCreateGroup}
      />
    )
  }

  // Compute effective groupOrder — include currentPath if missing
  const effectiveGroupOrder = [...groupOrder]
  if (currentPath && !recentProjects.some(p => p.path === currentPath)) {
    // currentPath is not in recentProjects, add it to top if not already in groupOrder
    if (!effectiveGroupOrder.includes(currentPath)) {
      effectiveGroupOrder.unshift(currentPath)
    }
  }

  return (
    <aside className="sidebar">
      {/* New Thread + Quick Chat buttons */}
      <div className="sidebar-new-thread" style={{ display: 'flex', gap: '4px' }}>
        <button
          className="btn btn-primary btn-new-thread"
          onClick={() => currentPath && handleNewThread(currentPath)}
          disabled={!currentPath || creatingThread}
          style={{ flex: 1 }}
        >
          {creatingThread ? 'Starting...' : '+ New thread'}
        </button>
        <button
          className="btn btn-quick-chat"
          onClick={handleNewQuickChat}
          disabled={creatingThread}
          title="Start a chat without a project"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
        </button>
      </div>

      {/* Threads */}
      <div className="sidebar-projects">
        <div className="sidebar-section-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span className="sidebar-section-toggle" onClick={() => toggleSection('projects')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: sectionsCollapsed.projects ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
            Projects
          </span>
          <button
            className="sidebar-section-action"
            onClick={handleOpenProject}
            title="Open project"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>

        {/* New group name input (shown when user clicks "New group...") */}
        {newGroupInput !== null && (
          <div className="sidebar-group-new-input" style={{ padding: '2px 8px' }}>
            <input
              autoFocus
              placeholder="Group name..."
              style={{
                width: '100%',
                fontSize: '11px',
                padding: '3px 6px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--accent)',
                borderRadius: '3px',
                color: 'var(--text-primary)',
                outline: 'none'
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const name = (e.target as HTMLInputElement).value.trim()
                  if (name) {
                    handleCreateGroup(name, newGroupInput)
                  }
                  setNewGroupInput(null)
                } else if (e.key === 'Escape') {
                  setNewGroupInput(null)
                }
              }}
              onBlur={(e) => {
                const name = e.target.value.trim()
                if (name) {
                  handleCreateGroup(name, newGroupInput)
                }
                setNewGroupInput(null)
              }}
            />
          </div>
        )}

        {!sectionsCollapsed.projects && effectiveGroupOrder.map((entry, index) => {
          const group = groups.find(g => g.id === entry)

          if (group) {
            // Render a group
            const isGroupCollapsed = collapsedGroups.includes(group.id)
            return (
              <div
                key={group.id}
                className={`sidebar-group-drag-wrapper${dragOverIndex === index && dragIndex !== index ? ' drag-over' : ''}${dragIndex === index ? ' dragging' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                onDragLeave={handleDragLeave}
                ref={dragIndex === index ? dragNodeRef : undefined}
              >
                <div
                  className="sidebar-group-header"
                  onClick={() => toggleGroupCollapsed(group.id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setGroupContextMenu({ x: e.clientX, y: e.clientY, groupId: group.id })
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isGroupCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease', flexShrink: 0 }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  {renamingGroupId === group.id ? (
                    <input
                      autoFocus
                      defaultValue={group.name}
                      className="sidebar-group-rename-input"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const name = (e.target as HTMLInputElement).value.trim()
                          if (name) handleRenameGroup(group.id, name)
                          setRenamingGroupId(null)
                        } else if (e.key === 'Escape') {
                          setRenamingGroupId(null)
                        }
                      }}
                      onBlur={(e) => {
                        const name = e.target.value.trim()
                        if (name && name !== group.name) handleRenameGroup(group.id, name)
                        setRenamingGroupId(null)
                      }}
                    />
                  ) : (
                    <span
                      className="sidebar-group-name"
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        setRenamingGroupId(group.id)
                      }}
                    >
                      {group.name}
                    </span>
                  )}
                </div>
                {!isGroupCollapsed && group.projectPaths.map(projPath => (
                  <div key={projPath} className="sidebar-project-in-group">
                    {renderProjectTree(projPath, true)}
                  </div>
                ))}
                {!isGroupCollapsed && group.projectPaths.length === 0 && (
                  <div style={{ padding: '4px 8px 4px 20px', fontSize: '11px', color: 'var(--text-muted)' }}>
                    No projects in group
                  </div>
                )}
              </div>
            )
          } else {
            // entry is a project path (ungrouped)
            const proj = projectByPath.get(entry)
            if (!proj) return null
            return (
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
                {renderProjectTree(proj.path)}
              </div>
            )
          }
        })}

        {!sectionsCollapsed.projects && effectiveGroupOrder.length === 0 && projectList.length === 0 && (
          <div style={{ padding: '8px 10px', fontSize: '12px', color: 'var(--text-muted)' }}>
            No projects yet
          </div>
        )}

        {/* Group context menu */}
        {groupContextMenu && createPortal(
          <div
            className="thread-context-menu"
            style={{
              left: Math.min(groupContextMenu.x, window.innerWidth - 180),
              ...(groupContextMenu.y + 100 > window.innerHeight
                ? { bottom: window.innerHeight - groupContextMenu.y }
                : { top: groupContextMenu.y })
            }}
          >
            <button
              className="thread-context-menu-item"
              onClick={() => {
                setRenamingGroupId(groupContextMenu.groupId)
                setGroupContextMenu(null)
              }}
            >
              Rename group
            </button>
            <button
              className="thread-context-menu-item thread-context-menu-danger"
              onClick={() => {
                handleDeleteGroup(groupContextMenu.groupId)
                setGroupContextMenu(null)
              }}
            >
              Delete group
            </button>
          </div>,
          document.body
        )}

        {/* Quick Chat sessions */}
        {(() => {
          const scratchSessions = Object.values(sessions)
            .filter(s => s.projectPath === SCRATCH_PROJECT_PATH)
            .sort((a, b) => b.createdAt - a.createdAt)
          const scratchHistory = historyByProject[SCRATCH_PROJECT_PATH] || []
          return (
            <div className="sidebar-scratch-section">
              <div
                className="sidebar-section-label"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setQuickChatContextMenu({ x: e.clientX, y: e.clientY })
                }}
              >
                <span className="sidebar-section-toggle" onClick={() => toggleSection('chats')} style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: sectionsCollapsed.chats ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s ease' }}>
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                  Quick Chats
                </span>
                <button
                  className="sidebar-section-action"
                  onClick={handleNewQuickChat}
                  title="New quick chat"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              </div>
              {!sectionsCollapsed.chats && scratchSessions.map(s => {
                const isActive = activeSessionId === s.sessionId
                const displayName = s.name || 'Quick Chat'
                const isRunning = s.isProcessing
                const needsInput = sessionNeedsInput(s)
                return (
                  <div
                    key={s.sessionId}
                    className={`tree-item tree-item-thread${isActive ? ' active' : ''}`}
                    onMouseEnter={(e) => sessionPreview.onSessionMouseEnter(e, s.sessionId, null)}
                    onMouseLeave={() => sessionPreview.onSessionMouseLeave()}
                  >
                    <button
                      className="tree-item-btn"
                      onClick={() => handleSelectSession(s.sessionId)}
                      style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', padding: '2px 0', textAlign: 'left', fontSize: 'inherit', fontFamily: 'inherit' }}
                    >
                      <span
                        className={`tree-item-status-indicator ${needsInput ? 'needs-input' : isRunning ? 'spinner' : ''}`}
                        style={!isRunning && !needsInput ? { color: '#888' } : undefined}
                      >
                        {needsInput ? '\u25CF' : isRunning ? '' : '\u25CB'}
                      </span>
                      <span className="tree-item-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName}</span>
                    </button>
                    <button
                      className="tree-item-close"
                      onClick={(e) => { e.stopPropagation(); handleCloseSession(s.sessionId) }}
                      title="Close"
                      style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 4px', fontSize: '12px', lineHeight: 1, opacity: 0.6 }}
                    >
                      &times;
                    </button>
                  </div>
                )
              })}
              {quickChatContextMenu && createPortal(
                <div
                  className="thread-context-menu"
                  style={{
                    left: Math.min(quickChatContextMenu.x, window.innerWidth - 180),
                    ...(quickChatContextMenu.y + 100 > window.innerHeight
                      ? { bottom: window.innerHeight - quickChatContextMenu.y }
                      : { top: quickChatContextMenu.y })
                  }}
                >
                  <button
                    className="thread-context-menu-item thread-context-menu-danger"
                    onClick={() => {
                      handleClearQuickChats()
                      setQuickChatContextMenu(null)
                    }}
                  >
                    Clear all sessions
                  </button>
                </div>,
                document.body
              )}
            </div>
          )
        })()}

      </div>

      {sessionPreview.previewTarget && (
        <SessionPreviewCard
          sessionId={sessionPreview.previewTarget.sessionId}
          historyEntry={sessionPreview.previewTarget.historyEntry}
          triggerRect={sessionPreview.previewTarget.triggerRect}
          onMouseEnter={sessionPreview.onPreviewMouseEnter}
          onMouseLeave={sessionPreview.onPreviewMouseLeave}
        />
      )}
    </aside>
  )
}
