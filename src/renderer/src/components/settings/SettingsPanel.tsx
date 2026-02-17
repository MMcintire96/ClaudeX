import React, { useState } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'

const MOD_KEY_LABELS: Record<string, string> = {
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Meta: '⌘ Meta',
  Shift: 'Shift'
}

export default function SettingsPanel() {
  const { claude, modKey, vimMode, updateSettings } = useSettingsStore()
  const { theme, toggleTheme } = useUIStore()
  const [capturing, setCapturing] = useState(false)

  return (
    <div className="settings-panel">
      <div className="settings-section">
        <div className="settings-row">
          <div className="settings-label">
            <span>Skip permissions</span>
            <span className="settings-description">
              Launch Claude Code with --dangerously-skip-permissions
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

        <div className="settings-row">
          <div className="settings-label">
            <span>Theme</span>
            <span className="settings-description">
              {theme === 'dark' ? 'Dark' : 'Light'} mode
            </span>
          </div>
          <button className="btn btn-sm" onClick={toggleTheme}>
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        </div>

        <div className="settings-row">
          <div className="settings-label">
            <span>Hotkey modifier</span>
            <span className="settings-description">
              {capturing ? 'Press any key…' : 'Click to change, then press any key'}
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
              // Normalize key name for display/storage
              let key = e.key
              if (key === 'Control') key = 'Ctrl'
              updateSettings({ modKey: key })
              setCapturing(false)
            }}
          >
            {capturing ? '…' : (MOD_KEY_LABELS[modKey] || modKey)}
          </button>
        </div>

        <div className="settings-row">
          <div className="settings-label">
            <span>Vim mode</span>
            <span className="settings-description">
              Send ESC → i before input (for Claude Code vim keybindings)
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
      </div>
    </div>
  )
}
