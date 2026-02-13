import React, { useState, useEffect, useCallback, useRef } from 'react'
import DiffView from './DiffView'

interface FileStatus {
  path: string
  index: string
  working_dir: string
}

interface DiffPanelProps {
  projectPath: string
}

export default function DiffPanel({ projectPath }: DiffPanelProps) {
  const [diff, setDiff] = useState('')
  const [files, setFiles] = useState<FileStatus[]>([])
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [filesCollapsed, setFilesCollapsed] = useState(true)
  const selectedFileRef = useRef<string | null>(null)
  selectedFileRef.current = selectedFile

  const loadStatus = useCallback(async () => {
    if (!projectPath) return
    setLoading(true)
    try {
      const result = await window.api.project.gitStatus(projectPath)
      if (result.success && result.status) {
        const status = result.status as { files: FileStatus[] }
        setFiles(status.files || [])
      }
    } catch {
      // ignore
    }
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
        result = await window.api.project.diff(projectPath)
      }
      if (result.success) {
        setDiff(result.diff || '')
      }
    } catch {
      // ignore
    }
    setLoading(false)
  }, [projectPath])

  useEffect(() => {
    loadStatus()
    loadDiff()
    setSelectedFile(null)
  }, [loadStatus, loadDiff, projectPath])

  // Auto-refresh when agent finishes a turn (files may have changed)
  useEffect(() => {
    const unsub = window.api.agent.onClosed(() => {
      loadStatus()
      const file = selectedFileRef.current
      if (file) {
        loadDiff(file)
      } else {
        loadDiff()
      }
    })
    return unsub
  }, [loadStatus, loadDiff])

  const handleFileClick = useCallback((path: string) => {
    setSelectedFile(path)
    loadDiff(path)
  }, [loadDiff])

  const handleRefresh = useCallback(() => {
    loadStatus()
    if (selectedFile) {
      loadDiff(selectedFile)
    } else {
      loadDiff()
    }
  }, [loadStatus, loadDiff, selectedFile])

  return (
    <div className="diff-panel">
      <div className="diff-panel-header">
        <h3>Changes</h3>
        <button className="btn btn-sm" onClick={handleRefresh}>
          Refresh
        </button>
      </div>

      {files.length > 0 && (
        <div className="diff-file-section">
          <button
            className="diff-file-section-toggle"
            onClick={() => setFilesCollapsed(!filesCollapsed)}
          >
            <span className="diff-file-section-chevron">
              {filesCollapsed ? '\u25B8' : '\u25BE'}
            </span>
            <span className="diff-file-section-label">
              Files changed
            </span>
            <span className="diff-file-section-count">{files.length}</span>
          </button>

          {!filesCollapsed && (
            <div className="diff-file-list">
              <button
                className={`diff-file-item ${!selectedFile ? 'active' : ''}`}
                onClick={() => { setSelectedFile(null); loadDiff() }}
              >
                All changes
              </button>
              {files.map(f => (
                <button
                  key={f.path}
                  className={`diff-file-item ${selectedFile === f.path ? 'active' : ''}`}
                  onClick={() => handleFileClick(f.path)}
                >
                  <span className="diff-file-status">
                    {f.working_dir !== ' ' ? f.working_dir : f.index}
                  </span>
                  {f.path}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="diff-content">
        {loading ? (
          <div className="diff-loading">Loading...</div>
        ) : (
          <DiffView diff={diff} />
        )}
      </div>
    </div>
  )
}
