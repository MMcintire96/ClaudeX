import React from 'react'

interface HotkeysModalProps {
  modKey: string
  onClose: () => void
}

const HOTKEYS = [
  { key: '?', label: 'Show hotkeys' },
  { key: 'N', label: 'New Claude terminal' },
  { key: 'T', label: 'New shell terminal' },
  { key: 'O', label: 'Open project' },
  { key: 'B', label: 'Toggle browser panel' },
  { key: 'D', label: 'Toggle diff panel' },
  { key: 'S', label: 'Toggle sidebar' },
  { key: 'L', label: 'Cycle color scheme' },
  { key: 'V', label: 'Voice input' },
  { key: 'W', label: 'Close active Claude tab' },
  { key: '1–9', label: 'Switch to Claude tab N' }
]

export default function HotkeysModal({ modKey, onClose }: HotkeysModalProps) {
  const modLabel = modKey === 'Meta' ? '⌘' : modKey

  return (
    <div className="hotkeys-overlay" onClick={onClose}>
      <div className="hotkeys-modal" onClick={(e) => e.stopPropagation()}>
        <div className="hotkeys-header">
          <h3>Keyboard Shortcuts</h3>
          <button className="hotkeys-close" onClick={onClose}>✕</button>
        </div>
        <div className="hotkeys-list">
          {HOTKEYS.map(({ key, label }) => (
            <div className="hotkeys-row" key={key}>
              <span className="hotkeys-key">
                <kbd>{modLabel}</kbd> + <kbd>{key}</kbd>
              </span>
              <span className="hotkeys-label">{label}</span>
            </div>
          ))}
          <div className="hotkeys-divider" />
          <div className="hotkeys-row">
            <span className="hotkeys-key">
              <kbd>Ctrl</kbd> + <kbd>`</kbd>
            </span>
            <span className="hotkeys-label">Toggle terminal panel</span>
          </div>
          <div className="hotkeys-row">
            <span className="hotkeys-key">
              <kbd>Shift</kbd> + <kbd>Tab</kbd>
            </span>
            <span className="hotkeys-label">Toggle plan/execute mode</span>
          </div>
        </div>
      </div>
    </div>
  )
}
