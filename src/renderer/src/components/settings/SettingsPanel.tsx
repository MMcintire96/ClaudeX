import React, { useState } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import { THEME_META } from '../../lib/themes'
import type { ThemeName } from '../../lib/themes'

const MOD_KEY_LABELS: Record<string, string> = {
  Ctrl: 'Ctrl',
  Alt: 'Alt',
  Meta: '⌘ Meta',
  Shift: 'Shift'
}

export default function SettingsPanel() {
  const { claude, modKey, vimMode, autoExpandEdits, notificationSounds, vimChatMode, updateSettings } = useSettingsStore()
  const { theme, setTheme } = useUIStore()
  const [capturing, setCapturing] = useState(false)

  const currentMeta = THEME_META.find(m => m.id === theme)

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
            <span>Color scheme</span>
            <span className="settings-description">
              {currentMeta?.label ?? 'Dark'}
            </span>
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

        <div className="settings-row">
          <div className="settings-label">
            <span>Auto expand edits</span>
            <span className="settings-description">
              Automatically expand all file edit blocks in chat
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
            <span>Vim chat input</span>
            <span className="settings-description">
              Vim keybindings in the chat textarea (ESC for normal mode)
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
      </div>
    </div>
  )
}
