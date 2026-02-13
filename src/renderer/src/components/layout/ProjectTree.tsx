import React, { useCallback } from 'react'
import { SessionState } from '../../stores/sessionStore'

interface ProjectTreeProps {
  projectPath: string
  projectName: string
  isExpanded: boolean
  isCurrentProject: boolean
  isGitRepo: boolean
  sessions: SessionState[]
  activeSessionId: string | null
  activeSidePanelType: string | null
  activeSidePanelProject: string | null
  terminalCount: number
  terminalActive: boolean
  onToggleExpanded: () => void
  onSwitchToProject: () => void
  onSelectSession: (sessionId: string) => void
  onNewSession: () => void
  onOpenBrowser: () => void
  onOpenDiff: () => void
  onOpenTerminal: () => void
}

export default function ProjectTree({
  projectPath,
  projectName,
  isExpanded,
  isCurrentProject,
  isGitRepo,
  sessions,
  activeSessionId,
  activeSidePanelType,
  activeSidePanelProject,
  terminalCount,
  terminalActive,
  onToggleExpanded,
  onSwitchToProject,
  onSelectSession,
  onNewSession,
  onOpenBrowser,
  onOpenDiff,
  onOpenTerminal
}: ProjectTreeProps) {
  const handleHeaderClick = useCallback(() => {
    if (!isCurrentProject) {
      // Switch workspace to this project (restores its last view)
      onSwitchToProject()
    }
    onToggleExpanded()
  }, [isCurrentProject, onSwitchToProject, onToggleExpanded])

  const isBrowserActive = isCurrentProject && activeSidePanelType === 'browser' && activeSidePanelProject === projectPath
  const isDiffActive = isCurrentProject && activeSidePanelType === 'diff' && activeSidePanelProject === projectPath
  const isTerminalActive = isCurrentProject && terminalActive

  return (
    <div className="project-tree">
      <button
        className={`project-tree-header ${isCurrentProject ? 'current' : ''}`}
        onClick={handleHeaderClick}
      >
        <span className={`project-group-chevron ${isExpanded ? 'open' : ''}`}>
          &#9654;
        </span>
        <span className="project-group-icon">{'\u25CF'}</span>
        <span className="project-group-name">{projectName}</span>
      </button>

      {isExpanded && (
        <div className="project-tree-children">
          {/* Sessions */}
          {sessions.map(s => {
            const isActive = isCurrentProject && activeSessionId === s.sessionId
            return (
              <button
                key={s.sessionId}
                className={`tree-item tree-item-session ${isActive ? 'active' : ''}`}
                onClick={() => onSelectSession(s.sessionId)}
                title={`Session (${s.numTurns} turns)`}
              >
                <span className="tree-item-icon">
                  {s.isProcessing ? '\u25CF' : isActive ? '\u25CF' : '\u25CB'}
                </span>
                <span className="tree-item-label">
                  {s.name}{s.numTurns > 0 ? ` (${s.numTurns})` : ''}
                </span>
              </button>
            )
          })}

          {/* Browser */}
          <button
            className={`tree-item tree-item-browser ${isBrowserActive ? 'active' : ''}`}
            onClick={onOpenBrowser}
          >
            <span className="tree-item-icon">&#9741;</span>
            <span className="tree-item-label">Browser</span>
          </button>

          {/* Diff */}
          <button
            className={`tree-item tree-item-diff ${isDiffActive ? 'active' : ''}`}
            onClick={onOpenDiff}
          >
            <span className="tree-item-icon">&#916;</span>
            <span className="tree-item-label">Diff</span>
          </button>

          {/* Terminal */}
          <button
            className={`tree-item tree-item-terminal ${isTerminalActive ? 'active' : ''}`}
            onClick={onOpenTerminal}
          >
            <span className="tree-item-icon">&gt;_</span>
            <span className="tree-item-label">
              Terminal{terminalCount > 1 ? ` (${terminalCount})` : ''}
            </span>
          </button>

          {/* New session */}
          <button
            className="tree-item tree-item-new"
            onClick={onNewSession}
          >
            <span className="tree-item-icon">+</span>
            <span className="tree-item-label">New session</span>
          </button>
        </div>
      )}
    </div>
  )
}
