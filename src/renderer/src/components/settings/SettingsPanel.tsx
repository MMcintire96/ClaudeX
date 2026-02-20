import React, { useState, useCallback } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import { useProjectStore } from '../../stores/projectStore'
import { THEME_META } from '../../lib/themes'
import type { ThemeName } from '../../lib/themes'

const MOD_KEY_LABELS: Record<string, string> = {
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Meta: '⌘ Meta',
  Shift: 'Shift'
}

export default function SettingsPanel() {
  const { claude, modKey, vimMode, autoExpandEdits, notificationSounds, vimChatMode, preventSleep, updateSettings } = useSettingsStore()
  const { theme, setTheme } = useUIStore()
  const currentPath = useProjectStore(s => s.currentPath)
  const [capturing, setCapturing] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)
  const [clearingProject, setClearingProject] = useState(false)
  const [cleared, setCleared] = useState<string | null>(null)

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
    <div className="settings-panel">
      {/* Appearance */}
      <div className="settings-section">
        <div className="settings-section-title">Appearance</div>
        <div className="settings-row">
          <div className="settings-label">
            <span>Color scheme</span>
          </div>
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
        </div>
        <div className="settings-row">
          <div className="settings-label">
            <span>Auto expand edits</span>
            <span className="settings-description">
              Expand file edit blocks in chat automatically
            </span>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={autoExpandEdits}
              onChange={(e) =>
                updateSettings({ autoExpandEdits: e.target.checked })
              }
            />
            <span className="settings-toggle-slider" />
          </label>
        </div>
        <div className="settings-row">
          <div className="settings-label">
            <span>Notification sounds</span>
            <span className="settings-description">
              Play a sound when Claude finishes working
            </span>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={notificationSounds}
              onChange={(e) =>
                updateSettings({ notificationSounds: e.target.checked })
              }
            />
            <span className="settings-toggle-slider" />
          </label>
        </div>
        <div className="settings-row">
          <div className="settings-label">
            <span>Prevent sleep</span>
            <span className="settings-description">
              Keep machine awake while Claude is working
            </span>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={preventSleep}
              onChange={(e) =>
                updateSettings({ preventSleep: e.target.checked })
              }
            />
            <span className="settings-toggle-slider" />
          </label>
        </div>
      </div>

      {/* Input */}
      <div className="settings-section">
        <div className="settings-section-title">Input</div>
        <div className="settings-row">
          <div className="settings-label">
            <span>Hotkey modifier</span>
            <span className="settings-description">
              {capturing ? 'Press any key...' : 'Modifier key for shortcuts'}
            </span>
          </div>
          <button
            className={`btn btn-sm${capturing ? ' btn-active' : ''}`}
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
            {capturing ? '...' : (MOD_KEY_LABELS[modKey] || modKey)}
          </button>
        </div>
        <div className="settings-row">
          <div className="settings-label">
            <span>Vim mode</span>
            <span className="settings-description">
              Send ESC then i before input
            </span>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={vimMode}
              onChange={(e) =>
                updateSettings({ vimMode: e.target.checked })
              }
            />
            <span className="settings-toggle-slider" />
          </label>
        </div>
        <div className="settings-row">
          <div className="settings-label">
            <span>Vim chat input</span>
            <span className="settings-description">
              Vim keybindings in the chat textarea
            </span>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={vimChatMode}
              onChange={(e) =>
                updateSettings({ vimChatMode: e.target.checked })
              }
            />
            <span className="settings-toggle-slider" />
          </label>
        </div>
      </div>

      {/* Claude */}
      <div className="settings-section">
        <div className="settings-section-title">Claude</div>
        <div className="settings-row">
          <div className="settings-label">
            <span>Skip permissions</span>
            <span className="settings-description">
              Use --dangerously-skip-permissions
            </span>
          </div>
          <label className="settings-toggle">
            <input
              type="checkbox"
              checked={claude.dangerouslySkipPermissions}
              onChange={(e) =>
                updateSettings({ claude: { dangerouslySkipPermissions: e.target.checked } })
              }
            />
            <span className="settings-toggle-slider" />
          </label>
        </div>
      </div>

      {/* Data */}
      <div className="settings-section">
        <div className="settings-section-title">Data</div>
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
                className="btn btn-sm"
                onClick={handleClearProjectSessions}
                disabled={clearingProject}
              >
                {clearingProject ? '...' : 'Project'}
              </button>
            )}
            <button
              className="btn btn-sm btn-danger"
              onClick={handleClearAllSessions}
              disabled={clearingAll}
            >
              {clearingAll ? '...' : 'All'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
