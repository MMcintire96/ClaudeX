import React, { useState } from 'react'
import { useSessionStore } from '../../stores/sessionStore'
import { useTerminalStore } from '../../stores/terminalStore'

interface WorktreeBarProps {
  sessionId: string
  projectPath: string
}

export default function WorktreeBar({ sessionId, projectPath }: WorktreeBarProps) {
  const session = useSessionStore(s => s.sessions[sessionId])
  const addTerminal = useTerminalStore(s => s.addTerminal)
  const [showBranchInput, setShowBranchInput] = useState(false)
  const [branchName, setBranchName] = useState('')
  const [showSyncMenu, setShowSyncMenu] = useState(false)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [syncResult, setSyncResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [discarded, setDiscarded] = useState(false)

  const worktreePath = session?.worktreePath
  const wtSessionId = session?.worktreeSessionId
  const worktreeBranch = session?.worktreeBranch ?? null

  if (!worktreePath || !session?.isWorktree || discarded || !wtSessionId) return null

  const handleOpenTerminal = async () => {
    const result = await window.api.terminal.create(worktreePath)
    if (result.success && result.id) {
      addTerminal({
        id: result.id,
        projectPath,
        pid: result.pid || 0,
        name: 'Worktree Shell'
      })
      // Ensure the terminal panel is visible
      useTerminalStore.setState({ panelVisible: true })
    }
  }

  const handleCreateBranch = async () => {
    if (!branchName.trim()) return
    setActionInProgress('branch')
    try {
      const result = await window.api.worktree.createBranch(wtSessionId, branchName.trim())
      if (result.success) {
        useSessionStore.getState().setWorktreeBranch(sessionId, branchName.trim())
        setShowBranchInput(false)
        setBranchName('')
      }
    } finally {
      setActionInProgress(null)
    }
  }

  const handleSync = async (mode: 'overwrite' | 'apply') => {
    setShowSyncMenu(false)
    setActionInProgress('sync')
    setSyncResult(null)
    try {
      const result = await window.api.worktree.syncToLocal(wtSessionId, mode)
      if (result.success) {
        setSyncResult({ ok: true, message: `Synced to local (${mode})` })
      } else {
        setSyncResult({ ok: false, message: result.error || 'Sync failed' })
      }
    } catch (err) {
      setSyncResult({ ok: false, message: (err as Error).message })
    } finally {
      setActionInProgress(null)
      setTimeout(() => setSyncResult(null), 4000)
    }
  }

  const handleDiscard = async () => {
    setShowDiscardConfirm(false)
    setActionInProgress('discard')
    try {
      await window.api.worktree.remove(wtSessionId)
      setDiscarded(true)
    } catch {
      // Best effort cleanup
    } finally {
      setActionInProgress(null)
    }
  }

  return (
    <div className="worktree-bar">
      <div className="worktree-bar-status">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="6" y1="3" x2="6" y2="15" />
          <circle cx="18" cy="6" r="3" />
          <circle cx="6" cy="18" r="3" />
          <path d="M18 9a9 9 0 0 1-9 9" />
        </svg>
        <span className="worktree-bar-label">
          Worktree
          {worktreeBranch && <span className="worktree-branch-name"> ({worktreeBranch})</span>}
        </span>
        {syncResult && (
          <span className={`worktree-sync-result ${syncResult.ok ? 'success' : 'error'}`}>
            {syncResult.message}
          </span>
        )}
      </div>
      <div className="worktree-bar-actions">
        <button className="worktree-btn" onClick={handleOpenTerminal} title="Open shell in worktree directory">
          Terminal
        </button>

        {/* Create Branch */}
        {!worktreeBranch && (
          showBranchInput ? (
            <div className="worktree-branch-input-wrapper">
              <input
                className="worktree-branch-input"
                value={branchName}
                onChange={e => setBranchName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') handleCreateBranch()
                  if (e.key === 'Escape') { setShowBranchInput(false); setBranchName('') }
                }}
                placeholder="branch-name"
                autoFocus
              />
              <button
                className="worktree-btn worktree-btn-confirm"
                onClick={handleCreateBranch}
                disabled={!branchName.trim() || actionInProgress === 'branch'}
              >
                {actionInProgress === 'branch' ? '...' : 'Create'}
              </button>
            </div>
          ) : (
            <button className="worktree-btn" onClick={() => setShowBranchInput(true)} title="Promote to named branch">
              Create Branch
            </button>
          )
        )}

        {/* Sync with Local */}
        <div className="worktree-sync-wrapper">
          <button
            className="worktree-btn"
            onClick={() => setShowSyncMenu(!showSyncMenu)}
            disabled={actionInProgress === 'sync'}
            title="Sync changes to local checkout"
          >
            {actionInProgress === 'sync' ? 'Syncing...' : 'Sync to Local'}
          </button>
          {showSyncMenu && (
            <div className="worktree-sync-dropdown">
              <button className="worktree-sync-option" onClick={() => handleSync('apply')}>
                <strong>Apply</strong>
                <span>Apply changes as patch (preserves local history)</span>
              </button>
              <button className="worktree-sync-option" onClick={() => handleSync('overwrite')}>
                <strong>Overwrite</strong>
                <span>Reset local to match worktree state</span>
              </button>
            </div>
          )}
        </div>

        {/* Discard */}
        {showDiscardConfirm ? (
          <div className="worktree-discard-confirm">
            <span>Delete worktree?</span>
            <button className="worktree-btn worktree-btn-danger" onClick={handleDiscard}>
              {actionInProgress === 'discard' ? '...' : 'Yes'}
            </button>
            <button className="worktree-btn" onClick={() => setShowDiscardConfirm(false)}>No</button>
          </div>
        ) : (
          <button
            className="worktree-btn worktree-btn-danger"
            onClick={() => setShowDiscardConfirm(true)}
            title="Remove worktree"
          >
            Discard
          </button>
        )}
      </div>
    </div>
  )
}
