import React, { useState, useEffect } from 'react'

interface StartCommand {
  name: string
  command: string
  cwd?: string
}

interface StartConfig {
  commands: StartCommand[]
  browserUrl?: string
}

interface StartConfigModalProps {
  projectPath: string
  onClose: () => void
  onSaved: () => void
}

export default function StartConfigModal({ projectPath, onClose, onSaved }: StartConfigModalProps) {
  const [commands, setCommands] = useState<StartCommand[]>([{ name: '', command: '' }])
  const [browserUrl, setBrowserUrl] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.project.getStartConfig(projectPath).then(config => {
      if (config && config.commands.length > 0) {
        setCommands(config.commands)
        setBrowserUrl(config.browserUrl || '')
      }
      setLoading(false)
    })
  }, [projectPath])

  const handleSave = async () => {
    const validCommands = commands.filter(c => c.name.trim() && c.command.trim())
    const config: StartConfig = {
      commands: validCommands,
      browserUrl: browserUrl.trim() || undefined
    }
    await window.api.project.saveStartConfig(projectPath, config)
    onSaved()
    onClose()
  }

  const updateCommand = (index: number, field: keyof StartCommand, value: string) => {
    setCommands(prev => prev.map((c, i) => i === index ? { ...c, [field]: value } : c))
  }

  const addCommand = () => {
    setCommands(prev => [...prev, { name: '', command: '' }])
  }

  const removeCommand = (index: number) => {
    setCommands(prev => prev.filter((_, i) => i !== index))
  }

  if (loading) return null

  return (
    <div className="hotkeys-overlay" onClick={onClose}>
      <div className="start-config-modal" onClick={e => e.stopPropagation()}>
        <div className="hotkeys-header">
          <h3>Start Configuration</h3>
          <button className="hotkeys-close" onClick={onClose}>&times;</button>
        </div>
        <div className="start-config-body">
          <div className="start-config-section">
            <label className="start-config-label">Commands</label>
            {commands.map((cmd, i) => (
              <div key={i} className="start-config-command-row">
                <input
                  className="start-config-input start-config-input-name"
                  placeholder="Name (e.g. Dev Server)"
                  value={cmd.name}
                  onChange={e => updateCommand(i, 'name', e.target.value)}
                />
                <input
                  className="start-config-input start-config-input-cmd"
                  placeholder="Command (e.g. npm run dev)"
                  value={cmd.command}
                  onChange={e => updateCommand(i, 'command', e.target.value)}
                />
                <input
                  className="start-config-input start-config-input-cwd"
                  placeholder="cwd (optional)"
                  value={cmd.cwd || ''}
                  onChange={e => updateCommand(i, 'cwd', e.target.value)}
                />
                {commands.length > 1 && (
                  <button className="start-config-remove-btn" onClick={() => removeCommand(i)}>&times;</button>
                )}
              </div>
            ))}
            <button className="btn btn-sm" onClick={addCommand} style={{ marginTop: '4px' }}>
              + Add command
            </button>
          </div>
          <div className="start-config-section">
            <label className="start-config-label">Browser URL (optional)</label>
            <input
              className="start-config-input"
              placeholder="http://localhost:3000"
              value={browserUrl}
              onChange={e => setBrowserUrl(e.target.value)}
            />
          </div>
          <div className="start-config-actions">
            <button className="btn" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSave}>Save</button>
          </div>
        </div>
      </div>
    </div>
  )
}
