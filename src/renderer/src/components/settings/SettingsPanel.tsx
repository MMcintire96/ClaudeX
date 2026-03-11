import React, { useState, useCallback } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import { useProjectStore } from '../../stores/projectStore'
import { THEME_META } from '../../lib/themes'
import type { ThemeName } from '../../lib/themes'
import { AVAILABLE_MODELS } from '../../constants/models'
import type { EffortLevel } from '../../constants/models'
import MCPConfigPanel from './MCPConfigPanel'

const MOD_KEY_LABELS: Record<string, string> = {
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Meta: 'Meta',
  Shift: 'Shift'
}

const FONT_FAMILIES: { id: string; label: string; value: string }[] = [
  { id: 'system', label: 'System Default', value: 'system-ui, -apple-system, sans-serif' },
  { id: 'mono', label: 'Monospace', value: "'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace" },
  { id: 'inter', label: 'Inter', value: "'Inter', system-ui, sans-serif" },
  { id: 'fira-code', label: 'Fira Code', value: "'Fira Code', monospace" },
  { id: 'jetbrains', label: 'JetBrains Mono', value: "'JetBrains Mono', monospace" },
  { id: 'cascadia', label: 'Cascadia Code', value: "'Cascadia Code', monospace" },
]

const EFFORT_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  max: 'Max',
}

type SettingsTab = 'general' | 'mcp'

