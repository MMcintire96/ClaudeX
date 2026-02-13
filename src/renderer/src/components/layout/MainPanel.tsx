import React from 'react'
import ChatPanel from '../chat/ChatPanel'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'

export default function MainPanel() {
  const activeSessionId = useSessionStore(s => s.activeSessionId)
  const session = useSessionStore(s => activeSessionId ? s.sessions[activeSessionId] : null)
  const projectName = useProjectStore(s => s.currentName)

  return (
    <main className="main-panel">
      <div className="main-header">
        <span className="main-header-title">
          {projectName ?? 'New thread'}
        </span>
      </div>
      <ChatPanel sessionId={activeSessionId} />
    </main>
  )
}
