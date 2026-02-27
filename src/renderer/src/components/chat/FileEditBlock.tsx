import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import hljs from 'highlight.js/lib/core'
import typescript from 'highlight.js/lib/languages/typescript'
import javascript from 'highlight.js/lib/languages/javascript'
import python from 'highlight.js/lib/languages/python'
import css from 'highlight.js/lib/languages/css'
import json from 'highlight.js/lib/languages/json'
import bash from 'highlight.js/lib/languages/bash'
import xml from 'highlight.js/lib/languages/xml'
import markdown from 'highlight.js/lib/languages/markdown'
import { playNotificationSound } from '../../lib/notificationSound'
import rust from 'highlight.js/lib/languages/rust'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import yaml from 'highlight.js/lib/languages/yaml'
import sql from 'highlight.js/lib/languages/sql'
import type { UIToolUseMessage, UIToolResultMessage } from '../../stores/sessionStore'
import { useSettingsStore } from '../../stores/settingsStore'

// Register languages for syntax highlighting in diffs
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('python', python)
hljs.registerLanguage('css', css)
hljs.registerLanguage('json', json)
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('go', go)
hljs.registerLanguage('java', java)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('sql', sql)

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', css: 'css', json: 'json', sh: 'bash', bash: 'bash', zsh: 'bash',
  html: 'html', htm: 'html', xml: 'xml', svg: 'xml', md: 'markdown',
  rs: 'rust', go: 'go', java: 'java', yml: 'yaml', yaml: 'yaml', sql: 'sql',
}

function detectLanguage(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase()
  return ext ? EXT_TO_LANG[ext] ?? null : null
}

interface Props {
  message: UIToolUseMessage
  result?: UIToolResultMessage | null
  awaitingPermission?: boolean
  terminalId?: string
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

function DiffView({ oldString, newString, filePath }: { oldString: string; newString: string; filePath: string }) {
  const highlighted = useMemo(() => {
    const lang = detectLanguage(filePath)
    const highlightLine = (line: string): string => {
      if (!lang) return escapeHtml(line)
      try {
        return hljs.highlight(line, { language: lang, ignoreIllegals: true }).value
      } catch {
        return escapeHtml(line)
      }
    }
    return {
      oldLines: oldString ? oldString.split('\n').map(highlightLine) : [],
      newLines: newString ? newString.split('\n').map(highlightLine) : [],
    }
  }, [oldString, newString, filePath])

  return (
    <div className="file-edit-diff">
      {highlighted.oldLines.length > 0 && (
        <div className="diff-removed">
          {highlighted.oldLines.map((html, i) => (
            <div key={`old-${i}`} className="diff-line diff-line-removed">
              <span className="diff-sign">-</span>
              <span dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          ))}
        </div>
      )}
      {highlighted.newLines.length > 0 && (
        <div className="diff-added">
          {highlighted.newLines.map((html, i) => (
            <div key={`new-${i}`} className="diff-line diff-line-added">
              <span className="diff-sign">+</span>
              <span dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export default function FileEditBlock({ message, result, awaitingPermission, terminalId }: Props) {
  const autoExpand = useSettingsStore(s => s.autoExpandEdits)
  const isEditTool = message.toolName === 'Edit' || message.toolName === 'Write'
  const [expanded, setExpanded] = useState(autoExpand && isEditTool)
  const [permissionResponded, setPermissionResponded] = useState(false)

  const handleAllow = useCallback(async () => {
    if (!terminalId || permissionResponded) return
    setPermissionResponded(true)
    // Option 1: Yes
    await window.api.terminal.write(terminalId, '\r')
  }, [terminalId, permissionResponded])

  const handleAllowAlways = useCallback(async () => {
    if (!terminalId || permissionResponded) return
    setPermissionResponded(true)
    // Down arrow to select "Yes, and don't ask again" option, then Enter
    await window.api.terminal.write(terminalId, '\x1b[B')
    await new Promise(r => setTimeout(r, 50))
    await window.api.terminal.write(terminalId, '\r')
  }, [terminalId, permissionResponded])

  const handleDeny = useCallback(async () => {
    if (!terminalId || permissionResponded) return
    setPermissionResponded(true)
    await window.api.terminal.write(terminalId, '\x1b')
  }, [terminalId, permissionResponded])
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

  const needsInput = awaitingPermission && !permissionResponded
  const notifiedRef = useRef(false)
  useEffect(() => {
    if (needsInput && !notifiedRef.current) {
      notifiedRef.current = true
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Claude needs your approval', {
          body: `${message.toolName} ${filePath ? shortPath(filePath) : ''} requires permission`,
          silent: false
        })
      } else if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission()
      }
      playNotificationSound()
    }
  }, [needsInput])

  return (
    <div className={`file-edit-block ${hasError ? 'file-edit-error' : ''}${needsInput ? ' awaiting-permission' : ''}`}>
      {needsInput && <div className="needs-input-indicator" />}
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
          {/* Edit: show diff with syntax highlighting */}
          {message.toolName === 'Edit' && oldString != null && newString != null && (
            <DiffView oldString={oldString} newString={newString} filePath={filePath} />
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
      {awaitingPermission && !permissionResponded && (
        <div className="permission-request-inline">
          <span className="permission-request-label">This action requires approval</span>
          <div className="permission-request-actions">
            <button className="btn btn-sm btn-deny" onClick={handleDeny}>Deny</button>
            <button className="btn btn-sm btn-allow-always" onClick={handleAllowAlways}>Allow always</button>
            <button className="btn btn-sm btn-allow" onClick={handleAllow}>Allow</button>
          </div>
        </div>
      )}
    </div>
  )
}
