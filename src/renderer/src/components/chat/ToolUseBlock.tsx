import React, { useState } from 'react'
import type { UIToolUseMessage } from '../../stores/sessionStore'

interface Props {
  message: UIToolUseMessage
}

function formatInput(input: Record<string, unknown>): string {
  // Show key fields for common tools
  const { command, file_path, pattern, content, ...rest } = input
  const parts: string[] = []
  if (file_path) parts.push(`File: ${file_path}`)
  if (command) parts.push(`$ ${command}`)
  if (pattern) parts.push(`Pattern: ${pattern}`)

  if (parts.length === 0) {
    return JSON.stringify(input, null, 2)
  }
  return parts.join('\n')
}

export default function ToolUseBlock({ message }: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="tool-use-block">
      <button
        className="tool-use-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="tool-icon">&#9881;</span>
        <span className="tool-name">{message.toolName}</span>
        <span className="tool-expand">{expanded ? '▼' : '▶'}</span>
      </button>
      {expanded && (
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
  )
}
