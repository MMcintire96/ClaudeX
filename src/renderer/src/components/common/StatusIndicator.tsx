import React from 'react'

interface Props {
  isRunning: boolean
}

export default function StatusIndicator({ isRunning }: Props) {
  return (
    <div className="sidebar-agent-status">
      <span className={`status-dot ${isRunning ? 'status-active' : 'status-idle'}`} />
      <span>{isRunning ? 'Running' : 'Idle'}</span>
    </div>
  )
}
