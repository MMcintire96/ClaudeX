import React, { useState, useMemo } from 'react'
import type { UIToolUseMessage, UIToolResultMessage } from '../../stores/sessionStore'

interface Props {
  message: UIToolUseMessage
  result?: UIToolResultMessage | null
}

// Tool icons as simple SVG components
function iconForTool(name: string): React.ReactNode {
  switch (name) {
    case 'Edit':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      )
    case 'Write':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
      )
    case 'Read':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      )
    case 'Bash':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5"/>
          <line x1="12" y1="19" x2="20" y2="19"/>
        </svg>
      )
    case 'Grep':
    case 'Glob':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/>
          <line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
      )
    default:
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      )
  }
}

function shortPath(filePath: string): string {
  const parts = filePath.split('/')
  if (parts.length <= 3) return filePath
  return '.../' + parts.slice(-2).join('/')
}

function labelForTool(name: string): string {
  switch (name) {
    case 'Edit': return 'Edited'
    case 'Write': return 'Created'
    case 'Read': return 'Read'
    case 'Bash': return 'Ran command'
    case 'Grep': return 'Searched'
    case 'Glob': return 'Found files'
    default: return name
  }
}

const FILE_TOOLS = new Set(['Edit', 'Write', 'Read', 'Bash', 'Grep', 'Glob', 'NotebookEdit'])

export function isFileEditTool(toolName: string): boolean {
  return FILE_TOOLS.has(toolName)
}

export default function FileEditBlock({ message, result }: Props) {
  const [expanded, setExpanded] = useState(false)
  const input = message.input

  const filePath = (input.file_path || input.path || '') as string
  const command = input.command as string | undefined
  const oldString = input.old_string as string | undefined
  const newString = input.new_string as string | undefined
  const pattern = input.pattern as string | undefined
  const content = input.content as string | undefined

  const label = labelForTool(message.toolName)
  const displayPath = filePath ? shortPath(filePath) : ''
  const fullPath = filePath

  const hasError = result?.isError || false

  // Build a summary line
  const summary = useMemo(() => {
    if (message.toolName === 'Bash' && command) {
      // Truncate long commands
      const cmd = command.length > 80 ? command.slice(0, 77) + '...' : command
      return cmd
    }
    if (message.toolName === 'Grep' && pattern) {
      return `/${pattern}/`
    }
    if (message.toolName === 'Glob' && pattern) {
      return pattern
    }
    return null
  }, [message.toolName, command, pattern])

  // Parse result content for line count
  const resultPreview = useMemo(() => {
    if (!result?.content) return null
    const lines = result.content.split('\n')
    if (lines.length <= 8) return result.content
    return lines.slice(0, 6).join('\n') + `\n... (${lines.length} lines total)`
  }, [result])

  return (
    <div className={`file-edit-block ${hasError ? 'file-edit-error' : ''}`}>
      <button
        className="file-edit-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="file-edit-icon">{iconForTool(message.toolName)}</span>
        <span className="file-edit-label">{label}</span>
        {displayPath && (
          <span className="file-edit-path" title={fullPath}>{displayPath}</span>
        )}
        {summary && !displayPath && (
          <span className="file-edit-summary">{summary}</span>
        )}
        {hasError && <span className="file-edit-error-badge">error</span>}
        <span className="file-edit-chevron">{expanded ? '▾' : '▸'}</span>
      </button>

      {/* Inline summary when Bash — show command below header */}
      {message.toolName === 'Bash' && summary && displayPath && !expanded && (
        <div className="file-edit-command-preview">
          <code>$ {summary}</code>
        </div>
      )}

      {expanded && (
        <div className="file-edit-body">
          {/* Edit: show diff */}
          {message.toolName === 'Edit' && oldString != null && newString != null && (
            <div className="file-edit-diff">
              {oldString && (
                <div className="diff-removed">
                  {oldString.split('\n').map((line, i) => (
                    <div key={`old-${i}`} className="diff-line diff-line-removed">
                      <span className="diff-sign">-</span>
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              )}
              {newString && (
                <div className="diff-added">
                  {newString.split('\n').map((line, i) => (
                    <div key={`new-${i}`} className="diff-line diff-line-added">
                      <span className="diff-sign">+</span>
                      <span>{line}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Write: show content preview */}
          {message.toolName === 'Write' && content && (
            <div className="file-edit-content-preview">
              <pre>{content.length > 500 ? content.slice(0, 500) + '\n...' : content}</pre>
            </div>
          )}

          {/* Bash: show command */}
          {message.toolName === 'Bash' && command && (
            <div className="file-edit-command">
              <pre>$ {command}</pre>
            </div>
          )}

          {/* Grep/Glob: show pattern + path */}
          {(message.toolName === 'Grep' || message.toolName === 'Glob') && (
            <div className="file-edit-search-info">
              {pattern && <div><strong>Pattern:</strong> <code>{pattern}</code></div>}
              {filePath && <div><strong>Path:</strong> <code>{filePath}</code></div>}
            </div>
          )}

          {/* Result output */}
          {resultPreview && (
            <div className={`file-edit-result ${hasError ? 'file-edit-result-error' : ''}`}>
              <pre>{resultPreview}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
