import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { UIMessage, UITextMessage, UIToolUseMessage, UIToolResultMessage, UIThinkingMessage } from '../../stores/sessionStore'
import { useSessionStore } from '../../stores/sessionStore'
import MessageBubble from './MessageBubble'
import ToolUseBlock from './ToolUseBlock'
import ToolResultBlock from './ToolResultBlock'
import AskUserQuestionBlock from './AskUserQuestionBlock'
import FileEditBlock, { isFileEditTool } from './FileEditBlock'
import ToolCallGroup from './ToolCallGroup'
import PlanModeBlock from './PlanModeBlock'
import TodoBlock from './TodoBlock'
import ThinkingBlock from './ThinkingBlock'
import VoiceButton from '../common/VoiceButton'
import WorktreeBar from './WorktreeBar'
import { useProjectStore } from '../../stores/projectStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useVimMode } from '../../hooks/useVimMode'
import { useAgent } from '../../hooks/useAgent'

interface ChatViewProps {
  sessionId: string
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

export default function ChatView({ sessionId, projectPath }: ChatViewProps) {
  const [inputText, setInputText] = useState('')
  const [modelPickerOpen, setModelPickerOpen] = useState(false)
  const [planMode, setPlanMode] = useState(false)
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
  const skipPermissions = useSettingsStore(s => s.claude.dangerouslySkipPermissions)
  const vimChatEnabled = useSettingsStore(s => s.vimChatMode)
  const inputTextRef = useRef(inputText)
  inputTextRef.current = inputText
  const getInputText = useCallback(() => inputTextRef.current, [])
  const vim = useVimMode(textareaRef, getInputText, setInputText, vimChatEnabled)

  // SDK agent hook
  const { sendMessage, startNewSession, stopAgent, isProcessing, isStreaming } = useAgent(sessionId)

  // Read session data from stores
  const messages = useSessionStore(s => s.sessions[sessionId]?.messages ?? EMPTY_MESSAGES)
  const session = useSessionStore(s => s.sessions[sessionId])
  const detectedModel = session?.model ?? null
  const selectedModel = session?.selectedModel ?? 'claude-opus-4-6'
  const thinkingText = useSessionStore(s => s.thinkingText[sessionId] ?? null)
  const streamingThinkingText = useSessionStore(s => s.streamingThinkingText[sessionId] ?? null)
  const streamingThinkingComplete = useSessionStore(s => s.streamingThinkingComplete[sessionId] ?? false)

  const gitBranch = useProjectStore(s => s.gitBranches[projectPath] ?? null)
  const isWorktreeThread = session?.isWorktree ?? false
  const [worktreeMode, setWorktreeMode] = useState<'local' | 'worktree'>('local')
  const [worktreeDropdownOpen, setWorktreeDropdownOpen] = useState(false)
  const [branchPickerOpen, setBranchPickerOpen] = useState(false)
  const [branchList, setBranchList] = useState<string[]>([])
  const [branchSwitching, setBranchSwitching] = useState(false)
  const [branchFilter, setBranchFilter] = useState('')
  const branchFilterRef = useRef<HTMLInputElement>(null)
  const [worktreeLocked, setWorktreeLocked] = useState(false)
  const [messageQueue, setMessageQueue] = useState<string[]>([])
  const sendingQueueRef = useRef(false)

  // Resolve the display model: selected > detected > fallback
  const displayModel = selectedModel || detectedModel || 'claude-opus-4-6'

  // Show thinking only when processing
  const isThinking = isProcessing && !isStreaming

  // Branch picker: load branches when opened
  const setGitBranch = useProjectStore(s => s.setGitBranch)

  const openBranchPicker = useCallback(async () => {
    const result = await window.api.project.gitBranches(projectPath)
    if (result.success && result.branches) {
      setBranchList(result.branches)
    }
    setBranchFilter('')
    setBranchPickerOpen(true)
    setTimeout(() => branchFilterRef.current?.focus(), 50)
  }, [projectPath])

  const handleBranchSwitch = useCallback(async (branch: string) => {
    if (branch === gitBranch) {
      setBranchPickerOpen(false)
      return
    }
    setBranchSwitching(true)
    const result = await window.api.project.gitCheckout(projectPath, branch)
    if (result.success) {
      setGitBranch(projectPath, branch)
    }
    setBranchSwitching(false)
    setBranchPickerOpen(false)
  }, [projectPath, gitBranch, setGitBranch])

  // Close branch picker on outside click
  useEffect(() => {
    if (!branchPickerOpen) return
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (!target.closest('.branch-picker')) {
        setBranchPickerOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [branchPickerOpen])

  const filteredBranches = useMemo(() => {
    if (!branchFilter.trim()) return branchList
    const q = branchFilter.toLowerCase()
    return branchList.filter(b => b.toLowerCase().includes(q))
  }, [branchList, branchFilter])

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
    const id = setTimeout(() => document.addEventListener('click', handler), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('click', handler)
    }
  }, [modelPickerOpen])

  // Close worktree dropdown on outside click
  useEffect(() => {
    if (!worktreeDropdownOpen) return
    const handler = () => setWorktreeDropdownOpen(false)
    const id = setTimeout(() => document.addEventListener('click', handler), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('click', handler)
    }
  }, [worktreeDropdownOpen])

  // Reset transient input state when sessionId changes
  useEffect(() => {
    setInputText('')
    setMessageQueue([])
    sendingQueueRef.current = false
    historyIndexRef.current = -1
    setFilePickerOpen(false)
    filePickerLoadedRef.current = null
    setVisibleCount(MESSAGES_PER_PAGE)
    vim.resetToInsert()
    if (isWorktreeThread) {
      setWorktreeMode('worktree')
      setWorktreeLocked(true)
    } else {
      setWorktreeMode('local')
      setWorktreeLocked(false)
    }
    setWorktreeDropdownOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

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

  // Drain message queue when agent finishes processing
  useEffect(() => {
    if (messageQueue.length === 0) return
    if (isProcessing) return
    if (sendingQueueRef.current) return

    const timeout = setTimeout(() => {
      sendingQueueRef.current = true
      const next = messageQueue[0]
      setMessageQueue(q => q.slice(1))

      ;(async () => {
        await sendMessage(next)
        sendingQueueRef.current = false
      })()
    }, 300)

    return () => clearTimeout(timeout)
  }, [isProcessing, messageQueue, sendMessage])

  // Pre-computed lookup maps to avoid O(n²) scans in the render loop
  const toolUseById = useMemo(() => {
    const map = new Map<string, UIToolUseMessage>()
    messages.forEach(m => { if (m.type === 'tool_use') map.set((m as UIToolUseMessage).toolId, m as UIToolUseMessage) })
    return map
  }, [messages])

  const toolResultByToolUseId = useMemo(() => {
    const map = new Map<string, UIToolResultMessage>()
    messages.forEach(m => { if (m.type === 'tool_result') map.set((m as UIToolResultMessage).toolUseId, m as UIToolResultMessage) })
    return map
  }, [messages])

  // Find the latest TodoWrite message for highlighting + pinned display
  const latestTodoMessage = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.type === 'tool_use' && (m as UIToolUseMessage).toolName === 'TodoWrite') return m as UIToolUseMessage
    }
    return null
  }, [messages])
  const latestTodoId = latestTodoMessage?.id ?? null

  // Pre-process messages into render items: groups of completed tool calls + standalone items
  type RenderItem =
    | { kind: 'single'; index: number; msg: UIMessage }
    | { kind: 'group'; indices: number[]; toolNames: string[]; msgs: UIMessage[] }

  const renderItems = useMemo<RenderItem[]>(() => {
    const items: RenderItem[] = []
    let i = 0
    while (i < messages.length) {
      const msg = messages[i]
      if (msg.type === 'tool_use') {
        const toolMsg = msg as UIToolUseMessage
        const NON_GROUPABLE = ['AskUserQuestion', 'ExitPlanMode', 'TodoWrite']
        const isGroupable = !NON_GROUPABLE.includes(toolMsg.toolName)
        const hasResult = toolResultByToolUseId.has(toolMsg.toolId)
        if (isGroupable && hasResult) {
          const groupIndices: number[] = []
          const groupMsgs: UIMessage[] = []
          const groupToolNames: string[] = []
          let j = i
          while (j < messages.length) {
            const m = messages[j]
            if (m.type === 'tool_use') {
              const tm = m as UIToolUseMessage
              const gr = !NON_GROUPABLE.includes(tm.toolName)
              const hr = toolResultByToolUseId.has(tm.toolId)
              if (gr && hr) {
                groupIndices.push(j)
                groupMsgs.push(m)
                groupToolNames.push(tm.toolName)
                j++
                if (j < messages.length && messages[j].type === 'tool_result') {
                  groupIndices.push(j)
                  groupMsgs.push(messages[j])
                  j++
                }
                continue
              }
            }
            break
          }
          if (groupToolNames.length > 1) {
            items.push({ kind: 'group', indices: groupIndices, toolNames: groupToolNames, msgs: groupMsgs })
          } else {
            for (const idx of groupIndices) {
              items.push({ kind: 'single', index: idx, msg: messages[idx] })
            }
          }
          i = j
          continue
        }
      }
      items.push({ kind: 'single', index: i, msg: messages[i] })
      i++
    }
    return items
  }, [messages, toolResultByToolUseId])

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

  const searchMatchIds = useMemo(() => {
    const set = new Set<string>()
    searchMatches.forEach(i => set.add(messages[i].id))
    return set
  }, [searchMatches, messages])

  const currentMatchMsgId = searchMatches.length > 0 ? messages[searchMatches[currentMatchIndex]]?.id : null

  useEffect(() => {
    if (searchMatches.length > 0 && currentMatchIndex >= searchMatches.length) {
      setCurrentMatchIndex(searchMatches.length - 1)
    }
  }, [searchMatches, currentMatchIndex])

  useEffect(() => {
    if (!currentMatchMsgId || !listRef.current) return
    const el = listRef.current.querySelector(`[data-msg-id="${currentMatchMsgId}"]`)
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [currentMatchMsgId])

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
  const prevProcessingRef = useRef(isProcessing)

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const handleScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      userScrolledUpRef.current = !atBottom
    }
    el.addEventListener('scroll', handleScroll)
    return () => el.removeEventListener('scroll', handleScroll)
  }, [])

  // When agent finishes processing, jump to bottom
  useEffect(() => {
    if (prevProcessingRef.current && !isProcessing) {
      userScrolledUpRef.current = false
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight
      }
    }
    prevProcessingRef.current = isProcessing
  }, [isProcessing])

  // Auto-scroll to bottom only when user hasn't scrolled up
  useEffect(() => {
    if (searchOpen && searchQuery) return
    if (userScrolledUpRef.current) return
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [messages, messageQueue, searchOpen, searchQuery])

  const handleSend = useCallback(async () => {
    let text = inputText.trim()
    if (!text) return

    // Prepend plan mode instruction if toggled
    if (planMode) {
      text = `Plan first before implementing. Use EnterPlanMode to explore the codebase and design an approach, then present your plan for my approval before writing any code.\n\n${text}`
      setPlanMode(false)
    }

    // On first real message: if worktree mode selected, use worktree
    if (!worktreeLocked && worktreeMode === 'worktree') {
      setWorktreeLocked(true)

      // Add to history
      historyRef.current.push(text)
      historyIndexRef.current = -1
      savedInputRef.current = ''

      setInputText('')
      if (textareaRef.current) textareaRef.current.style.height = 'auto'

      // Start a new session with worktree
      const newId = await startNewSession(text, { useWorktree: true })
      if (!newId) {
        setWorktreeLocked(false)
      }
      return
    }

    // Lock the dropdown after first message
    if (!worktreeLocked) {
      setWorktreeLocked(true)
    }

    // Add to history
    historyRef.current.push(text)
    historyIndexRef.current = -1
    savedInputRef.current = ''

    setInputText('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    if (isProcessing) {
      // Agent is busy — queue the message
      setMessageQueue(q => [...q, text])
      return
    }

    // Check if session has had a first turn — if not, start new; else send follow-up
    const sessionState = useSessionStore.getState().sessions[sessionId]
    if (!sessionState || sessionState.messages.length === 0) {
      // First message — start the agent
      await startNewSession(text)
    } else {
      // Follow-up message
      await sendMessage(text)
    }
  }, [inputText, sessionId, isProcessing, worktreeMode, worktreeLocked, startNewSession, sendMessage])

  const handleModelChange = useCallback((modelId: string) => {
    setModelPickerOpen(false)
    useSessionStore.getState().setSelectedModel(sessionId, modelId)
    // Also tell the backend
    window.api.agent.setModel(sessionId, modelId)
  }, [sessionId])

  const handleFilePickerSelect = useCallback((filePath: string) => {
    const ta = textareaRef.current
    if (!ta) return
    const cursor = ta.selectionStart
    const text = inputText
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

  // ESC interrupt tracking
  const escCountRef = useRef(0)
  const lastEscTimeRef = useRef(0)
  const escThresholdRef = useRef(3)

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ESC interrupt: track consecutive ESC presses to stop agent
    if (e.key === 'Escape' && isProcessing) {
      const now = Date.now()
      if (now - lastEscTimeRef.current > 1500) {
        escCountRef.current = 0
        escThresholdRef.current = (vimChatEnabled && vim.mode === 'normal') ? 2 : 3
      }
      escCountRef.current++
      lastEscTimeRef.current = now

      if (escCountRef.current >= escThresholdRef.current) {
        e.preventDefault()
        escCountRef.current = 0
        stopAgent()
        return
      }
    } else if (e.key !== 'Escape') {
      escCountRef.current = 0
    }

    // Vim mode handling
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
        historyIndexRef.current = -1
        setInputText(savedInputRef.current)
      }
    }
  }, [handleSend, inputText, filePickerOpen, filteredPickerFiles, filePickerIndex, handleFilePickerSelect, vim, isProcessing, vimChatEnabled, stopAgent])

  const handleVoiceTranscript = useCallback((text: string) => {
    setInputText(prev => prev + text)
    if (textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [])

  const [screenshotCapturing, setScreenshotCapturing] = useState(false)
  const handleScreenshot = useCallback(async () => {
    setScreenshotCapturing(true)
    try {
      const result = await window.api.screenshot.capture()
      if (result.success && result.path) {
        setInputText(prev => {
          const prefix = prev.length > 0 && !prev.endsWith(' ') ? prev + ' ' : prev
          return prefix + '@' + result.path + ' '
        })
        if (textareaRef.current) {
          textareaRef.current.focus()
          requestAnimationFrame(() => {
            if (textareaRef.current) {
              textareaRef.current.style.height = 'auto'
              textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
            }
          })
        }
      }
    } finally {
      setScreenshotCapturing(false)
    }
  }, [])

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInputText(val)
    historyIndexRef.current = -1

    // @ file picker detection
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
    el.style.height = el.scrollHeight + 'px'
  }, [])

  // Drag-and-drop file handling
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
      const file = files[i]
      const filePath = window.api.utils.getPathForFile(file)
      if (filePath) {
        const relativePath = filePath.startsWith(projectPath + '/')
          ? filePath.slice(projectPath.length + 1)
          : filePath
        paths.push(relativePath)
      } else if (file.name) {
        paths.push(file.name)
      }
    }

    if (paths.length > 0) {
      const refs = paths.map(p => '@' + p).join(' ')
      setInputText(prev => {
        const prefix = prev.length > 0 && !prev.endsWith(' ') ? prev + ' ' : prev
        return prefix + refs + ' '
      })
      if (textareaRef.current) {
        textareaRef.current.focus()
        requestAnimationFrame(() => {
          if (textareaRef.current) {
            textareaRef.current.style.height = 'auto'
            textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
          }
        })
      }
    }
  }, [projectPath])

  const renderSingleMessage = useCallback((msg: UIMessage, absIdx: number) => {
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
        const hasResult = toolResultByToolUseId.has(toolMsg.toolId)
        return <div key={msg.id} data-msg-id={msg.id} className={matchClass}><AskUserQuestionBlock message={toolMsg} sessionId={sessionId} answered={hasResult} /></div>
      }
      if (toolMsg.toolName === 'ExitPlanMode') {
        const hasResult = toolResultByToolUseId.has(toolMsg.toolId)
        return <div key={msg.id} data-msg-id={msg.id} className={matchClass}><PlanModeBlock message={toolMsg} sessionId={sessionId} answered={hasResult} /></div>
      }
      if (toolMsg.toolName === 'TodoWrite') {
        return <div key={msg.id} data-msg-id={msg.id} className={matchClass}><TodoBlock message={toolMsg} isLatest={msg.id === latestTodoId} /></div>
      }
      if (isFileEditTool(toolMsg.toolName)) {
        const pairedResult = toolResultByToolUseId.get(toolMsg.toolId)
        const hasResult = !!pairedResult
        const isLast = absIdx === messages.length - 1 || !messages.slice(absIdx + 1).some(m => m.type === 'tool_use' || m.type === 'tool_result')
        const needsPermission = !skipPermissions && !hasResult && isLast
        return <div key={msg.id} data-msg-id={msg.id} className={matchClass}><FileEditBlock message={toolMsg} result={pairedResult ?? null} awaitingPermission={needsPermission} terminalId={sessionId} /></div>
      }
      const hasToolResult = toolResultByToolUseId.has(toolMsg.toolId)
      const isLastToolUse = absIdx === messages.length - 1 || !messages.slice(absIdx + 1).some(m => m.type === 'tool_use' || m.type === 'tool_result')
      const awaitingPermission = !skipPermissions && !hasToolResult && isLastToolUse
      return <div key={msg.id} data-msg-id={msg.id} className={matchClass}><ToolUseBlock message={toolMsg} awaitingPermission={awaitingPermission} terminalId={sessionId} /></div>
    } else if (msg.type === 'tool_result') {
      const resultMsg = msg as UIToolResultMessage
      const parentTool = toolUseById.get(resultMsg.toolUseId)
      if (parentTool?.toolName === 'AskUserQuestion') return null
      if (parentTool?.toolName === 'ExitPlanMode') return null
      if (parentTool?.toolName === 'TodoWrite') return null
      if (parentTool && isFileEditTool(parentTool.toolName)) return null
      return <div key={msg.id} data-msg-id={msg.id} className={matchClass}><ToolResultBlock message={resultMsg} /></div>
    } else if (msg.type === 'thinking') {
      return (
        <div key={msg.id} data-msg-id={msg.id}>
          <ThinkingBlock
            text={(msg as UIThinkingMessage).content}
            isStreaming={false}
            isComplete={true}
            defaultExpanded={false}
          />
        </div>
      )
    } else if (msg.type === 'system') {
      return (
        <div key={msg.id} data-msg-id={msg.id} className={`system-message${matchClass}`}>
          <span className="system-message-text">{msg.content}</span>
        </div>
      )
    }
    return null
  }, [messages, searchMatchIds, currentMatchMsgId, searchOpen, searchQuery, toolResultByToolUseId, toolUseById, skipPermissions, sessionId])

  return (
    <div
      className={`chat-view${dragOver ? ' drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Worktree action bar */}
      <WorktreeBar sessionId={sessionId} projectPath={projectPath} />

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
          {renderItems.length === 0 ? null : (
            renderItems.map((item, itemIdx) => {
              if (item.kind === 'group') {
                const startIdx = Math.max(0, messages.length - visibleCount)
                if (item.indices[item.indices.length - 1] < startIdx) return null
                return (
                  <ToolCallGroup key={`group-${itemIdx}`} toolNames={item.toolNames}>
                    {item.msgs.map(msg => renderSingleMessage(msg, messages.indexOf(msg)))}
                  </ToolCallGroup>
                )
              }
              const { msg, index: absIdx } = item
              const startIdx = Math.max(0, messages.length - visibleCount)
              if (absIdx < startIdx) return null
              return renderSingleMessage(msg, absIdx)
            })
          )}

          {/* Streaming thinking block */}
          {streamingThinkingText !== null && (
            <ThinkingBlock
              text={streamingThinkingText}
              isStreaming={!streamingThinkingComplete}
              isComplete={streamingThinkingComplete}
              defaultExpanded={true}
            />
          )}

          {/* Retry button */}
          {!isProcessing && messages.length > 0 && (() => {
            const lastMsg = messages[messages.length - 1]
            const isAssistantLast = lastMsg.type === 'text' && (lastMsg as UITextMessage).role === 'assistant'
              || lastMsg.type === 'tool_use' || lastMsg.type === 'tool_result'
            if (!isAssistantLast) return null
            const lastUserMsg = [...messages].reverse().find(m => m.type === 'text' && (m as UITextMessage).role === 'user') as UITextMessage | undefined
            if (!lastUserMsg) return null
            return (
              <button
                className="btn-retry"
                onClick={() => {
                  sendMessage(lastUserMsg.content)
                }}
                title="Re-send last message"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="23 4 23 10 17 10"/>
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                </svg>
                Retry
              </button>
            )
          })()}

        </div>
      </div>

      {/* Pinned todo block — sticks above input area */}
      {latestTodoMessage && (() => {
        const todos = (latestTodoMessage.input?.todos as { status: string }[]) || []
        const allDone = todos.length > 0 && todos.every(t => t.status === 'completed')
        if (allDone) return null
        return (
          <div className="pinned-todo-wrapper">
            <TodoBlock message={latestTodoMessage} isLatest={true} />
          </div>
        )
      })()}

      <div className="chat-view-input-wrapper">
        {/* Processing indicator — only shown before thinking starts */}
        {isThinking && streamingThinkingText === null && (
          <div className="thinking-indicator">
            <div className="thinking-dots">
              <span className="thinking-dot" />
              <span className="thinking-dot" />
              <span className="thinking-dot" />
            </div>
            <span className="thinking-label">Processing...</span>
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

        <div className="input-bar">
          <div className="textarea-wrapper">
            <div className="input-highlight-overlay" aria-hidden="true">
              {inputText ? renderHighlightedInput(inputText) : <span className="input-highlight-placeholder">Message Claude... (Enter to send)</span>}
            </div>
            <textarea
              ref={textareaRef}
              className={`input-textarea${vimChatEnabled && vim.mode !== 'insert' ? ' vim-normal' : ''}${inputText ? ' has-content' : ''}`}
              placeholder="Message Claude... (Enter to send)"
              value={inputText}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
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
                className={`btn-plan-mode${planMode ? ' active' : ''}`}
                onClick={() => setPlanMode(p => !p)}
                title={planMode ? 'Plan mode ON — Claude will plan before coding' : 'Plan mode OFF — click to enable'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                </svg>
                Plan
              </button>
            </div>
            <div className="input-actions">
              {vimChatEnabled && (
                <div className="vim-mode-indicator">
                  {vim.mode === 'normal' ? 'NORMAL' : vim.mode === 'visual' ? 'VISUAL' : 'INSERT'}
                </div>
              )}
              <button
                className="btn-screenshot"
                onClick={handleScreenshot}
                disabled={screenshotCapturing}
                title="Take screenshot"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </button>
              <VoiceButton onTranscript={handleVoiceTranscript} inline />
              {isProcessing ? (
                <button
                  className="btn-send btn-stop"
                  onClick={stopAgent}
                  title="Stop (Esc x3)"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
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
              )}
            </div>
          </div>
        </div>

        {/* Context footer */}
        <div className="input-footer">
          <div className="input-footer-left">
            {/* Worktree / Local dropdown */}
            {gitBranch ? (
              <div className="worktree-mode-picker">
                <button
                  className={`worktree-mode-btn ${worktreeLocked ? 'locked' : ''} ${worktreeMode === 'worktree' ? 'mode-worktree' : ''}`}
                  onClick={() => { if (!worktreeLocked) setWorktreeDropdownOpen(!worktreeDropdownOpen) }}
                  disabled={worktreeLocked}
                  title={worktreeLocked
                    ? (isWorktreeThread ? 'Running in worktree' : 'Running locally')
                    : 'Choose where Claude works'}
                >
                  {worktreeMode === 'local' ? 'Local' : 'New Worktree'}
                  {!worktreeLocked && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9"/>
                    </svg>
                  )}
                </button>
                {worktreeDropdownOpen && !worktreeLocked && (
                  <div className="worktree-mode-dropdown">
                    <button
                      className={`worktree-mode-option ${worktreeMode === 'local' ? 'active' : ''}`}
                      onClick={() => { setWorktreeMode('local'); setWorktreeDropdownOpen(false) }}
                    >
                      <strong>Local</strong>
                      <span>Edit files in your checkout directly</span>
                    </button>
                    <button
                      className={`worktree-mode-option ${worktreeMode === 'worktree' ? 'active' : ''}`}
                      onClick={() => { setWorktreeMode('worktree'); setWorktreeDropdownOpen(false) }}
                    >
                      <strong>New Worktree</strong>
                      <span>Isolated copy — your checkout stays untouched</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <span className="input-footer-project" title={projectPath}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
                {projectPath.split('/').pop()}
              </span>
            )}
            {gitBranch && (
              <div className="branch-picker">
                <button
                  className="branch-picker-btn"
                  onClick={openBranchPicker}
                  title={`Branch: ${gitBranch} (click to switch)`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="6" y1="3" x2="6" y2="15" />
                    <circle cx="18" cy="6" r="3" />
                    <circle cx="6" cy="18" r="3" />
                    <path d="M18 9a9 9 0 0 1-9 9" />
                  </svg>
                  {gitBranch}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
                {branchPickerOpen && (
                  <div className="branch-picker-dropdown">
                    <input
                      ref={branchFilterRef}
                      className="branch-picker-search"
                      type="text"
                      placeholder="Filter branches..."
                      value={branchFilter}
                      onChange={e => setBranchFilter(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Escape') setBranchPickerOpen(false)
                        if (e.key === 'Enter' && filteredBranches.length > 0) {
                          handleBranchSwitch(filteredBranches[0])
                        }
                      }}
                    />
                    <div className="branch-picker-list">
                      {filteredBranches.map(b => (
                        <button
                          key={b}
                          className={`branch-picker-option ${b === gitBranch ? 'active' : ''}`}
                          onClick={() => handleBranchSwitch(b)}
                          disabled={branchSwitching}
                        >
                          <span className="branch-picker-option-name">{b}</span>
                          {b === gitBranch && <span className="branch-picker-check">&#10003;</span>}
                        </button>
                      ))}
                      {filteredBranches.length === 0 && (
                        <div className="branch-picker-empty">No matching branches</div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="input-footer-right">
          </div>
        </div>
      </div>
    </div>
  )
}
