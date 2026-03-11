import React, { useState, useMemo, useCallback } from 'react'
import type { UIToolUseMessage, UIToolResultMessage } from '../../stores/sessionStore'
import { useEditorStore } from '../../stores/editorStore'

interface Props {
  toolUses: UIToolUseMessage[]
  results: (UIToolResultMessage | null)[]
  projectPath?: string
}

function shortPath(filePath: string): string {
  const parts = filePath.split('/')
  if (parts.length <= 2) return filePath
  return parts.slice(-2).join('/')
}

export default function ReadGroup({ toolUses, results, projectPath }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [hasBeenExpanded, setHasBeenExpanded] = useState(false)
  const [expandedIdx, setExpandedIdx] = useState<Set<number>>(new Set())
  const [everExpandedIdx, setEverExpandedIdx] = useState<Set<number>>(new Set())

  const handleOpenInEditor = useCallback(async (e: React.MouseEvent, filePath: string) => {
    e.stopPropagation()
    if (!projectPath || !filePath) return
    const editorState = useEditorStore.getState()
    if (editorState.activeEditors[projectPath]) {
      await window.api.neovim.openFile(projectPath, filePath)
    } else {
      await window.api.neovim.create(projectPath, filePath)
    }
    useEditorStore.getState().setMainPanelTab('editor')
  }, [projectPath])

  const files = useMemo(() =>
    toolUses.map((tu, i) => {
      const filePath = (tu.input.file_path || tu.input.path || '') as string
      const result = results[i]
      const hasError = result?.isError || false
      // Build truncated preview
      let preview: string | null = null
      if (result?.content) {
        const lines = result.content.split('\n')
        preview = lines.length <= 8
          ? result.content
          : lines.slice(0, 6).join('\n') + `\n... (${lines.length} lines total)`
      }
      return { filePath, shortPath: shortPath(filePath), hasError, preview }
    }),
    [toolUses, results]
  )

  const errorCount = files.filter(f => f.hasError).length

  const toggleFile = (idx: number) => {
    setExpandedIdx(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
    setEverExpandedIdx(prev => {
      const next = new Set(prev)
      next.add(idx)
      return next
    })
  }

  return (
    <div className="read-group">
      <button className="read-group-header" onClick={() => { if (!expanded) setHasBeenExpanded(true); setExpanded(!expanded) }}>
        <svg className="read-group-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        <span className="read-group-summary">
          Read {files.length} file{files.length !== 1 ? 's' : ''}
        </span>
        {errorCount > 0 && (
          <span className="read-group-error-badge">{errorCount} error{errorCount !== 1 ? 's' : ''}</span>
        )}
        <svg className={`tool-chevron${expanded ? ' open' : ''}`} width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 2L7 5L3.5 8" /></svg>
      </button>
      <div className={`tool-collapsible${expanded ? ' open' : ''}`}>
        <div className="tool-collapsible-inner">
          {hasBeenExpanded && (
            <div className="read-group-body">
              {files.map((file, i) => (
                <div key={i} className={`read-group-file${file.hasError ? ' read-group-file-error' : ''}`}>
                  <button className="read-group-file-row" onClick={() => toggleFile(i)}>
                    <svg className={`tool-chevron${expandedIdx.has(i) ? ' open' : ''}`} width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 0 }}><path d="M3.5 2L7 5L3.5 8" /></svg>
                    <span className="read-group-file-path" title={file.filePath}>{file.shortPath}</span>
                    {file.hasError && <span className="read-group-file-error-dot" />}
                    {projectPath && file.filePath && (
                      <span className="file-edit-action" title="Open in Editor" onClick={(e) => handleOpenInEditor(e, file.filePath)}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                          <polyline points="15 3 21 3 21 9"/>
                          <line x1="10" y1="14" x2="21" y2="3"/>
                        </svg>
                      </span>
                    )}
                  </button>
                  <div className={`tool-collapsible${expandedIdx.has(i) ? ' open' : ''}`}>
                    <div className="tool-collapsible-inner">
                      {everExpandedIdx.has(i) && file.preview && (
                        <div className="read-group-file-result">
                          <pre>{file.preview}</pre>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
