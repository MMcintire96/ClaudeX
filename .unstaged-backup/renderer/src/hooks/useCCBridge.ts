import { useEffect } from 'react'
import { useSessionStore } from '../stores/sessionStore'

/**
 * Subscribes to CC session events from the main process and routes them
 * into the session store so Chat view mirrors CC terminal output.
 */
export function useCCBridge(): void {
  useEffect(() => {
    const unsub = window.api.cc.onSessionEvent((data) => {
      useSessionStore.getState().injectCCEvent(data.sessionId, data.event)
    })
    return unsub
  }, [])
}
