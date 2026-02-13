import React, { useCallback, useRef } from 'react'
import { useUIStore } from '../../stores/uiStore'
import { useTerminalStore } from '../../stores/terminalStore'
import Sidebar from './Sidebar'
import MainPanel from './MainPanel'
import SidePanel from './SidePanel'
import TerminalPanel from '../terminal/TerminalPanel'

function ResizeHandle({
  side,
  onResize
}: {
  side: 'left' | 'right'
  onResize: (delta: number) => void
}) {
  const onResizeRef = useRef(onResize)
  onResizeRef.current = onResize

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      let lastX = e.clientX
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const onMouseMove = (ev: MouseEvent) => {
        const delta = ev.clientX - lastX
        lastX = ev.clientX
        onResizeRef.current(side === 'left' ? delta : -delta)
      }

      const onMouseUp = () => {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }

      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    },
    [side]
  )

  return (
    <div
      className={`resize-handle resize-handle-${side}`}
      onMouseDown={onMouseDown}
    />
  )
}

export default function AppLayout() {
  const sidebarVisible = useUIStore(s => s.sidebarVisible)
  const sidePanelView = useUIStore(s => s.sidePanelView)
  const sidebarWidth = useUIStore(s => s.sidebarWidth)
  const sidePanelWidth = useUIStore(s => s.sidePanelWidth)
  const setSidebarWidth = useUIStore(s => s.setSidebarWidth)
  const setSidePanelWidth = useUIStore(s => s.setSidePanelWidth)
  const terminalPanelVisible = useTerminalStore(s => s.panelVisible)
  const terminalCount = useTerminalStore(s => s.terminals.length)

  const handleSidebarResize = useCallback(
    (delta: number) => setSidebarWidth(sidebarWidth + delta),
    [sidebarWidth, setSidebarWidth]
  )

  const handleSidePanelResize = useCallback(
    (delta: number) => setSidePanelWidth(sidePanelWidth + delta),
    [sidePanelWidth, setSidePanelWidth]
  )

  const cols = [
    sidebarVisible ? `${sidebarWidth}px` : '0',
    '1fr',
    sidePanelView ? `${sidePanelWidth}px` : '0'
  ].join(' ')

  const showTerminal = terminalPanelVisible && terminalCount > 0

  return (
    <div className="app-layout">
      <div className="app-layout-top" style={{ gridTemplateColumns: cols }}>
        {sidebarVisible && (
          <div className="panel-wrapper">
            <Sidebar />
            <ResizeHandle side="left" onResize={handleSidebarResize} />
          </div>
        )}
        <MainPanel />
        {sidePanelView && (
          <div className="panel-wrapper">
            <ResizeHandle side="right" onResize={handleSidePanelResize} />
            <SidePanel />
          </div>
        )}
      </div>
      {showTerminal && <TerminalPanel />}
    </div>
  )
}
