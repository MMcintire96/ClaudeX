import type { UIMessage, UIToolUseMessage, UIToolResultMessage } from '@shared/sessionEvents'

interface Props {
  message: UIMessage
  streaming?: boolean
}

export function MessageBubble({ message, streaming }: Props): JSX.Element | null {
  if (message.type === 'text') {
    return (
      <div className={'bubble ' + (message.role === 'user' ? 'user' : 'assistant') + (streaming ? ' streaming' : '')}>
        <div className="bubble-content">{message.content}</div>
      </div>
    )
  }
  if (message.type === 'tool_use') {
    const tu = message as UIToolUseMessage
    const summary = summarizeToolUse(tu)
    return (
      <div className="tool-use">
        <span className="tool-name">{tu.toolName}</span>
        {summary && <span className="tool-summary"> {summary}</span>}
      </div>
    )
  }
  if (message.type === 'tool_result') {
    const tr = message as UIToolResultMessage
    return (
      <div className={'tool-result' + (tr.isError ? ' error' : '')}>
        <pre>{trim(tr.content, 400)}</pre>
      </div>
    )
  }
  if (message.type === 'thinking') {
    return (
      <div className="thinking">
        <div className="thinking-label">thought</div>
        <div className="thinking-text">{trim(message.content, 600)}</div>
      </div>
    )
  }
  if (message.type === 'system') {
    return <div className="system">{message.content}</div>
  }
  return null
}

function summarizeToolUse(tu: UIToolUseMessage): string {
  const i = tu.input as Record<string, unknown>
  if (typeof i.file_path === 'string') return i.file_path as string
  if (typeof i.command === 'string') return (i.command as string).slice(0, 80)
  if (typeof i.path === 'string') return i.path as string
  if (typeof i.url === 'string') return i.url as string
  return ''
}

function trim(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, n) + '…'
}
