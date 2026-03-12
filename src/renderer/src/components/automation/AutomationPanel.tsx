import React, { useState } from 'react'
import { useAutomationStore } from '../../stores/automationStore'
import AutomationList from './AutomationList'
import AutomationEditor from './AutomationEditor'
import { useUIStore } from '../../stores/uiStore'

export default function AutomationPanel() {
  const editorOpen = useAutomationStore(s => s.editorOpen)
  const setAutomationsOpen = useUIStore(s => s.setAutomationsOpen)
  const [search, setSearch] = useState('')

  return (
    <div className="automation-panel">
      <div className="automation-panel-header">
        <div className="automation-panel-header-left">
          <button
            className="automation-back-btn"
            onClick={() => setAutomationsOpen(false)}
            title="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </button>
          <h2>Automations</h2>
        </div>
        <div className="automation-panel-header-actions">
          <input
            className="settings-input automation-search-input"
            type="text"
            placeholder="Search automations..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="automation-panel-content">
        <AutomationList searchFilter={search} />
      </div>

      {editorOpen && <AutomationEditor />}
    </div>
  )
}
