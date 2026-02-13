import React, { useState, useRef, useCallback, KeyboardEvent } from 'react'
import { useAgent } from '../../hooks/useAgent'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'

const AVAILABLE_MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001'
]

const SLASH_COMMANDS = [
  { cmd: '/models', desc: 'Change the model' },
  { cmd: '/compact', desc: 'Compact conversation context' },
  { cmd: '/clear', desc: 'Clear chat history' },
  { cmd: '/cost', desc: 'Show session cost' }
]

interface InputBarProps {
  sessionId: string | null
}

export default function InputBar({ sessionId }: InputBarProps) {
  const [input, setInput] = useState('')
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { startNewSession, sendMessage, stopAgent, isRunning, isProcessing } = useAgent(sessionId)
  const currentPath = useProjectStore(s => s.currentPath)
  const setActiveSession = useSessionStore(s => s.setActiveSession)

  const session = useSessionStore(s =>
    sessionId ? s.sessions[sessionId] ?? null : null
  )
  const selectedModel = session?.selectedModel ?? null
  const costUsd = session?.costUsd ?? 0
  const totalCostUsd = session?.totalCostUsd ?? 0

  const handleSlashCommand = useCallback((command: string): boolean => {
    const cmd = command.trim().toLowerCase()

    if (cmd === '/models' || cmd.startsWith('/model ')) {
      const modelArg = cmd.replace(/^\/models?\s*/, '').trim()
      if (modelArg && sessionId) {
        const match = AVAILABLE_MODELS.find(m =>
          m.includes(modelArg) || m.toLowerCase().includes(modelArg.toLowerCase())
        )
        if (match) {
          useSessionStore.getState().setSelectedModel(sessionId, match)
          window.api.agent.setModel(sessionId, match)
          useSessionStore.getState().addUserMessage(sessionId, `/model ${match}`)
          useSessionStore.getState().processEvent(sessionId, {
            type: 'result',
            subtype: 'success',
            cost_usd: costUsd,
            total_cost_usd: totalCostUsd,
            num_turns: session?.numTurns ?? 0
          })
        } else {
          useSessionStore.getState().addUserMessage(sessionId, command)
          useSessionStore.getState().setError(sessionId, `Unknown model: ${modelArg}. Available: ${AVAILABLE_MODELS.join(', ')}`)
        }
      } else {
        setShowModelPicker(true)
      }
      return true
    }

    if (cmd === '/compact') {
      if (isRunning && sessionId) {
        sendMessage('Please compact the conversation to save context.')
      }
      return true
    }

    if (cmd === '/clear') {
      if (sessionId) {
        useSessionStore.getState().removeSession(sessionId)
      }
      return true
    }

    if (cmd === '/cost' && sessionId) {
      const s = useSessionStore.getState().sessions[sessionId]
      if (s) {
        useSessionStore.getState().addUserMessage(sessionId, '/cost')
        const msg = `Session cost: $${(s.costUsd || 0).toFixed(4)} | Total: $${(s.totalCostUsd || 0).toFixed(4)} | Turns: ${s.numTurns}`
        useSessionStore.getState().processEvent(sessionId, {
          type: 'assistant',
          message: {
            id: `cost-${Date.now()}`,
            content: [{ type: 'text', text: msg }],
            model: s.model
          }
        })
      }
      return true
    }

    return false
  }, [sessionId, isRunning, sendMessage, costUsd, totalCostUsd, session])

  const handleSelectModel = useCallback((model: string) => {
    if (sessionId) {
      useSessionStore.getState().setSelectedModel(sessionId, model)
      window.api.agent.setModel(sessionId, model)
      useSessionStore.getState().addUserMessage(sessionId, `/model ${model}`)
    }
    setShowModelPicker(false)
  }, [sessionId])

  const handleSend = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || !currentPath || isProcessing) return

    // Check for slash commands
    if (trimmed.startsWith('/')) {
      if (handleSlashCommand(trimmed)) {
        setInput('')
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
        }
        return
      }
    }

    if (isRunning && sessionId) {
      sendMessage(trimmed)
    } else {
      // Start a new session
      const newSessionId = await startNewSession(trimmed)
      if (newSessionId) {
        setActiveSession(newSessionId)
      }
    }

    setInput('')
    setShowSlashMenu(false)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input, currentPath, isRunning, isProcessing, sessionId, sendMessage, startNewSession, handleSlashCommand, setActiveSession])

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
    if (e.key === 'Escape') {
      setShowModelPicker(false)
      setShowSlashMenu(false)
    }
  }, [handleSend])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInput(val)
    setShowSlashMenu(val === '/')
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [])

  return (
    <div className="input-bar-wrapper">
      {/* Model picker dropdown */}
      {showModelPicker && (
        <div className="slash-menu">
          <div className="slash-menu-header">Select model:</div>
          {AVAILABLE_MODELS.map(m => (
            <button
              key={m}
              className={`slash-menu-item ${selectedModel === m ? 'active' : ''}`}
              onClick={() => handleSelectModel(m)}
            >
              {m}
              {selectedModel === m && ' (current)'}
            </button>
          ))}
          <button className="slash-menu-item" onClick={() => setShowModelPicker(false)}>
            Cancel
          </button>
        </div>
      )}

      {/* Slash command autocomplete */}
      {showSlashMenu && (
        <div className="slash-menu">
          {SLASH_COMMANDS.map(c => (
            <button
              key={c.cmd}
              className="slash-menu-item"
              onClick={() => {
                setInput(c.cmd)
                setShowSlashMenu(false)
                textareaRef.current?.focus()
              }}
            >
              <span className="slash-cmd">{c.cmd}</span>
              <span className="slash-desc">{c.desc}</span>
            </button>
          ))}
        </div>
      )}

      <div className="input-bar">
        {selectedModel && (
          <div className="input-model-badge" onClick={() => setShowModelPicker(true)}>
            {selectedModel.split('-').slice(1, 3).join(' ')}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="input-textarea"
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={
            !currentPath
              ? 'Open a project first...'
              : isProcessing
                ? 'Claude is thinking...'
                : 'Ask anything (/ for commands)'
          }
          disabled={!currentPath || isProcessing}
          rows={1}
        />
        <div className="input-actions">
          {isProcessing && (
            <button className="btn-stop" onClick={stopAgent}>
              Stop
            </button>
          )}
          <button
            className="btn-send"
            onClick={handleSend}
            disabled={!input.trim() || !currentPath || isProcessing}
            title="Send"
          >
            &#8593;
          </button>
        </div>
      </div>
    </div>
  )
}
