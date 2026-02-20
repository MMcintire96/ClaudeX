import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { UIMessage, UITextMessage, UIToolUseMessage, UIToolResultMessage } from '../../stores/sessionStore'
import { useSessionStore } from '../../stores/sessionStore'
import MessageBubble from './MessageBubble'
import ToolUseBlock from './ToolUseBlock'
import ToolResultBlock from './ToolResultBlock'
import AskUserQuestionBlock from './AskUserQuestionBlock'
import FileEditBlock, { isFileEditTool } from './FileEditBlock'
import VoiceButton from '../common/VoiceButton'
import { useTerminalStore } from '../../stores/terminalStore'
import type { ClaudeMode } from '../../stores/terminalStore'

interface ChatViewProps {
  terminalId: string
  projectPath: string
}

/**
 * Extract suggested follow-up messages from the last assistant text.
 * Looks for common patterns like numbered lists at the end of a response.
 */
function extractSuggestions(messages: UIMessage[]): string[] {
  // Find the last assistant text message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== 'assistant' || msg.type !== 'text') continue

    const text = (msg as UITextMessage).content
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

    // Check if the last few lines look like suggestions
    // Pattern: lines starting with "- ", "* ", or "1. " etc.
    const suggestions: string[] = []
    for (let j = lines.length - 1; j >= Math.max(0, lines.length - 6); j--) {
      const line = lines[j]
      const match = line.match(/^(?:[-*•]\s+|(?:\d+)[.)]\s+)(.+)/)
      if (match) {
        const suggestion = match[1].replace(/[*`]/g, '').trim()
        if (suggestion.length > 10 && suggestion.length < 120) {
          suggestions.unshift(suggestion)
        }
      } else if (suggestions.length > 0) {
        // Stop when we hit a non-list line (we only want trailing lists)
        break
      }
    }

    if (suggestions.length >= 2 && suggestions.length <= 5) {
      return suggestions
    }

    // No list-based suggestions found
    break
  }

  return []
}

const AVAILABLE_MODELS = [
  { id: 'claude-opus-4-6', label: 'Opus 4.6' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' }
]

// Only non-interactive commands that don't open TUI screens
const SLASH_COMMANDS: { cmd: string; desc: string; immediate: boolean }[] = [
  { cmd: '/clear', desc: 'Clear conversation history', immediate: true },
  { cmd: '/compact', desc: 'Compact context with optional instructions', immediate: false },
  { cmd: '/cost', desc: 'Show token usage & cost', immediate: true },
  { cmd: '/init', desc: 'Initialize CLAUDE.md', immediate: true },
]

const EMPTY_MESSAGES: UIMessage[] = []

export default function ChatView({ terminalId, projectPath }: ChatViewProps) {
  const [inputText, setInputText] = useState('')
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Read session data from stores (push-based, cached)
  const sessionId = useTerminalStore(s => s.claudeSessionIds[terminalId])
  const messages = useSessionStore(s => sessionId ? s.sessions[sessionId]?.messages ?? EMPTY_MESSAGES : EMPTY_MESSAGES)
  const detectedModel = useSessionStore(s => sessionId ? s.sessions[sessionId]?.model ?? null : null)
  const thinkingText = useSessionStore(s => sessionId ? s.thinkingText[sessionId] ?? null : null)
  const lastEntryType = useSessionStore(s => sessionId ? s.lastEntryType[sessionId] ?? null : null)

  const claudeMode = useTerminalStore(s => s.claudeModes[terminalId] || 'execute') as ClaudeMode
  const claudeModel = useTerminalStore(s => s.claudeModels[terminalId] || '')
  const claudeStatus = useTerminalStore(s => s.claudeStatuses[terminalId] || 'idle')
  const contextUsage = useTerminalStore(s => s.contextUsage[terminalId] || 0)
  const toggleClaudeMode = useTerminalStore(s => s.toggleClaudeMode)
  const setClaudeModel = useTerminalStore(s => s.setClaudeModel)
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null)
  const slashCommandActiveRef = useRef(false)

  // Show thinking only when Claude is processing a user message (not mode toggles, slash cmds, etc.)
  const isThinking = claudeStatus === 'running' && !slashCommandActiveRef.current && (lastEntryType === 'user' || pendingUserMessage !== null)
  const suggestions = useMemo(() => {
    if (claudeStatus === 'running' || inputText.trim()) return []
    return extractSuggestions(messages)
  }, [messages, claudeStatus, inputText])

  // Resolve the display model: explicit pick > detected from session > fallback
  const displayModel = claudeModel || detectedModel || 'claude-sonnet-4-6'

  // Clear slash command suppression when Claude goes idle
  useEffect(() => {
    if (claudeStatus !== 'running') {
      slashCommandActiveRef.current = false
    }
  }, [claudeStatus])

  // Input history
  const historyRef = useRef<string[]>([])
  const historyIndexRef = useRef(-1)
  const savedInputRef = useRef('')

  // Close model picker on outside click
  useEffect(() => {
    if (!modelPickerOpen) return
    const handler = () => setModelPickerOpen(false)
    // Delay to avoid closing immediately from the toggle click
    const id = setTimeout(() => document.addEventListener('click', handler), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('click', handler)
    }
  }, [modelPickerOpen])

  // Reset transient input state when terminalId changes (session switch)
  useEffect(() => {
    setInputText('')
    setPendingUserMessage(null)
    historyIndexRef.current = -1
  }, [terminalId])

  // Ensure session exists in store and file watcher is running.
  // Uses watch() (not read()) so that push-based updates flow even if
  // App.tsx's onClaudeSessionId handler missed the terminal (race condition:
  // session ID event can arrive before addTerminal completes).
  const watchedSessionRef = useRef<string | null>(null)
  useEffect(() => {
    if (!sessionId) return
    if (watchedSessionRef.current === sessionId) return
    const session = useSessionStore.getState().sessions[sessionId]
    if (session && session.messages.length > 0) {
      // Already cached — just ensure watcher is running
      watchedSessionRef.current = sessionId
      window.api.sessionFile.watch(terminalId, sessionId, projectPath)
      return
    }
    watchedSessionRef.current = sessionId
    // Create session in store immediately (even if empty) so appendEntries works
    useSessionStore.getState().loadEntries(sessionId, projectPath, [])
    window.api.sessionFile.watch(terminalId, sessionId, projectPath).then(result => {
      if (result.success && result.entries && (result.entries as unknown[]).length > 0) {
        useSessionStore.getState().loadEntries(
          sessionId,
          projectPath,
          result.entries as import('../../stores/sessionStore').SessionFileEntry[]
        )
      }
    })
  }, [sessionId, terminalId, projectPath])

  // Clear optimistic pending message once session file catches up
  useEffect(() => {
    if (lastEntryType === 'user' || lastEntryType === 'assistant') {
      setPendingUserMessage(null)
    }
  }, [lastEntryType])

  // Auto-scroll to bottom
  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = useCallback(async () => {
    const text = inputText.trim()
    if (!text) return

    // Add to history
    historyRef.current.push(text)
    historyIndexRef.current = -1
    savedInputRef.current = ''

    setInputText('')
    setSlashMenuOpen(false)
    setSlashFilter('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    // Handle slash commands — suppress thinking indicator for all slash cmds
    if (text.startsWith('/')) {
      slashCommandActiveRef.current = true
      if (text === '/clear' || text.startsWith('/clear ')) {
        // Store will be reset when the session file watcher sends a reset event
        setPendingUserMessage(null)
      }
    } else {
      // Optimistic: show user message immediately before session file catches up
      setPendingUserMessage(text)
    }

    await window.api.terminal.write(terminalId, text)
    await new Promise(r => setTimeout(r, 50))
    await window.api.terminal.write(terminalId, '\r')
  }, [inputText, terminalId])

  const handleToggleMode = useCallback(async () => {
    // Send Shift+Tab escape sequence to the Claude CLI PTY
    await window.api.terminal.write(terminalId, '\x1b[Z')
    toggleClaudeMode(terminalId)
  }, [terminalId, toggleClaudeMode])

  const handleModelChange = useCallback(async (modelId: string) => {
    setClaudeModel(terminalId, modelId)
    setModelPickerOpen(false)
    // Suppress thinking indicator for model switch
    slashCommandActiveRef.current = true
    // Send /model command to the Claude CLI
    await window.api.terminal.write(terminalId, `/model ${modelId}`)
    await new Promise(r => setTimeout(r, 50))
    await window.api.terminal.write(terminalId, '\r')
  }, [terminalId, setClaudeModel])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Shift+Tab — toggle plan/execute mode
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      handleToggleMode()
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
      return
    }

    // Up arrow — previous history
    if (e.key === 'ArrowUp' && !e.shiftKey) {
      const history = historyRef.current
      if (history.length === 0) return

      e.preventDefault()

      if (historyIndexRef.current === -1) {
        // Save current input before navigating history
        savedInputRef.current = inputText
        historyIndexRef.current = history.length - 1
      } else if (historyIndexRef.current > 0) {
        historyIndexRef.current--
      }

      setInputText(history[historyIndexRef.current])
    }

    // Down arrow — next history / back to current input
    if (e.key === 'ArrowDown' && !e.shiftKey) {
      const history = historyRef.current
      if (historyIndexRef.current === -1) return

      e.preventDefault()

      if (historyIndexRef.current < history.length - 1) {
        historyIndexRef.current++
        setInputText(history[historyIndexRef.current])
      } else {
        // Back to saved input
        historyIndexRef.current = -1
        setInputText(savedInputRef.current)
      }
    }
  }, [handleSend, handleToggleMode, inputText])

  const handleVoiceTranscript = useCallback((text: string) => {
    setInputText(prev => prev + text)
    // Focus the textarea after voice input
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [])

  const handleSlashSelect = useCallback(async (cmd: string, immediate: boolean) => {
    setSlashMenuOpen(false)
    setSlashFilter('')

    if (immediate) {
      setInputText('')
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto'
      }

      // Suppress thinking indicator for slash commands
      slashCommandActiveRef.current = true

      if (cmd === '/clear') {
        setPendingUserMessage(null)
      }

      await window.api.terminal.write(terminalId, cmd)
      await new Promise(r => setTimeout(r, 50))
      await window.api.terminal.write(terminalId, '\r')
    } else {
      // Populate input for commands that need arguments
      setInputText(cmd + ' ')
      textareaRef.current?.focus()
    }
  }, [terminalId])

  const handleSuggestionClick = useCallback((suggestion: string) => {
    setInputText(suggestion)
    textareaRef.current?.focus()
  }, [])

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInputText(val)
    // Reset history navigation when user types
    historyIndexRef.current = -1

    // Slash command detection
    if (val.startsWith('/')) {
      const filter = val.slice(1).toLowerCase()
      setSlashFilter(filter)
      setSlashMenuOpen(true)
    } else {
      setSlashMenuOpen(false)
      setSlashFilter('')
    }

    // Auto-resize
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [])

  return (
    <div className="chat-view">
      <div className="chat-view-messages" ref={listRef}>
        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="empty-state">
              <p>Waiting for messages...</p>
            </div>
          ) : (
            messages.map((msg, idx) => {
              if (msg.type === 'text') {
                return <MessageBubble key={msg.id} message={msg as UITextMessage} />
              } else if (msg.type === 'tool_use') {
                const toolMsg = msg as UIToolUseMessage
                if (toolMsg.toolName === 'AskUserQuestion') {
                  const hasResult = messages.slice(idx + 1).some(
                    m => m.type === 'tool_result' && (m as UIToolResultMessage).toolUseId === toolMsg.toolId
                  )
                  return <AskUserQuestionBlock key={msg.id} message={toolMsg} terminalId={terminalId} answered={hasResult} />
                }
                if (isFileEditTool(toolMsg.toolName)) {
                  // Find the paired result for this tool use
                  const pairedResult = messages.find(
                    m => m.type === 'tool_result' && (m as UIToolResultMessage).toolUseId === toolMsg.toolId
                  ) as UIToolResultMessage | undefined
                  return <FileEditBlock key={msg.id} message={toolMsg} result={pairedResult || null} />
                }
                return <ToolUseBlock key={msg.id} message={toolMsg} />
              } else if (msg.type === 'tool_result') {
                const resultMsg = msg as UIToolResultMessage
                const parentTool = messages.find(
                  m => m.type === 'tool_use' && (m as UIToolUseMessage).toolId === resultMsg.toolUseId
                ) as UIToolUseMessage | undefined
                // Skip results already rendered inline by AskUserQuestion or FileEditBlock
                if (parentTool?.toolName === 'AskUserQuestion') return null
                if (parentTool && isFileEditTool(parentTool.toolName)) return null
                return <ToolResultBlock key={msg.id} message={resultMsg} />
              }
              return null
            })
          )}

          {/* Optimistic user message (shown before session file catches up) */}
          {pendingUserMessage && (
            <MessageBubble
              message={{
                id: 'pending-user',
                role: 'user',
                type: 'text',
                content: pendingUserMessage,
                timestamp: Date.now()
              } as UITextMessage}
            />
          )}

          {/* Thinking / loading indicator */}
          {isThinking && (
            <div className="thinking-indicator">
              <div className="thinking-dots">
                <span className="thinking-dot" />
                <span className="thinking-dot" />
                <span className="thinking-dot" />
              </div>
              <span className="thinking-label">
                {thinkingText
                  ? thinkingText
                  : 'Thinking...'}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="chat-view-input-wrapper">
        {/* Slash command menu */}
        {slashMenuOpen && (
          <div className="slash-menu">
            {SLASH_COMMANDS
              .filter(c => !slashFilter || c.cmd.slice(1).startsWith(slashFilter))
              .map(c => (
                <button
                  key={c.cmd}
                  className="slash-menu-item"
                  onMouseDown={(e) => { e.preventDefault(); handleSlashSelect(c.cmd, c.immediate) }}
                >
                  <span className="slash-cmd">{c.cmd}</span>
                  <span className="slash-desc">{c.desc}</span>
                </button>
              ))
            }
          </div>
        )}

        {/* Auto-suggested follow-ups */}
        {suggestions.length > 0 && (
          <div className="suggestions-row">
            {suggestions.map((s, i) => (
              <button
                key={i}
                className="suggestion-chip"
                onClick={() => handleSuggestionClick(s)}
              >
                {s.length > 60 ? s.slice(0, 57) + '...' : s}
              </button>
            ))}
          </div>
        )}

        <div className="input-bar">
          <textarea
            ref={textareaRef}
            className="input-textarea"
            placeholder="Ask for follow-up changes... (/ for commands)"
            value={inputText}
            onChange={handleTextareaChange}
            onKeyDown={handleKeyDown}
            onBlur={() => { setTimeout(() => setSlashMenuOpen(false), 150) }}
            rows={2}
          />
          <div className="input-bar-toolbar">
            <div className="input-bar-toolbar-left">
              <div className="model-picker-wrapper">
                <button
                  className="btn-model-picker"
                  onClick={() => setModelPickerOpen(!modelPickerOpen)}
                  title="Change model"
                >
                  {AVAILABLE_MODELS.find(m => m.id === displayModel)?.label || displayModel.split('-').slice(1).join(' ')}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
                {modelPickerOpen && (
                  <div className="model-picker-dropdown">
                    {AVAILABLE_MODELS.map(m => (
                      <button
                        key={m.id}
                        className={`model-picker-option ${m.id === displayModel ? 'active' : ''}`}
                        onClick={() => handleModelChange(m.id)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <button
                className={`btn-mode-toggle ${claudeMode === 'plan' ? 'mode-plan' : 'mode-execute'}`}
                onClick={handleToggleMode}
                title={`Mode: ${claudeMode} (Shift+Tab to toggle)`}
              >
                {claudeMode === 'plan' ? 'Plan' : 'Execute'}
              </button>
            </div>
            <div className="input-actions">
              <VoiceButton onTranscript={handleVoiceTranscript} inline />
              <button
                className="btn-send"
                onClick={handleSend}
                disabled={!inputText.trim()}
                title="Send"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13"/>
                  <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
              </button>
            </div>
          </div>
        </div>

        {/* Context footer */}
        <div className="input-footer">
          <div className="input-footer-left">
            <span className="input-footer-project" title={projectPath}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              {projectPath.split('/').pop()}
            </span>
          </div>
          <div className="input-footer-right">
            <div
              className={`context-meter ${contextUsage > 80 ? 'context-danger' : contextUsage > 50 ? 'context-warn' : ''}`}
              title={`Context: ${contextUsage}% used, ${100 - contextUsage}% remaining`}
            >
              <div className="context-bar">
                <div className="context-bar-fill" style={{ width: `${contextUsage}%` }} />
              </div>
              <span className="context-label">{100 - contextUsage}%</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
