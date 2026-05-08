import { useCallback, useEffect, useState } from 'react'
import { desktopSettings, DesktopSettings } from '../api'
import { LogOutIcon, CheckIcon } from './Icons'

const THEMES: Array<{ id: string; label: string; bg: string; fg: string; accent: string }> = [
  { id: 'dark', label: 'Dark', bg: '#0d0d0d', fg: '#e5e5e5', accent: '#0A84FF' },
  { id: 'light', label: 'Light', bg: '#ffffff', fg: '#1a1a1a', accent: '#1a1a1a' },
  { id: 'monokai', label: 'Monokai', bg: '#272822', fg: '#f8f8f2', accent: '#f92672' },
  { id: 'solarized-dark', label: 'Solarized Dark', bg: '#002b36', fg: '#839496', accent: '#268bd2' },
  { id: 'solarized-light', label: 'Solarized Light', bg: '#fdf6e3', fg: '#657b83', accent: '#268bd2' },
  { id: 'nord', label: 'Nord', bg: '#2e3440', fg: '#d8dee9', accent: '#88c0d0' },
  { id: 'dracula', label: 'Dracula', bg: '#282a36', fg: '#f8f8f2', accent: '#bd93f9' },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', bg: '#1e1e2e', fg: '#cdd6f4', accent: '#cba6f7' },
  { id: 'tokyo-night', label: 'Tokyo Night', bg: '#1a1b26', fg: '#a9b1d6', accent: '#7aa2f7' },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark', bg: '#282828', fg: '#ebdbb2', accent: '#fabd2f' },
  { id: 'gruvbox-light', label: 'Gruvbox Light', bg: '#fbf1c7', fg: '#3c3836', accent: '#076678' },
  { id: 'one-dark', label: 'One Dark', bg: '#282c34', fg: '#abb2bf', accent: '#61afef' },
  { id: 'rose-pine', label: 'Rose Pine', bg: '#191724', fg: '#e0def4', accent: '#c4a7e7' },
  { id: 'catppuccin-latte', label: 'Catppuccin Latte', bg: '#eff1f5', fg: '#4c4f69', accent: '#8839ef' },
  { id: 'everforest-dark', label: 'Everforest Dark', bg: '#2d353b', fg: '#d3c6aa', accent: '#a7c080' },
  { id: 'kanagawa', label: 'Kanagawa', bg: '#1f1f28', fg: '#dcd7ba', accent: '#7e9cd8' },
  { id: 'ayu-dark', label: 'Ayu Dark', bg: '#0d1017', fg: '#bfbdb6', accent: '#e6b450' },
  { id: 'github-dark', label: 'GitHub Dark', bg: '#0d1117', fg: '#e6edf3', accent: '#58a6ff' },
  { id: 'github-light', label: 'GitHub Light', bg: '#ffffff', fg: '#1f2328', accent: '#0969da' },
  { id: 'synthwave', label: 'Synthwave', bg: '#1a1028', fg: '#e0d0ff', accent: '#ff7edb' },
  { id: 'rose-pine-dawn', label: 'Rose Pine Dawn', bg: '#faf4ed', fg: '#575279', accent: '#907aa9' },
  { id: 'one-light', label: 'One Light', bg: '#fafafa', fg: '#383a42', accent: '#4078f2' }
]

const MODELS = [
  { id: 'claude-opus-4-7', label: 'Opus 4.7' },
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { id: 'gpt-5-codex-mini', label: 'Codex Mini' },
  { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
  { id: 'gpt-5.4', label: 'GPT-5.4' }
]

const EFFORTS = ['low', 'medium', 'high', 'max'] as const

const THEME_OVERRIDE_KEY = 'claudex.theme'

interface Props {
  onSignOut: () => void
}

export function SettingsPane({ onSignOut }: Props): JSX.Element {
  const [theme, setTheme] = useState<string>(() =>
    localStorage.getItem(THEME_OVERRIDE_KEY) || document.documentElement.getAttribute('data-theme') || 'dark'
  )
  const [settings, setSettings] = useState<DesktopSettings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    desktopSettings.get()
      .then(r => { if (!cancelled) setSettings(r.settings) })
      .catch(e => { if (!cancelled) setError(String(e)) })
    return () => { cancelled = true }
  }, [])

  const applyTheme = useCallback((id: string) => {
    setTheme(id)
    document.documentElement.setAttribute('data-theme', id)
    localStorage.setItem(THEME_OVERRIDE_KEY, id)
  }, [])

  const update = useCallback(async (partial: Partial<DesktopSettings>, label: string) => {
    setError(null)
    try {
      const r = await desktopSettings.update(partial)
      setSettings(r.settings)
      setSavedFlash(label)
      setTimeout(() => setSavedFlash(prev => prev === label ? null : prev), 1500)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  return (
    <div className="settings-pane">
      <div className="settings-section">
        <h2>Theme</h2>
        <p className="muted">Applies to this device. Sync with desktop on next launch.</p>
        <div className="theme-grid">
          {THEMES.map(t => (
            <button
              key={t.id}
              className={'theme-swatch' + (theme === t.id ? ' active' : '')}
              onClick={() => applyTheme(t.id)}
              aria-pressed={theme === t.id}
            >
              <span className="theme-preview" style={{ background: t.bg }}>
                <span className="theme-preview-fg" style={{ background: t.fg }} />
                <span className="theme-preview-accent" style={{ background: t.accent }} />
                {theme === t.id && (
                  <span className="theme-check"><CheckIcon size={14} /></span>
                )}
              </span>
              <span className="theme-label">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-section">
        <h2>Default model</h2>
        <select
          className="settings-select"
          value={settings?.defaultModel || 'claude-opus-4-7'}
          onChange={e => void update({ defaultModel: e.target.value }, 'model')}
        >
          {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
        {savedFlash === 'model' && <span className="muted">saved</span>}
      </div>

      <div className="settings-section">
        <h2>Default effort</h2>
        <div className="effort-row">
          {EFFORTS.map(e => (
            <button
              key={e}
              className={'chip' + ((settings?.defaultEffort || 'high') === e ? ' active' : '')}
              onClick={() => void update({ defaultEffort: e }, 'effort')}
            >
              {e}
            </button>
          ))}
        </div>
        {savedFlash === 'effort' && <span className="muted">saved</span>}
      </div>

      <div className="settings-section">
        <h2>Notifications</h2>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={settings?.notificationSounds ?? true}
            onChange={e => void update({ notificationSounds: e.target.checked }, 'sound')}
          />
          <span>Notification sounds (desktop)</span>
        </label>
      </div>

      {error && <div className="banner-error">{error}</div>}

      <div className="settings-section">
        <button className="btn-secondary settings-signout" onClick={onSignOut}>
          <LogOutIcon size={16} /> Sign out of this device
        </button>
      </div>
    </div>
  )
}