export default function SettingsPanel() {
  const {
    claude, modKey, vimMode, autoExpandEdits, notificationSounds, vimChatMode,
    preventSleep, suggestNextMessage, sideBySideDiffs,
    defaultModel, defaultEffort, fontSize, fontFamily, lineHeight,
    showTimestamps, compactMessages,
    updateSettings
  } = useSettingsStore()
  const { theme, setTheme, chatZoom, setChatZoom } = useUIStore()
  const setSettingsOpen = useUIStore(s => s.setSettingsOpen)
  const currentPath = useProjectStore(s => s.currentPath)
  const [capturing, setCapturing] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)
  const [clearingProject, setClearingProject] = useState(false)
  const [cleared, setCleared] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<SettingsTab>('general')

  const currentMeta = THEME_META.find(m => m.id === theme)

  const handleClearAllSessions = useCallback(async () => {
    setClearingAll(true)
    await window.api.session.clearHistory()
    setClearingAll(false)
    setCleared('all')
    setTimeout(() => setCleared(null), 2000)
  }, [])

  const handleClearProjectSessions = useCallback(async () => {
    if (!currentPath) return
    setClearingProject(true)
    await window.api.session.clearHistory(currentPath)
    setClearingProject(false)
    setCleared('project')
    setTimeout(() => setCleared(null), 2000)
  }, [currentPath])

  return (
    <div className="settings-page">
      <div className="settings-page-scroll">
        <div className="settings-page-inner">
          {/* Header */}
          <div className="settings-page-header">
            <h1 className="settings-page-title">Settings</h1>
            <p className="settings-page-subtitle">Configure app-level preferences for this device.</p>
          </div>

          {/* Tab navigation */}
          <div className="settings-tabs">
            <button
              className={`settings-tab${activeTab === 'general' ? ' active' : ''}`}
              onClick={() => setActiveTab('general')}
            >
              General
            </button>
            <button
              className={`settings-tab${activeTab === 'mcp' ? ' active' : ''}`}
              onClick={() => setActiveTab('mcp')}
            >
              MCP Servers
            </button>
          </div>

          {activeTab === 'mcp' ? (
            <MCPConfigPanel />
          ) : (
            <>
              {/* Models */}
              <div className="settings-card">
                <div className="settings-card-header">
                  <h2 className="settings-card-title">Models</h2>
                  <p className="settings-card-description">Default model and reasoning for new sessions.</p>
                </div>
                <div className="settings-card-body">
                  <div className="settings-field">
                    <label className="settings-field-label">Default model</label>
                    <select
                      className="settings-select"
                      value={defaultModel}
                      onChange={(e) => updateSettings({ defaultModel: e.target.value })}
                    >
                      {AVAILABLE_MODELS.map(m => (
                        <option key={m.id} value={m.id}>{m.label} ({m.provider})</option>
                      ))}
                    </select>
                    <span className="settings-field-hint">New sessions will start with this model.</span>
                  </div>
                  <div className="settings-field">
                    <label className="settings-field-label">Default reasoning level</label>
                    <div className="settings-effort-picker">
                      {(['low', 'medium', 'high'] as EffortLevel[]).map(level => (
                        <button
                          key={level}
                          className={`settings-effort-option${defaultEffort === level ? ' active' : ''}`}
                          onClick={() => updateSettings({ defaultEffort: level })}
                        >
                          {EFFORT_LABELS[level]}
                        </button>
                      ))}
                    </div>
                    <span className="settings-field-hint">Controls how much thinking the model does before responding.</span>
                  </div>
                </div>
              </div>

              {/* Appearance */}
              <div className="settings-card">
                <div className="settings-card-header">
                  <h2 className="settings-card-title">Appearance</h2>
                  <p className="settings-card-description">Choose how ClaudeX handles light and dark mode.</p>
                </div>
                <div className="settings-card-body">
                  <div className="settings-field">
                    <label className="settings-field-label">Color scheme</label>
                    <select
                      className="settings-select"
                      value={theme}
                      onChange={(e) => setTheme(e.target.value as ThemeName)}
                      style={{ borderLeft: `3px solid ${currentMeta?.previewColors.accent ?? '#fff'}` }}
                    >
                      {THEME_META.map(m => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                    <span className="settings-field-hint">
                      Active theme: <strong>{currentMeta?.label}</strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* Font & Typography */}
              <div className="settings-card">
                <div className="settings-card-header">
                  <h2 className="settings-card-title">Font</h2>
                  <p className="settings-card-description">Adjust typography and text rendering in the chat.</p>
                </div>
                <div className="settings-card-body">
                  <div className="settings-field">
                    <label className="settings-field-label">Font family</label>
                    <select
                      className="settings-select"
                      value={fontFamily}
                      onChange={(e) => updateSettings({ fontFamily: e.target.value })}
                    >
                      {FONT_FAMILIES.map(f => (
                        <option key={f.id} value={f.id}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="settings-field">
                    <label className="settings-field-label">Font size</label>
                    <div className="settings-range-row">
                      <input
                        type="range"
                        className="settings-range"
                        min={11}
                        max={20}
                        step={1}
                        value={fontSize}
                        onChange={(e) => updateSettings({ fontSize: parseInt(e.target.value, 10) })}
                      />
                      <span className="settings-range-value">{fontSize}px</span>
                    </div>
                  </div>
                  <div className="settings-field">
                    <label className="settings-field-label">Line height</label>
                    <div className="settings-range-row">
                      <input
                        type="range"
                        className="settings-range"
                        min={1.2}
                        max={2.0}
                        step={0.1}
                        value={lineHeight}
                        onChange={(e) => updateSettings({ lineHeight: parseFloat(e.target.value) })}
                      />
                      <span className="settings-range-value">{lineHeight.toFixed(1)}</span>
                    </div>
                  </div>
                  <div className="settings-field">
                    <label className="settings-field-label">Chat zoom</label>
                    <div className="settings-range-row">
                      <input
                        type="range"
                        className="settings-range"
                        min={0.5}
                        max={2.0}
                        step={0.1}
                        value={chatZoom}
                        onChange={(e) => setChatZoom(parseFloat(e.target.value))}
                      />
                      <span className="settings-range-value">{Math.round(chatZoom * 100)}%</span>
                    </div>
                    <span className="settings-field-hint">Zoom level of the entire chat area.</span>
                  </div>
                </div>
              </div>

              {/* Display */}
              <div className="settings-card">
                <div className="settings-card-header">
                  <h2 className="settings-card-title">Display</h2>
                  <p className="settings-card-description">Control how content is presented in the chat.</p>
                </div>
                <div className="settings-card-body">
                  <div className="settings-row">
                    <div className="settings-label">
                      <span>Auto expand edits</span>
                      <span className="settings-description">Expand file edit blocks in chat automatically</span>
                    </div>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={autoExpandEdits}
                        onChange={(e) => updateSettings({ autoExpandEdits: e.target.checked })}
                      />
                      <span className="settings-toggle-slider" />
                    </label>
                  </div>
                  <div className="settings-row">
                    <div className="settings-label">
                      <span>Side-by-side diffs</span>
                      <span className="settings-description">Show old and new code side by side in edit blocks</span>
                    </div>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={sideBySideDiffs}
                        onChange={(e) => updateSettings({ sideBySideDiffs: e.target.checked })}
                      />
                      <span className="settings-toggle-slider" />
                    </label>
                  </div>
                  <div className="settings-row">
                    <div className="settings-label">
                      <span>Show timestamps</span>
                      <span className="settings-description">Display timestamps on messages</span>
                    </div>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={showTimestamps}
                        onChange={(e) => updateSettings({ showTimestamps: e.target.checked })}
                      />
                      <span className="settings-toggle-slider" />
                    </label>
                  </div>
                  <div className="settings-row">
                    <div className="settings-label">
                      <span>Compact messages</span>
                      <span className="settings-description">Reduce spacing between messages for a denser view</span>
                    </div>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={compactMessages}
                        onChange={(e) => updateSettings({ compactMessages: e.target.checked })}
                      />
                      <span className="settings-toggle-slider" />
                    </label>
                  </div>
                  <div className="settings-row">
                    <div className="settings-label">
                      <span>Notification sounds</span>
                      <span className="settings-description">Play a sound when Claude finishes working</span>
                    </div>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={notificationSounds}
                        onChange={(e) => updateSettings({ notificationSounds: e.target.checked })}
                      />
                      <span className="settings-toggle-slider" />
                    </label>
                  </div>
                  <div className="settings-row">
                    <div className="settings-label">
                      <span>Prevent sleep</span>
                      <span className="settings-description">Keep machine awake while Claude is working</span>
                    </div>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={preventSleep}
                        onChange={(e) => updateSettings({ preventSleep: e.target.checked })}
                      />
                      <span className="settings-toggle-slider" />
                    </label>
                  </div>
                </div>
              </div>

              {/* Input */}
              <div className="settings-card">
                <div className="settings-card-header">
                  <h2 className="settings-card-title">Input</h2>
                  <p className="settings-card-description">Configure keyboard and input behavior.</p>
                </div>
                <div className="settings-card-body">
                  <div className="settings-field">
                    <label className="settings-field-label">Hotkey modifier</label>
                    <button
                      className={`settings-input-btn${capturing ? ' capturing' : ''}`}
                      onClick={() => setCapturing(true)}
                      onBlur={() => setCapturing(false)}
                      onKeyDown={(e) => {
                        if (!capturing) return
                        e.preventDefault()
                        e.stopPropagation()
                        if (e.key === 'Escape') {
                          setCapturing(false)
                          return
                        }
                        let key = e.key
                        if (key === 'Control') key = 'Ctrl'
                        updateSettings({ modKey: key })
                        setCapturing(false)
                      }}
                    >
                      {capturing ? 'Press any key...' : (MOD_KEY_LABELS[modKey] || modKey)}
                    </button>
                    <span className="settings-field-hint">Modifier key used for keyboard shortcuts</span>
                  </div>
                  <div className="settings-row">
                    <div className="settings-label">
                      <span>Vim mode</span>
                      <span className="settings-description">Send ESC then i before input</span>
                    </div>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={vimMode}
                        onChange={(e) => updateSettings({ vimMode: e.target.checked })}
                      />
                      <span className="settings-toggle-slider" />
                    </label>
                  </div>
                  <div className="settings-row">
                    <div className="settings-label">
                      <span>Vim chat input</span>
                      <span className="settings-description">Vim keybindings in the chat textarea</span>
                    </div>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={vimChatMode}
                        onChange={(e) => updateSettings({ vimChatMode: e.target.checked })}
                      />
                      <span className="settings-toggle-slider" />
                    </label>
                  </div>
                </div>
              </div>

              {/* Claude */}
              <div className="settings-card">
                <div className="settings-card-header">
                  <h2 className="settings-card-title">Claude</h2>
                  <p className="settings-card-description">Agent behavior and permission settings.</p>
                </div>
                <div className="settings-card-body">
                  <div className="settings-row">
                    <div className="settings-label">
                      <span>Suggest next message</span>
                      <span className="settings-description">Predict your next message when Claude finishes</span>
                    </div>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={suggestNextMessage}
                        onChange={(e) => updateSettings({ suggestNextMessage: e.target.checked })}
                      />
                      <span className="settings-toggle-slider" />
                    </label>
                  </div>
                  <div className="settings-row">
                    <div className="settings-label">
                      <span>Skip permissions</span>
                      <span className="settings-description">Use --dangerously-skip-permissions</span>
                    </div>
                    <label className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={claude.dangerouslySkipPermissions}
                        onChange={(e) => updateSettings({ claude: { dangerouslySkipPermissions: e.target.checked } })}
                      />
                      <span className="settings-toggle-slider" />
                    </label>
                  </div>
                </div>
              </div>

              {/* Data */}
              <div className="settings-card">
                <div className="settings-card-header">
                  <h2 className="settings-card-title">Data</h2>
                  <p className="settings-card-description">Manage session history and stored data.</p>
                </div>
                <div className="settings-card-body">
                  <div className="settings-row">
                    <div className="settings-label">
                      <span>Clear session history</span>
                      <span className="settings-description">
                        {cleared === 'all' ? 'All sessions cleared' : cleared === 'project' ? 'Project sessions cleared' : 'Remove past thread history'}
                      </span>
                    </div>
                    <div className="settings-actions-group">
                      {currentPath && (
                        <button
                          className="settings-btn"
                          onClick={handleClearProjectSessions}
                          disabled={clearingProject}
                        >
                          {clearingProject ? '...' : 'Project'}
                        </button>
                      )}
                      <button
                        className="settings-btn settings-btn-danger"
                        onClick={handleClearAllSessions}
                        disabled={clearingAll}
                      >
                        {clearingAll ? '...' : 'All'}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Back button */}
          <div className="settings-page-footer">
            <button className="settings-back-btn" onClick={() => setSettingsOpen(false)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="19" y1="12" x2="5" y2="12"/>
                <polyline points="12 19 5 12 12 5"/>
              </svg>
              Back
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
