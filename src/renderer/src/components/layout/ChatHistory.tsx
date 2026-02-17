import React from 'react'

interface HistoryEntry {
  id: string
  claudeSessionId?: string
  projectPath: string
  name: string
  createdAt: number
  endedAt: number
}

interface ChatHistoryProps {
  entries: HistoryEntry[]
  onResume: (entry: HistoryEntry) => void
  onClearHistory: () => void
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export default function ChatHistory({ entries, onResume, onClearHistory }: ChatHistoryProps) {
  if (entries.length === 0) return null

  return (
    <div className="chat-history-section">
      <div className="chat-history-header">
        <span className="chat-history-label">History</span>
        <button className="chat-history-clear" onClick={onClearHistory} title="Clear history">
          &times;
        </button>
      </div>
      {entries.slice().reverse().slice(0, 10).map(entry => (
        <button
          key={entry.id}
          className="chat-history-item"
          onClick={() => onResume(entry)}
          title={entry.claudeSessionId ? 'Click to resume' : 'No session ID — cannot resume'}
          disabled={!entry.claudeSessionId}
        >
          <span className="chat-history-item-name">{entry.name}</span>
          <span className="chat-history-item-time">{timeAgo(entry.endedAt)}</span>
        </button>
      ))}
    </div>
  )
}
