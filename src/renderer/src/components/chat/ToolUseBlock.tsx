import React, { useState, useCallback, useEffect, useRef } from 'react'
import type { UIToolUseMessage } from '../../stores/sessionStore'
import { sendNotification } from '../../lib/notificationSound'

interface Props {
  message: UIToolUseMessage
  awaitingPermission?: boolean
  terminalId?: string
  isInProgress?: boolean
}

function formatInput(input: Record<string, unknown>): string {
  // Show key fields for common tools
  const { command, file_path, pattern } = input
  const parts: string[] = []
  if (file_path) parts.push(`File: ${file_path}`)
  if (command) parts.push(`$ ${command}`)
  if (pattern) parts.push(`Pattern: ${pattern}`)

  if (parts.length === 0) {
    return JSON.stringify(input, null, 2)
  }
  return parts.join('\n')
}

export default function ToolUseBlock({ message, awaitingPermission, terminalId, isInProgress }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [hasBeenExpanded, setHasBeenExpanded] = useState(false)
  const [responded, setResponded] = useState(false)

  const handleAllow = useCallback(async () => {
    if (!terminalId || responded) return
    setResponded(true)
    await window.api.terminal.write(terminalId, '\r')
  }, [terminalId, responded])

  const handleAllowAlways = useCallback(async () => {
    if (!terminalId || responded) return
    setResponded(true)
    // Down arrow to select "Yes, and don't ask again" option, then Enter
    await window.api.terminal.write(terminalId, '\x1b[B')
    await new Promise(r => setTimeout(r, 50))
    await window.api.terminal.write(terminalId, '\r')
  }, [terminalId, responded])

  const handleDeny = useCallback(async () => {
    if (!terminalId || responded) return
    setResponded(true)
    await window.api.terminal.write(terminalId, '\x1b')
  }, [terminalId, responded])

  const needsInput = awaitingPermission && !responded
  const notifiedRef = useRef(false)
  useEffect(() => {
    if (needsInput && !notifiedRef.current) {
      notifiedRef.current = true
      sendNotification('Claude needs your approval', `${message.toolName} requires permission`)
    }
  }, [needsInput])

  return (
    <div className={`tool-use-block${needsInput ? ' awaiting-permission' : ''}`}>
      {needsInput && <div className="needs-input-indicator" />}
      <button
        className="tool-use-header"
        onClick={() => { if (!expanded) setHasBeenExpanded(true); setExpanded(!expanded) }}
      >
        <span className="tool-icon">&#9881;</span>
        <span className="tool-name">{message.toolName}</span>
        {isInProgress ? (
          <span className="tool-spinner" />
        ) : (
          <svg className={`tool-chevron${expanded ? ' open' : ''}`} width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 2L7 5L3.5 8" /></svg>
        )}
      </button>
      <div className={`tool-collapsible${expanded ? ' open' : ''}`}>
        <div className="tool-collapsible-inner">
          {hasBeenExpanded && (
            <div className="tool-use-body">
              <pre className="tool-input">{formatInput(message.input)}</pre>
              {Object.keys(message.input).length > 3 && (
                <details className="tool-full-input">
                  <summary>Full input</summary>
                  <pre>{JSON.stringify(message.input, null, 2)}</pre>
                </details>
              )}
            </div>
          )}
        </div>
      </div>
      {awaitingPermission && !responded && (
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
