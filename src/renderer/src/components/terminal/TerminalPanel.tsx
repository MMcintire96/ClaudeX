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

  const dragging = useRef(false)
  const startY = useRef(0)
  const startHeight = useRef(0)

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

  return (
    <div className="terminal-panel" style={{ height: panelHeight }}>
      <div className="terminal-resize-handle" onMouseDown={onResizeMouseDown} />
      <TerminalTabs />
      <div className="terminal-views">
        {terminals.filter(t => t.type !== 'claude').map(t => (
          <TerminalView
            key={t.id}
            terminalId={t.id}
            visible={t.id === activeTerminalId && t.projectPath === currentPath}
          />
        ))}
      </div>
    </div>
  )
}
