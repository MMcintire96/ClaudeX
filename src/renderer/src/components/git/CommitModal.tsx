import React, { useState, useEffect, useCallback } from 'react'

interface CommitModalProps {
  projectPath: string
  onClose: () => void
  onCommitted?: () => void
}

type NextStep = 'commit' | 'commit-push' | 'commit-pr'

export default function CommitModal({ projectPath, onClose, onCommitted }: CommitModalProps) {
  const [branch, setBranch] = useState<string | null>(null)
  const [fileCount, setFileCount] = useState(0)
  const [insertions, setInsertions] = useState(0)
  const [deletions, setDeletions] = useState(0)
  const [includeUnstaged, setIncludeUnstaged] = useState(true)
  const [message, setMessage] = useState('')
  const [nextStep, setNextStep] = useState<NextStep>('commit')
  const [hasRemotes, setHasRemotes] = useState(false)
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.project.gitBranch(projectPath).then(r => {
      if (r.success) setBranch(r.branch ?? null)
    })
    window.api.project.gitRemotes(projectPath).then(r => {
      if (r.success && r.remotes && r.remotes.length > 0) setHasRemotes(true)
    })
  }, [projectPath])

  // Load diff summary (combined staged + unstaged when includeUnstaged, else staged only)
  useEffect(() => {
    const loadSummary = async () => {
      if (includeUnstaged) {
        // Get both staged and unstaged
        const [staged, unstaged] = await Promise.all([
          window.api.project.gitDiffSummary(projectPath, true),
          window.api.project.gitDiffSummary(projectPath, false)
        ])
        const sFiles = staged.success && staged.summary ? staged.summary.files.map(f => f.file) : []
        const uFiles = unstaged.success && unstaged.summary ? unstaged.summary.files.map(f => f.file) : []
        const allFiles = new Set([...sFiles, ...uFiles])
        // Also count untracked files
        const status = await window.api.project.gitStatus(projectPath)
        if (status.success && status.status) {
          const st = status.status as { not_added?: string[] }
          if (st.not_added) st.not_added.forEach(f => allFiles.add(f))
        }
        setFileCount(allFiles.size)
        setInsertions(
          (staged.summary?.insertions || 0) + (unstaged.summary?.insertions || 0)
        )
        setDeletions(
          (staged.summary?.deletions || 0) + (unstaged.summary?.deletions || 0)
        )
      } else {
        const result = await window.api.project.gitDiffSummary(projectPath, true)
        if (result.success && result.summary) {
          setFileCount(result.summary.changed)
          setInsertions(result.summary.insertions)
          setDeletions(result.summary.deletions)
        } else {
          setFileCount(0)
          setInsertions(0)
          setDeletions(0)
        }
      }
    }
    loadSummary()
  }, [projectPath, includeUnstaged])

  const handleContinue = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Stage all if includeUnstaged is on
      if (includeUnstaged) {
        const addResult = await window.api.project.gitAdd(projectPath)
        if (!addResult.success) {
          setError(addResult.error || 'Failed to stage files')
          setLoading(false)
          return
        }
      }

      // Commit
      const commitMsg = message.trim() || 'Update'
      const commitResult = await window.api.project.gitCommit(projectPath, commitMsg)
      if (!commitResult.success) {
        setError(commitResult.error || 'Failed to commit')
        setLoading(false)
        return
      }

      // Push if needed
      if (nextStep === 'commit-push' || nextStep === 'commit-pr') {
        const pushResult = await window.api.project.gitPush(projectPath)
        if (!pushResult.success) {
          setError(pushResult.error || 'Failed to push')
          setLoading(false)
          return
        }
      }

      // Create PR — open gh pr create in a terminal
      if (nextStep === 'commit-pr') {
        const termResult = await window.api.terminal.create(projectPath)
        if (termResult.success && termResult.id) {
          await window.api.terminal.write(termResult.id, 'gh pr create --web\n')
        }
      }

      onCommitted?.()
      onClose()
    } catch (err) {
      setError((err as Error).message)
    }
    setLoading(false)
  }, [projectPath, includeUnstaged, message, nextStep, onClose, onCommitted])

  const handleGenerate = useCallback(async () => {
    setGenerating(true)
    setError(null)
    try {
      const result = await window.api.project.generateCommitMessage(projectPath, includeUnstaged)
      if (result.success && result.message) {
        setMessage(result.message)
      } else {
        setError(result.error || 'Failed to generate message')
      }
    } catch (err) {
      setError((err as Error).message)
    }
    setGenerating(false)
  }, [projectPath, includeUnstaged])

  return (
    <div className="hotkeys-overlay" onClick={onClose}>
      <div className="commit-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="commit-modal-header">
          <div className="commit-modal-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4"/>
              <line x1="1.05" y1="12" x2="7" y2="12"/>
              <line x1="17.01" y1="12" x2="22.96" y2="12"/>
            </svg>
          </div>
          <button className="hotkeys-close" onClick={onClose}>&times;</button>
        </div>

        <div className="commit-modal-body">
          <h3 className="commit-modal-title">Commit your changes</h3>

          {/* Branch */}
          <div className="commit-modal-row">
            <span className="commit-modal-label">Branch</span>
            <span className="commit-modal-value">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 4, opacity: 0.6 }}>
                <line x1="6" y1="3" x2="6" y2="15"/>
                <circle cx="18" cy="6" r="3"/>
                <circle cx="6" cy="18" r="3"/>
                <path d="M18 9a9 9 0 0 1-9 9"/>
              </svg>
              {branch || '...'}
            </span>
          </div>

          {/* Changes */}
          <div className="commit-modal-row">
            <span className="commit-modal-label">Changes</span>
            <span className="commit-modal-value">
              <span>{fileCount} file{fileCount !== 1 ? 's' : ''}</span>
              {(insertions > 0 || deletions > 0) && (
                <span className="commit-modal-stats">
                  {insertions > 0 && <span className="commit-stat-add">+{insertions}</span>}
                  {deletions > 0 && <span className="commit-stat-del">-{deletions}</span>}
                </span>
              )}
            </span>
          </div>

          {/* Include unstaged toggle */}
          <div className="commit-modal-toggle-row">
            <button
              className={`commit-toggle ${includeUnstaged ? 'active' : ''}`}
              onClick={() => setIncludeUnstaged(v => !v)}
            >
              <span className="commit-toggle-track">
                <span className="commit-toggle-thumb" />
              </span>
            </button>
            <span className="commit-modal-toggle-label">Include unstaged</span>
          </div>

          {/* Commit message */}
          <div className="commit-modal-section">
            <div className="commit-modal-section-header">
              <span className="commit-modal-section-label">Commit message</span>
              <button
                className="commit-generate-btn"
                onClick={handleGenerate}
                disabled={generating || fileCount === 0}
                title="Generate commit message with AI"
              >
                {generating ? (
                  <svg className="commit-generate-spinner" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                ) : (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3v5m4-1L12 3 8 7"/>
                    <path d="M17.5 6.5l-2 5.5 5.5-2-3.5-3.5z"/>
                    <path d="M6.5 17.5l2-5.5-5.5 2 3.5 3.5z"/>
                    <path d="M17.5 17.5l-5.5-2 2 5.5 3.5-3.5z"/>
                    <path d="M6.5 6.5l5.5 2-2-5.5L6.5 6.5z"/>
                  </svg>
                )}
                <span>{generating ? 'Generating...' : 'Generate'}</span>
              </button>
            </div>
            <textarea
              className="commit-modal-textarea"
              placeholder="Write a message or generate one with AI"
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={3}
            />
          </div>

          {/* Next steps */}
          <div className="commit-modal-section">
            <span className="commit-modal-section-label">Next steps</span>
            <div className="commit-modal-options">
              <button
                className={`commit-option ${nextStep === 'commit' ? 'active' : ''}`}
                onClick={() => setNextStep('commit')}
              >
                <span className="commit-option-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="4"/>
                    <line x1="1.05" y1="12" x2="7" y2="12"/>
                    <line x1="17.01" y1="12" x2="22.96" y2="12"/>
                  </svg>
                </span>
                <span className="commit-option-label">Commit</span>
                {nextStep === 'commit' && <span className="commit-option-check">&#10003;</span>}
              </button>
              <button
                className={`commit-option ${nextStep === 'commit-push' ? 'active' : ''} ${!hasRemotes ? 'disabled' : ''}`}
                onClick={() => hasRemotes && setNextStep('commit-push')}
                disabled={!hasRemotes}
              >
                <span className="commit-option-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="19" x2="12" y2="5"/>
                    <polyline points="5 12 12 5 19 12"/>
                  </svg>
                </span>
                <span className="commit-option-label">Commit and push</span>
                {nextStep === 'commit-push' && <span className="commit-option-check">&#10003;</span>}
              </button>
              <button
                className={`commit-option ${nextStep === 'commit-pr' ? 'active' : ''} ${!hasRemotes ? 'disabled' : ''}`}
                onClick={() => hasRemotes && setNextStep('commit-pr')}
                disabled={!hasRemotes}
              >
                <span className="commit-option-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="18" cy="18" r="3"/>
                    <circle cx="6" cy="6" r="3"/>
                    <path d="M13 6h3a2 2 0 0 1 2 2v7"/>
                    <line x1="6" y1="9" x2="6" y2="21"/>
                  </svg>
                </span>
                <span className="commit-option-label">Commit and create PR</span>
                {nextStep === 'commit-pr' && <span className="commit-option-check">&#10003;</span>}
              </button>
            </div>
          </div>

          {error && <div className="commit-modal-error">{error}</div>}

          {/* Continue button */}
          <button
            className="commit-modal-continue"
            onClick={handleContinue}
            disabled={loading}
          >
            {loading ? 'Working...' : 'Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
