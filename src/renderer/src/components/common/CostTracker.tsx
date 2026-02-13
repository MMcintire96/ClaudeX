import React from 'react'
import { useSessionStore } from '../../stores/sessionStore'

export default function CostTracker() {
  const activeSessionId = useSessionStore(s => s.activeSessionId)
  const session = useSessionStore(s =>
    activeSessionId ? s.sessions[activeSessionId] : null
  )

  const costUsd = session?.costUsd ?? 0
  const totalCostUsd = session?.totalCostUsd ?? 0

  if (totalCostUsd === 0 && costUsd === 0) return null

  return (
    <div className="cost-tracker">
      {costUsd > 0 && (
        <div className="meta-item">
          Turn cost: ${costUsd.toFixed(4)}
        </div>
      )}
      {totalCostUsd > 0 && (
        <div className="meta-item">
          Session cost: ${totalCostUsd.toFixed(4)}
        </div>
      )}
    </div>
  )
}
