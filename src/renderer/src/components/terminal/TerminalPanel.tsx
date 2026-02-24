import React, { useCallback, useRef } from 'react'
import { useTerminalStore } from '../../stores/terminalStore'
import { useProjectStore } from '../../stores/projectStore'
import TerminalTabs from './TerminalTabs'
import TerminalView from './TerminalView'

export default function TerminalPanel() {
  const terminals = useTerminalStore(s => s.terminals)
  const activeTerminalId = useTerminalStore(s => s.activeTerminalId)
  const panelHeight = useTerminalStore(s => s.panelHeight)
  const setPanelHeight = useTerminalStore(s => s.setPanelHeight)
  const currentPath = useProjectStore(s => s.currentPath)
  const shellSplitIds = useTerminalStore(s => s.shellSplitIds)
  const splitRatio = useTerminalStore(s => s.splitRatio)
  const setSplitRatio = useTerminalStore(s => s.setSplitRatio)
  const isShellSplit = shellSplitIds.length === 2

  const dragging = useRef(false)
  const startY = useRef(0)
  const startHeight = useRef(0)
  const splitContainerRef = useRef<HTMLDivElement>(null)

  const onResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      dragging.current = true
      startY.current = e.clientY
      startHeight.current = panelHeight
      document.body.style.cursor = 'row-resize'
      document.body.style.userSelect = 'none'

      const onMouseMove = (ev: MouseEvent) => {
        if (!dragging.current) return
        const delta = startY.current - ev.clientY
        setPanelHeight(startHeight.current + delta)
      }

      const onMouseUp = () => {
        dragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }

      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
    },
    [panelHeight, setPanelHeight]
  )

  const onSplitDividerMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const container = splitContainerRef.current
      if (!container) return

      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const onMouseMove = (ev: MouseEvent) => {
        const rect = container.getBoundingClientRect()
        const x = ev.clientX - rect.left
        const ratio = x / rect.width
        setSplitRatio(ratio)
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
    [setSplitRatio]
  )

  return (
    <div className="terminal-panel" style={{ height: panelHeight }}>
      <div className="terminal-resize-handle" onMouseDown={onResizeMouseDown} />
      <TerminalTabs />
      <div className="terminal-views">
        {isShellSplit ? (
          <div className="terminal-split-container" ref={splitContainerRef}>
            <div className="terminal-split-pane" style={{ flex: `0 0 calc(${splitRatio * 100}% - 3px)` }}>
              <TerminalView
                key={shellSplitIds[0]}
                terminalId={shellSplitIds[0]}
                visible={true}
              />
            </div>
            <div
              className="terminal-split-divider"
              onMouseDown={onSplitDividerMouseDown}
            />
            <div className="terminal-split-pane" style={{ flex: 1 }}>
              <TerminalView
                key={shellSplitIds[1]}
                terminalId={shellSplitIds[1]}
                visible={true}
              />
            </div>
          </div>
        ) : (
          terminals.map(t => (
            <TerminalView
              key={t.id}
              terminalId={t.id}
              visible={t.id === activeTerminalId && t.projectPath === currentPath}
            />
          ))
        )}
      </div>
    </div>
  )
}
