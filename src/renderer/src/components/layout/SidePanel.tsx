import React from 'react'
import { useUIStore } from '../../stores/uiStore'
import DiffPanel from '../diff/DiffPanel'
import BrowserPanel from '../browser/BrowserPanel'

export default function SidePanel() {
  const sidePanelView = useUIStore(s => s.sidePanelView)
  const viewType = sidePanelView?.type ?? null
  const projectPath = sidePanelView?.projectPath ?? null

  return (
    <aside className="side-panel">
      <div style={{ display: viewType === 'diff' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
        {projectPath && <DiffPanel projectPath={projectPath} />}
      </div>
      <div style={{ display: viewType === 'browser' ? 'flex' : 'none', flexDirection: 'column', height: '100%' }}>
        {projectPath && <BrowserPanel projectPath={projectPath} />}
      </div>
    </aside>
  )
}
