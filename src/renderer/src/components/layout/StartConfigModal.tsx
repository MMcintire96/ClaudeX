import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'

interface StartCommand {
  name: string
  command: string
  cwd?: string
}

interface ProjectAction {
  name: string
  command: string
  autoRun?: boolean
}

interface StartConfig {
  commands: StartCommand[]
  browserUrl?: string
  buildCommand?: string
  actions?: ProjectAction[]
  defaultAction?: string
}

interface StartConfigModalProps {
  projectPath: string
  onClose: () => void
  onSaved: () => void
}

export default function StartConfigModal({ projectPath, onClose, onSaved }: StartConfigModalProps) {
  const [commands, setCommands] = useState<StartCommand[]>([{ name: '', command: '' }])
  const [browserUrl, setBrowserUrl] = useState('')
  const [actions, setActions] = useState<ProjectAction[]>([{ name: '', command: '' }])
  const [defaultAction, setDefaultAction] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.project.getStartConfig(projectPath).then(config => {
      if (config && config.commands.length > 0) {
        setCommands(config.commands)
        setBrowserUrl(config.browserUrl || '')
      }
      if (config?.actions && config.actions.length > 0) {
        setActions(config.actions)
        setDefaultAction(config.defaultAction || '')
      } else if (config?.buildCommand) {
        // Migrate legacy buildCommand
        setActions([{ name: 'Build', command: config.buildCommand }])
        setDefaultAction('Build')
      }
      setLoading(false)
    })
  }, [projectPath])

  const handleSave = async () => {
    const validCommands = commands.filter(c => c.name.trim() && c.command.trim())
    const validActions = actions.filter(a => a.name.trim() && a.command.trim())
    const config: StartConfig = {
      commands: validCommands,
      browserUrl: browserUrl.trim() || undefined,
      actions: validActions.length > 0 ? validActions : undefined,
      defaultAction: defaultAction && validActions.some(a => a.name === defaultAction) ? defaultAction : undefined
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

  const updateAction = (index: number, field: keyof ProjectAction, value: string) => {
    setActions(prev => {
      const updated = prev.map((a, i) => i === index ? { ...a, [field]: value } : a)
      // If we renamed the default action, update the default
      if (field === 'name' && prev[index].name === defaultAction) {
        setDefaultAction(value)
      }
      return updated
    })
  }

  const addAction = () => {
    setActions(prev => [...prev, { name: '', command: '' }])
  }

  const removeAction = (index: number) => {
    const removed = actions[index]
    if (removed.name === defaultAction) setDefaultAction('')
    setActions(prev => prev.filter((_, i) => i !== index))
  }

  if (loading) return null

  return createPortal(
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
            <label className="start-config-label">Actions</label>
            {actions.map((action, i) => (
              <div key={i} className="start-config-command-row">
                <input
                  className="start-config-input start-config-input-name"
                  placeholder="Name (e.g. Test)"
                  value={action.name}
                  onChange={e => updateAction(i, 'name', e.target.value)}
                />
                <input
                  className="start-config-input start-config-input-cmd"
                  placeholder="Command (e.g. npm test)"
                  value={action.command}
                  onChange={e => updateAction(i, 'command', e.target.value)}
                />
                <button
                  className={`start-config-default-btn ${action.name && action.name === defaultAction ? 'active' : ''}`}
                  onClick={() => action.name && setDefaultAction(action.name === defaultAction ? '' : action.name)}
                  title={action.name === defaultAction ? 'Default action' : 'Set as default'}
                >
                  {action.name === defaultAction ? '\u2605' : '\u2606'}
                </button>
                <label className="start-config-autorun-label" title="Run automatically when a new session starts">
                  <input
                    type="checkbox"
                    checked={!!action.autoRun}
                    onChange={e => setActions(prev => prev.map((a, j) => j === i ? { ...a, autoRun: e.target.checked } : a))}
                  />
                  Auto
                </label>
                {actions.length > 1 && (
                  <button className="start-config-remove-btn" onClick={() => removeAction(i)}>&times;</button>
                )}
              </div>
            ))}
            <button className="btn btn-sm" onClick={addAction} style={{ marginTop: '4px' }}>
              + Add action
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
    </div>,
    document.body
  )
}
