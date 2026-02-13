import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useUIStore } from '../../stores/uiStore'
import BrowserToolbar from './BrowserToolbar'

interface BrowserPanelProps {
  projectPath: string
}

export default function BrowserPanel({ projectPath }: BrowserPanelProps) {
  const [url, setUrl] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const sidePanelView = useUIStore(s => s.sidePanelView)
  const isVisible = sidePanelView?.type === 'browser' && sidePanelView?.projectPath === projectPath

  // Listen for URL changes from main process
  useEffect(() => {
    const unsub = window.api.browser.onUrlChanged((newUrl: string) => {
      setUrl(newUrl)
    })
    return unsub
  }, [])

  // Show/hide the native WebContentsView based on tab visibility
  useEffect(() => {
    if (isVisible) {
      window.api.browser.show()
    } else {
      window.api.browser.hide()
    }
  }, [isVisible])

  // When project changes, switch to that project's browser
  useEffect(() => {
    if (projectPath) {
      window.api.browser.switchProject(projectPath).then((currentUrl) => {
        setUrl(currentUrl || '')
      })
    }
  }, [projectPath])

  // Sync bounds of the placeholder div to main process WebContentsView
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const sendBounds = (): void => {
      const rect = el.getBoundingClientRect()
      window.api.browser.setBounds({
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      })
    }

    const observer = new ResizeObserver(sendBounds)
    observer.observe(el)
    // Also send on mount
    sendBounds()
    return () => observer.disconnect()
  }, [])

  const handleNavigate = useCallback((navUrl: string) => {
    setUrl(navUrl)
    window.api.browser.navigate(navUrl)
  }, [])

  const handleBack = useCallback(() => {
    window.api.browser.back()
  }, [])

  const handleForward = useCallback(() => {
    window.api.browser.forward()
  }, [])

  const handleReload = useCallback(() => {
    window.api.browser.reload()
  }, [])

  return (
    <div className="browser-panel">
      <BrowserToolbar
        url={url}
        onNavigate={handleNavigate}
        onBack={handleBack}
        onForward={handleForward}
        onReload={handleReload}
      />
      <div className="browser-viewport" ref={containerRef}>
        {!url && (
          <div className="browser-empty">
            Enter a URL above to browse
          </div>
        )}
      </div>
    </div>
  )
}
