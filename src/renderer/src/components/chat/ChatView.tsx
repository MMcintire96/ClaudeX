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
import { useSettingsStore } from '../../stores/settingsStore'
import { useVimMode } from '../../hooks/useVimMode'

interface ChatViewProps {
  terminalId: string
  projectPath: string
}

/** Renders a vim-style block cursor overlay on top of a textarea */
function VimBlockCursor({ textareaRef, text }: { textareaRef: React.RefObject<HTMLTextAreaElement | null>, text: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const measure = () => {
      const ta = textareaRef.current
      const mirror = mirrorRef.current
      if (!ta || !mirror) return

      const cursor = ta.selectionStart
      const style = window.getComputedStyle(ta)

      // Mirror the textarea's text styling
      mirror.style.font = style.font
      mirror.style.letterSpacing = style.letterSpacing
      mirror.style.wordSpacing = style.wordSpacing
      mirror.style.lineHeight = style.lineHeight
      mirror.style.padding = style.padding
      mirror.style.border = style.border
      mirror.style.boxSizing = style.boxSizing
      mirror.style.whiteSpace = 'pre-wrap'
      mirror.style.wordWrap = 'break-word'
      mirror.style.width = ta.offsetWidth + 'px'

      // Put text up to cursor in the mirror, add a span to measure position
      const before = text.slice(0, cursor)
      mirror.innerHTML = ''
      mirror.appendChild(document.createTextNode(before))
      const span = document.createElement('span')
      span.textContent = text[cursor] || ' '
      mirror.appendChild(span)

      const spanRect = span.getBoundingClientRect()
      const mirrorRect = mirror.getBoundingClientRect()

      setPos({
        top: spanRect.top - mirrorRect.top - ta.scrollTop,
        left: spanRect.left - mirrorRect.left,
      })
    }

    measure()
    // Re-measure on selection changes
    const ta = textareaRef.current
    const onSelect = () => requestAnimationFrame(measure)
    ta?.addEventListener('select', onSelect)
    ta?.addEventListener('click', onSelect)
    ta?.addEventListener('keyup', onSelect)
    return () => {
      ta?.removeEventListener('select', onSelect)
      ta?.removeEventListener('click', onSelect)
      ta?.removeEventListener('keyup', onSelect)
    }
  }, [text, textareaRef])

  return (
    <>
      <div ref={mirrorRef} style={{ position: 'absolute', visibility: 'hidden', top: 0, left: 0, pointerEvents: 'none', overflow: 'hidden', height: 0 }} />
      {pos && (
        <div
          className="vim-block-cursor"
          style={{ top: pos.top, left: pos.left }}
        />
      )}
    </>
  )
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

  { cmd: '/init', desc: 'Initialize CLAUDE.md', immediate: true },
]

const EMPTY_MESSAGES: UIMessage[] = []
const MESSAGES_PER_PAGE = 50

