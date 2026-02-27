import React, { useState, useRef, useCallback, KeyboardEvent } from 'react'
import { useAgent } from '../../hooks/useAgent'
import { useSessionStore } from '../../stores/sessionStore'
import { useProjectStore } from '../../stores/projectStore'
import { AVAILABLE_MODELS, DEFAULT_MODEL, MODEL_IDS } from '../../constants/models'

const SLASH_COMMANDS = [
  { cmd: '/models', desc: 'Change the model' },
  { cmd: '/compact', desc: 'Compact conversation context' },
  { cmd: '/clear', desc: 'Clear chat history' },
]

interface InputBarProps {
  sessionId: string | null
}

const PASTE_LINE_THRESHOLD = 5

export default function InputBar({ sessionId }: InputBarProps) {
  const [input, setInput] = useState('')
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [pastedChunks, setPastedChunks] = useState<{ text: string; lineCount: number }[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { startNewSession, sendMessage, stopAgent, isRunning, isProcessing } = useAgent(sessionId)
  const currentPath = useProjectStore(s => s.currentPath)
  const setActiveSession = useSessionStore(s => s.setActiveSession)

  const session = useSessionStore(s =>
    sessionId ? s.sessions[sessionId] ?? null : null
  )
  const selectedModel = session?.selectedModel ?? DEFAULT_MODEL
  const handleSlashCommand = useCallback((command: string): boolean => {
    const cmd = command.trim().toLowerCase()

    if (cmd === '/models' || cmd.startsWith('/model ')) {
      const modelArg = cmd.replace(/^\/models?\s*/, '').trim()
      if (modelArg && sessionId) {
        const match = AVAILABLE_MODELS.find(m =>
          m.id.includes(modelArg) || m.id.toLowerCase().includes(modelArg.toLowerCase()) ||
          m.label.toLowerCase().includes(modelArg.toLowerCase())
        )
        if (match) {
          useSessionStore.getState().setSelectedModel(sessionId, match.id)
          window.api.agent.setModel(sessionId, match.id)
          useSessionStore.getState().addSystemMessage(sessionId, `Model changed to ${match.label}`)
        } else {
          useSessionStore.getState().setError(sessionId, `Unknown model: ${modelArg}. Available: ${MODEL_IDS.join(', ')}`)
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

    return false
  }, [sessionId, isRunning, sendMessage, session])

  const handleSelectModel = useCallback((model: string) => {
    if (sessionId) {
      useSessionStore.getState().setSelectedModel(sessionId, model)
      window.api.agent.setModel(sessionId, model)
    }
    setShowModelPicker(false)
  }, [sessionId])

  const handleSend = useCallback(async () => {
    const trimmed = input.trim()
    const hasPasted = pastedChunks.length > 0
    if ((!trimmed && !hasPasted) || !currentPath || isProcessing) return

    // Check for slash commands (only if no pasted content)
    if (!hasPasted && trimmed.startsWith('/')) {
      if (handleSlashCommand(trimmed)) {
        setInput('')
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
        }
        return
      }
    }

    // Build full message: pasted chunks + typed text
    const parts: string[] = []
    for (const chunk of pastedChunks) {
      parts.push(chunk.text)
    }
    if (trimmed) {
      parts.push(trimmed)
    }
    const fullMessage = parts.join('\n\n')

    if (isRunning && sessionId) {
      sendMessage(fullMessage)
    } else {
      // Start a new session
      const newSessionId = await startNewSession(fullMessage)
      if (newSessionId) {
        setActiveSession(newSessionId)
      }
    }

    setInput('')
    setPastedChunks([])
    setShowSlashMenu(false)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [input, pastedChunks, currentPath, isRunning, isProcessing, sessionId, sendMessage, startNewSession, handleSlashCommand, setActiveSession])

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

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData.getData('text')
    const lineCount = pastedText.split('\n').length

    if (lineCount >= PASTE_LINE_THRESHOLD) {
      e.preventDefault()
      setPastedChunks(prev => [...prev, { text: pastedText, lineCount }])
    }
  }, [])

  const removePastedChunk = useCallback((index: number) => {
    setPastedChunks(prev => prev.filter((_, i) => i !== index))
  }, [])

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInput(val)
    setShowSlashMenu(val === '/')
    const el = e.target
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [])

  return (
    <div className="input-bar-wrapper">
      {/* Model picker dropdown */}
      {showModelPicker && (
        <div className="slash-menu">
          <div className="slash-menu-header">Select model:</div>
          {AVAILABLE_MODELS.map(m => (
            <button
              key={m.id}
              className={`slash-menu-item ${selectedModel === m.id ? 'active' : ''}`}
              onClick={() => handleSelectModel(m.id)}
            >
              {m.label}
              {selectedModel === m.id && ' (current)'}
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
        {pastedChunks.length > 0 && (
          <div className="pasted-chunks">
            {pastedChunks.map((chunk, i) => (
              <div key={i} className="pasted-chip">
                <span className="pasted-chip-text">
                  {chunk.text.split('\n')[0].slice(0, 40)}
                  {chunk.text.split('\n')[0].length > 40 ? '...' : ''}
                  {' '}({chunk.lineCount} lines)
                </span>
                <button
                  className="pasted-chip-remove"
                  onClick={() => removePastedChunk(i)}
                  title="Remove"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          className="input-textarea"
          value={input}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={
            !currentPath
              ? 'Open a project first...'
              : isProcessing
                ? 'Claude is thinking...'
                : 'Ask anything (/ for commands)'
          }
          disabled={!currentPath || isProcessing}
          spellCheck={true}
          rows={1}
        />
        <div className="input-actions">
          {isProcessing ? (
            <button
              className="btn-stop"
              onClick={stopAgent}
              title="Stop"
            >
              <span style={{ display: 'block', width: 14, height: 14, minWidth: 14, minHeight: 14, backgroundColor: '#fff', borderRadius: 3 }} />
            </button>
          ) : (
            <button
              className="btn-send"
              onClick={handleSend}
              disabled={(!input.trim() && pastedChunks.length === 0) || !currentPath}
              title="Send"
            >
              &#8593;
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
