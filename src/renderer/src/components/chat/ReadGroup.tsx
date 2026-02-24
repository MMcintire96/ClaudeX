import React, { useState, useMemo } from 'react'
import type { UIToolUseMessage, UIToolResultMessage } from '../../stores/sessionStore'

interface Props {
  toolUses: UIToolUseMessage[]
  results: (UIToolResultMessage | null)[]
}

function shortPath(filePath: string): string {
  const parts = filePath.split('/')
  if (parts.length <= 3) return filePath
  return '.../' + parts.slice(-2).join('/')
}

export default function ReadGroup({ toolUses, results }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [expandedIdx, setExpandedIdx] = useState<Set<number>>(new Set())

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
  }

  return (
    <div className="read-group">
      <button className="read-group-header" onClick={() => setExpanded(!expanded)}>
        <svg className="read-group-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
        <span className="read-group-summary">
          Read {files.length} files
        </span>
        {errorCount > 0 && (
          <span className="read-group-error-badge">{errorCount} error{errorCount !== 1 ? 's' : ''}</span>
        )}
        <span className="read-group-chevron">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="read-group-body">
          {files.map((file, i) => (
            <div key={i} className={`read-group-file${file.hasError ? ' read-group-file-error' : ''}`}>
              <button className="read-group-file-row" onClick={() => toggleFile(i)}>
                <span className="read-group-file-chevron">{expandedIdx.has(i) ? '▾' : '▸'}</span>
                <span className="read-group-file-path" title={file.filePath}>{file.shortPath}</span>
                {file.hasError && <span className="read-group-file-error-dot" />}
              </button>
              {expandedIdx.has(i) && file.preview && (
                <div className="read-group-file-result">
                  <pre>{file.preview}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