/** Render input text with @file references highlighted */
function renderHighlightedInput(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  const regex = /@([\w./_-]+\.\w+)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    parts.push(<span key={match.index} className="input-file-ref">{match[0]}</span>)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

export default function ChatView({ terminalId, projectPath }: ChatViewProps) {
  const [inputText, setInputText] = useState('')
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [slashMenuOpen, setSlashMenuOpen] = useState(false)
  const [slashFilter, setSlashFilter] = useState('')
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [filePickerFilter, setFilePickerFilter] = useState('')
  const [filePickerFiles, setFilePickerFiles] = useState<string[]>([])
  const [filePickerIndex, setFilePickerIndex] = useState(0)
  const filePickerLoadedRef = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const dragCounterRef = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(MESSAGES_PER_PAGE)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Search state
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Vim mode for chat input
  const vimChatEnabled = useSettingsStore(s => s.vimChatMode)
  const inputTextRef = useRef(inputText)
  inputTextRef.current = inputText
  const getInputText = useCallback(() => inputTextRef.current, [])
  const vim = useVimMode(textareaRef, getInputText, setInputText, vimChatEnabled)

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
  const [messageQueue, setMessageQueue] = useState<string[]>([])
  const sendingQueueRef = useRef(false)
  const slashCommandActiveRef = useRef(false)

  // Show thinking only when Claude is processing a user message (not mode toggles, slash cmds, etc.)
  const isThinking = claudeStatus === 'running' && !slashCommandActiveRef.current && (lastEntryType === 'user' || pendingUserMessage !== null)

  // Resolve the display model: explicit pick > detected from session > fallback
  const displayModel = claudeModel || detectedModel || 'claude-opus-4-6'

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

  // Load project files for @ picker (once per project)
  useEffect(() => {
    if (!filePickerOpen) return
    if (filePickerLoadedRef.current === projectPath) return
    filePickerLoadedRef.current = projectPath
    window.api.project.listFiles(projectPath).then(result => {
      if (result.success) setFilePickerFiles(result.files)
    })
  }, [filePickerOpen, projectPath])

  // Filtered files for @ picker
  const filteredPickerFiles = useMemo(() => {
    if (!filePickerFilter) return filePickerFiles.slice(0, 20)
    const q = filePickerFilter.toLowerCase()
    // Score: prefer filename match over path match, exact prefix over contains
    const scored = filePickerFiles
      .map(f => {
        const lower = f.toLowerCase()
        const name = lower.split('/').pop() || lower
        if (name.startsWith(q)) return { f, score: 0 }
        if (name.includes(q)) return { f, score: 1 }
        if (lower.includes(q)) return { f, score: 2 }
        return null
      })
      .filter(Boolean) as { f: string; score: number }[]
    scored.sort((a, b) => a.score - b.score)
    return scored.slice(0, 20).map(s => s.f)
  }, [filePickerFiles, filePickerFilter])

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
    setMessageQueue([])
    sendingQueueRef.current = false
    historyIndexRef.current = -1
    setFilePickerOpen(false)
    filePickerLoadedRef.current = null
    setVisibleCount(MESSAGES_PER_PAGE)
    vim.resetToInsert()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId])

  // Listen for "Add to Claude" events from DiffPanel / ProjectTree
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail.projectPath !== projectPath) return
      setInputText(prev => {
        const prefix = prev.length > 0 && !prev.endsWith(' ') ? prev + ' ' : prev
        return prefix + '@' + detail.filePath + ' '
      })
      textareaRef.current?.focus()
    }
    window.addEventListener('claude-add-file', handler)
    return () => window.removeEventListener('claude-add-file', handler)
  }, [projectPath])

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

  // Drain message queue when Claude finishes responding.
  // Wait for lastEntryType=assistant (response is in store) + idle status,
  // with a short delay so the UI settles before sending the next message.
  useEffect(() => {
    if (messageQueue.length === 0) return
    if (claudeStatus !== 'idle') return
    if (sendingQueueRef.current) return

    const timeout = setTimeout(() => {
      sendingQueueRef.current = true
      const next = messageQueue[0]
      setMessageQueue(q => q.slice(1))
      setPendingUserMessage(next)

      ;(async () => {
        await window.api.terminal.write(terminalId, next)
        await new Promise(r => setTimeout(r, 50))
        await window.api.terminal.write(terminalId, '\r')
        sendingQueueRef.current = false
      })()
    }, 300)

    return () => clearTimeout(timeout)
  }, [claudeStatus, messageQueue, terminalId])

  // Search: compute matching message indices
  const searchMatches = useMemo(() => {
    if (!searchQuery) return []
    const q = searchQuery.toLowerCase()
    const indices: number[] = []
    messages.forEach((msg, i) => {
      if (msg.type === 'text' && (msg as UITextMessage).content.toLowerCase().includes(q)) {
        indices.push(i)
      } else if (msg.type === 'tool_use' && (msg as UIToolUseMessage).toolName.toLowerCase().includes(q)) {
        indices.push(i)
      } else if (msg.type === 'tool_result' && (msg as UIToolResultMessage).content.toLowerCase().includes(q)) {
        indices.push(i)
      }
    })
    return indices
  }, [messages, searchQuery])

  // Build a set of matching message IDs for fast lookup
  const searchMatchIds = useMemo(() => {
    const set = new Set<string>()
    searchMatches.forEach(i => set.add(messages[i].id))
    return set
  }, [searchMatches, messages])

  const currentMatchMsgId = searchMatches.length > 0 ? messages[searchMatches[currentMatchIndex]]?.id : null

  // Clamp currentMatchIndex when matches change
  useEffect(() => {
    if (searchMatches.length > 0 && currentMatchIndex >= searchMatches.length) {
      setCurrentMatchIndex(searchMatches.length - 1)
    }
  }, [searchMatches, currentMatchIndex])

  // Scroll to current match
  useEffect(() => {
    if (!currentMatchMsgId || !listRef.current) return
    const el = listRef.current.querySelector(`[data-msg-id="${currentMatchMsgId}"]`)
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [currentMatchMsgId])

  // Ensure matched message is within visible range
  useEffect(() => {
    if (searchMatches.length === 0) return
    const absIdx = searchMatches[currentMatchIndex]
    if (absIdx !== undefined) {
      const startIdx = Math.max(0, messages.length - visibleCount)
      if (absIdx < startIdx) {
        setVisibleCount(messages.length - absIdx + MESSAGES_PER_PAGE)
      }
    }
  }, [currentMatchIndex, searchMatches, messages.length, visibleCount])

  // Ctrl+F handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setSearchOpen(true)
        setTimeout(() => searchInputRef.current?.focus(), 0)
      }
      if (e.key === 'Escape' && searchOpen) {
        setSearchOpen(false)
        setSearchQuery('')
        setCurrentMatchIndex(0)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [searchOpen])

  const handleSearchNext = useCallback(() => {
    if (searchMatches.length === 0) return
    setCurrentMatchIndex(i => (i + 1) % searchMatches.length)
  }, [searchMatches.length])

  const handleSearchPrev = useCallback(() => {
    if (searchMatches.length === 0) return
    setCurrentMatchIndex(i => (i - 1 + searchMatches.length) % searchMatches.length)
  }, [searchMatches.length])

  // Track whether user has scrolled away from bottom
  const userScrolledUpRef = useRef(false)
  const prevClaudeStatusRef = useRef(claudeStatus)

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const handleScroll = () => {
      // Consider "at bottom" if within 80px of the bottom
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      userScrolledUpRef.current = !atBottom
    }
    el.addEventListener('scroll', handleScroll)
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  // When Claude finishes (running -> idle), jump to bottom
  useEffect(() => {
    if (prevClaudeStatusRef.current === 'running' && claudeStatus === 'idle') {
      userScrolledUpRef.current = false
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight
      }
    }
    prevClaudeStatusRef.current = claudeStatus
  }, [claudeStatus])

  // Auto-scroll to bottom only when user hasn't scrolled up (and search is not active)
  useEffect(() => {
    if (searchOpen && searchQuery) return
    if (userScrolledUpRef.current) return
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, messageQueue, pendingUserMessage, searchOpen, searchQuery])

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
        setPendingUserMessage(null)
        setMessageQueue([])
      }
      // Intercept /model — defer to next message send
      if (text.startsWith('/model ')) {
        const modelId = text.slice(7).trim()
        if (modelId) {
          setClaudeModel(terminalId, modelId)
          pendingModelRef.current = modelId
          return
        }
      }
    } else if (claudeStatus === 'running') {
      // Claude is busy — queue the message
      setMessageQueue(q => [...q, text])
      return
    } else {
      // Optimistic: show user message immediately before session file catches up
      setPendingUserMessage(text)
    }

    // Apply pending model switch before sending the message
    if (pendingModelRef.current) {
      await window.api.terminal.write(terminalId, `/model ${pendingModelRef.current}`)
      await new Promise(r => setTimeout(r, 50))
      await window.api.terminal.write(terminalId, '\r')
      pendingModelRef.current = null
      await new Promise(r => setTimeout(r, 200))
    }

    await window.api.terminal.write(terminalId, text)
    await new Promise(r => setTimeout(r, 50))
    await window.api.terminal.write(terminalId, '\r')
  }, [inputText, terminalId, claudeStatus, setClaudeModel])

  const handleToggleMode = useCallback(async () => {
    // Send Shift+Tab escape sequence to the Claude CLI PTY
    await window.api.terminal.write(terminalId, '\x1b[Z')
    toggleClaudeMode(terminalId)
  }, [terminalId, toggleClaudeMode])

  const pendingModelRef = useRef<string | null>(null)

  const handleModelChange = useCallback((modelId: string) => {
    setClaudeModel(terminalId, modelId)
    setModelPickerOpen(false)
    // Defer the /model command until the next message is sent
    pendingModelRef.current = modelId
  }, [terminalId, setClaudeModel])

  const handleFilePickerSelect = useCallback((filePath: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const cursor = ta.selectionStart
    const text = inputText
    // Find the @ that triggered this picker (search backwards from cursor)
    let atPos = -1
    for (let i = cursor - 1; i >= 0; i--) {
      if (text[i] === '@') { atPos = i; break }
      if (text[i] === ' ' || text[i] === '\n') break
    }
    if (atPos < 0) atPos = text.lastIndexOf('@')
    if (atPos < 0) return

    const before = text.slice(0, atPos)
    const after = text.slice(cursor)
    const newText = before + '@' + filePath + ' ' + after
    setInputText(newText)
    setFilePickerOpen(false)
    setFilePickerFilter('')
    setFilePickerIndex(0)
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        const pos = before.length + 1 + filePath.length + 1
        textareaRef.current.setSelectionRange(pos, pos)
      }
    }, 0)
  }, [inputText])

  // ESC interrupt tracking: 3 presses in insert mode, 2 in normal mode
  const escCountRef = useRef(0)
  const lastEscTimeRef = useRef(0)
  const escThresholdRef = useRef(3)

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ESC interrupt: track consecutive ESC presses to interrupt Claude
    if (e.key === 'Escape' && claudeStatus === 'running') {
      const now = Date.now()
      if (now - lastEscTimeRef.current > 1500) {
        // Start new sequence — set threshold based on current mode
        escCountRef.current = 0
        escThresholdRef.current = (vimChatEnabled && vim.mode === 'normal') ? 2 : 3
      }
      escCountRef.current++
      lastEscTimeRef.current = now

      if (escCountRef.current >= escThresholdRef.current) {
        e.preventDefault()
        escCountRef.current = 0
        // Send ESC twice to interrupt Claude (native Claude CLI interrupt)
        window.api.terminal.write(terminalId, '\x1b')
        window.api.terminal.write(terminalId, '\x1b')
        return
      }
    } else if (e.key !== 'Escape') {
      // Reset ESC counter on any non-ESC key
      escCountRef.current = 0
    }

    // Vim mode handling (runs first — consumes keys in normal/visual mode)
    if (vim.handleKeyDown(e)) return

    // File picker keyboard nav
    if (filePickerOpen && filteredPickerFiles.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setFilePickerIndex(i => Math.min(i + 1, filteredPickerFiles.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setFilePickerIndex(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault()
        handleFilePickerSelect(filteredPickerFiles[filePickerIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setFilePickerOpen(false)
        return
      }
    }

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
  }, [handleSend, handleToggleMode, inputText, filePickerOpen, filteredPickerFiles, filePickerIndex, handleFilePickerSelect, vim, claudeStatus, vimChatEnabled, terminalId])

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

    // @ file picker detection — find @ before cursor with no space after it
    const cursor = e.target.selectionStart
    let atPos = -1
    for (let i = cursor - 1; i >= 0; i--) {
      if (val[i] === '@') { atPos = i; break }
      if (val[i] === ' ' || val[i] === '\n') break
    }
    if (atPos >= 0) {
      const query = val.slice(atPos + 1, cursor)
      setFilePickerFilter(query)
      setFilePickerOpen(true)
      setFilePickerIndex(0)
    } else {
      setFilePickerOpen(false)
      setFilePickerFilter('')
    }

    // Auto-resize
    const el = e.target
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }, [])

  // Drag-and-drop file handling — insert dropped files as @filepath references
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) {
      setDragOver(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setDragOver(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current = 0
    setDragOver(false)

    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    const paths: string[] = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i] as any
      // Electron provides the full path via file.path
      const filePath = file.path as string | undefined
      if (filePath) {
        // Make path relative to project if it's inside the project
        const relativePath = filePath.startsWith(projectPath + '/')
          ? filePath.slice(projectPath.length + 1)
          : filePath
        paths.push(relativePath)
      }
    }

    if (paths.length > 0) {
      setInputText(prev => {
        const prefix = prev.length > 0 && !prev.endsWith(' ') ? prev + ' ' : prev
        return prefix + paths.map(p => '@' + p).join(' ') + ' '
      })
      textareaRef.current?.focus()
    }
  }, [projectPath])

  return (
    <div
      className={`chat-view${dragOver ? ' drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Search bar */}
      {searchOpen && (
        <div className="chat-search-bar">
          <svg className="chat-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/>
            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            ref={searchInputRef}
            className="chat-search-input"
            type="text"
            placeholder="Search messages..."
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setCurrentMatchIndex(0) }}
            onKeyDown={e => {
              if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); handleSearchPrev() }
              else if (e.key === 'Enter') { e.preventDefault(); handleSearchNext() }
              else if (e.key === 'Escape') { e.preventDefault(); setSearchOpen(false); setSearchQuery(''); setCurrentMatchIndex(0) }
            }}
          />
          {searchQuery && (
            <span className="chat-search-count">
              {searchMatches.length > 0 ? `${currentMatchIndex + 1}/${searchMatches.length}` : 'No results'}
            </span>
          )}
          <button className="chat-search-nav" onClick={handleSearchPrev} disabled={searchMatches.length === 0} title="Previous (Shift+Enter)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
          </button>
          <button className="chat-search-nav" onClick={handleSearchNext} disabled={searchMatches.length === 0} title="Next (Enter)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <button className="chat-search-close" onClick={() => { setSearchOpen(false); setSearchQuery(''); setCurrentMatchIndex(0) }} title="Close (Esc)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      )}
      <div className="chat-view-messages" ref={listRef}>
        <div className="messages-container">
          {messages.length > visibleCount && (
            <button
              className="btn-load-more"
              onClick={() => {
                const scrollEl = listRef.current
                const prevHeight = scrollEl?.scrollHeight ?? 0
                setVisibleCount(c => Math.min(c + MESSAGES_PER_PAGE, messages.length))
                // Preserve scroll position after loading older messages
                requestAnimationFrame(() => {
                  if (scrollEl) {
                    scrollEl.scrollTop += scrollEl.scrollHeight - prevHeight
                  }
                })
              }}
            >
              Show {Math.min(MESSAGES_PER_PAGE, messages.length - visibleCount)} earlier messages
            </button>
          )}
          {messages.length === 0 ? null : (
            messages.slice(Math.max(0, messages.length - visibleCount)).map((msg, _i, sliced) => {
              // Compute absolute index for lookups within the full messages array
              const absIdx = messages.length - sliced.length + _i
              const isMatch = searchMatchIds.has(msg.id)
              const isCurrent = msg.id === currentMatchMsgId
              const matchClass = isMatch ? (isCurrent ? ' search-match search-match-current' : ' search-match') : ''
              if (msg.type === 'text') {
                return (
                  <div key={msg.id} data-msg-id={msg.id} className={matchClass}>
                    <MessageBubble message={msg as UITextMessage} searchQuery={searchOpen ? searchQuery : ''} />
                  </div>
                )
              } else if (msg.type === 'tool_use') {
                const toolMsg = msg as UIToolUseMessage
                if (toolMsg.toolName === 'AskUserQuestion') {
                  const hasResult = messages.slice(absIdx + 1).some(
                    m => m.type === 'tool_result' && (m as UIToolResultMessage).toolUseId === toolMsg.toolId
                  )
                  return <div key={msg.id} data-msg-id={msg.id} className={matchClass}><AskUserQuestionBlock message={toolMsg} terminalId={terminalId} answered={hasResult} /></div>
                }
                if (isFileEditTool(toolMsg.toolName)) {
                  const pairedResult = messages.find(
                    m => m.type === 'tool_result' && (m as UIToolResultMessage).toolUseId === toolMsg.toolId
                  ) as UIToolResultMessage | undefined
                  return <div key={msg.id} data-msg-id={msg.id} className={matchClass}><FileEditBlock message={toolMsg} result={pairedResult || null} /></div>
                }
                return <div key={msg.id} data-msg-id={msg.id} className={matchClass}><ToolUseBlock message={toolMsg} /></div>
              } else if (msg.type === 'tool_result') {
                const resultMsg = msg as UIToolResultMessage
                const parentTool = messages.find(
                  m => m.type === 'tool_use' && (m as UIToolUseMessage).toolId === resultMsg.toolUseId
                ) as UIToolUseMessage | undefined
                if (parentTool?.toolName === 'AskUserQuestion') return null
                if (parentTool && isFileEditTool(parentTool.toolName)) return null
                return <div key={msg.id} data-msg-id={msg.id} className={matchClass}><ToolResultBlock message={resultMsg} /></div>
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

        </div>
      </div>
      <div className="chat-view-input-wrapper">
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

        {/* Queued messages */}
        {messageQueue.length > 0 && (
          <div className="message-queue">
            <span className="message-queue-label">Queued</span>
            {messageQueue.map((text, i) => (
              <div key={i} className="message-queue-item">
                <span className="message-queue-text">{text}</span>
                <button
                  className="message-queue-remove"
                  onClick={() => setMessageQueue(q => q.filter((_, j) => j !== i))}
                  title="Remove from queue"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
        {/* @ file picker */}
        {filePickerOpen && filteredPickerFiles.length > 0 && (
          <div className="file-picker-menu">
            {filteredPickerFiles.map((f, i) => {
              const parts = f.split('/')
              const fileName = parts.pop()!
              const dir = parts.length > 0 ? parts.join('/') + '/' : ''
              return (
                <button
                  key={f}
                  className={`file-picker-item ${i === filePickerIndex ? 'active' : ''}`}
                  onMouseDown={(e) => { e.preventDefault(); handleFilePickerSelect(f) }}
                  onMouseEnter={() => setFilePickerIndex(i)}
                >
                  <span className="file-picker-icon">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                  </span>
                  <span className="file-picker-name">{fileName}</span>
                  {dir && <span className="file-picker-dir">{dir}</span>}
                </button>
              )
            })}
          </div>
        )}

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

        <div className="input-bar">
          <div className="textarea-wrapper" style={{ position: 'relative', flex: 1 }}>
            <div className="input-highlight-overlay" aria-hidden="true">
              {inputText ? renderHighlightedInput(inputText) : <span className="input-highlight-placeholder">Ask for follow-up changes... (/ for commands)</span>}
            </div>
            <textarea
              ref={textareaRef}
              className={`input-textarea${vimChatEnabled && vim.mode !== 'insert' ? ' vim-normal' : ''}${inputText ? ' has-content' : ''}`}
              placeholder="Ask for follow-up changes... (/ for commands)"
              value={inputText}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              onBlur={() => { setTimeout(() => setSlashMenuOpen(false), 150) }}
              rows={2}
            />
            {vimChatEnabled && vim.mode !== 'insert' && (
              <VimBlockCursor textareaRef={textareaRef} text={inputText} />
            )}
          </div>
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
              {vimChatEnabled && (
                <div className="vim-mode-indicator">
                  {vim.mode === 'normal' ? 'NORMAL' : vim.mode === 'visual' ? 'VISUAL' : 'INSERT'}
                </div>
              )}
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
