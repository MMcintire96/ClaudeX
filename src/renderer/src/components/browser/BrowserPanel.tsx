import React, { useState, useEffect, useCallback, useRef } from 'react'
import { useUIStore } from '../../stores/uiStore'
import BrowserToolbar from './BrowserToolbar'

interface TabInfo {
  id: string
  url: string
  title: string
}

interface BrowserPanelProps {
  projectPath: string
}

export default function BrowserPanel({ projectPath }: BrowserPanelProps) {
  const [url, setUrl] = useState('')
  const [tabs, setTabs] = useState<TabInfo[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
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

  // Listen for tab updates from main process
  useEffect(() => {
    const unsub = window.api.browser.onTabsUpdated((newTabs, newActiveId) => {
      setTabs(newTabs)
      setActiveTabId(newActiveId)
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
    return () => {
      window.api.browser.hide()
    }
  }, [isVisible])

  // When project changes, switch to that project's browser, then navigate to pending URL if any
  useEffect(() => {
    if (projectPath) {
      window.api.browser.switchProject(projectPath).then((result) => {
        setUrl(result.url || '')
        setTabs(result.tabs || [])
        setActiveTabId(result.activeTabId)

        // Check for a pending URL (e.g. from Start Button)
        const pendingUrl = useUIStore.getState().pendingBrowserUrl
        if (pendingUrl) {
          useUIStore.getState().setPendingBrowserUrl(null)
          // Delay to let dev servers start up
          setTimeout(() => {
            setUrl(pendingUrl)
            window.api.browser.navigate(pendingUrl)
          }, 2000)
        }
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
    sendBounds()
    return () => observer.disconnect()
  }, [])

  const handleNavigate = useCallback((navUrl: string) => {
    setUrl(navUrl)
    window.api.browser.navigate(navUrl)
  }, [])

  const handleBack = useCallback(() => { window.api.browser.back() }, [])
  const handleForward = useCallback(() => { window.api.browser.forward() }, [])
  const handleReload = useCallback(() => { window.api.browser.reload() }, [])
  const handleInspect = useCallback(() => { window.api.browser.openDevTools() }, [])

  const handleNewTab = useCallback(() => {
    window.api.browser.newTab()
  }, [])

  const handleSwitchTab = useCallback((tabId: string) => {
    window.api.browser.switchTab(tabId)
  }, [])

  const handleCloseTab = useCallback((tabId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    window.api.browser.closeTab(tabId)
  }, [])

  return (
    <div className="browser-panel">
      {tabs.length > 0 && (
        <div className="browser-tab-bar">
          <div className="browser-tabs-scroll">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`browser-tab ${tab.id === activeTabId ? 'active' : ''}`}
                onClick={() => handleSwitchTab(tab.id)}
                title={tab.url}
              >
                <span className="browser-tab-title">
                  {tab.title || tab.url || 'New Tab'}
                </span>
                <span
                  className="browser-tab-close"
                  onClick={(e) => handleCloseTab(tab.id, e)}
                >
                  &times;
                </span>
              </button>
            ))}
          </div>
          <button
            className="browser-tab-new"
            onClick={handleNewTab}
            title="New tab"
          >
            +
          </button>
        </div>
      )}
      <BrowserToolbar
        url={url}
        onNavigate={handleNavigate}
        onBack={handleBack}
        onForward={handleForward}
        onReload={handleReload}
        onInspect={handleInspect}
      />
      <div className="browser-viewport" ref={containerRef}>
        {!url && tabs.length === 0 && (
          <div className="browser-empty">
            Enter a URL above to browse
          </div>
        )}
      </div>
    </div>
  )
}
