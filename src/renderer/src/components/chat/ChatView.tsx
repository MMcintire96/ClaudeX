import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import type { UIMessage, UITextMessage, UIToolUseMessage, UIToolResultMessage, UIThinkingMessage } from '../../stores/sessionStore'
import { useSessionStore } from '../../stores/sessionStore'
import MessageBubble from './MessageBubble'
import ToolUseBlock from './ToolUseBlock'
import ToolResultBlock from './ToolResultBlock'
import AskUserQuestionBlock from './AskUserQuestionBlock'
import FileEditBlock, { isFileEditTool } from './FileEditBlock'
import ToolCallGroup from './ToolCallGroup'
import ReadGroup from './ReadGroup'
import PlanModeBlock from './PlanModeBlock'
import TodoBlock from './TodoBlock'
import ThinkingBlock from './ThinkingBlock'
import VoiceButton from '../common/VoiceButton'
import WorktreeBar from './WorktreeBar'
import KeyMomentsRail from './KeyMomentsRail'
import { useUIStore } from '../../stores/uiStore'
import { useProjectStore } from '../../stores/projectStore'
import { AVAILABLE_MODELS, DEFAULT_MODEL, getModelLabel, getModelEffortLevels } from '../../constants/models'
import type { EffortLevel } from '../../constants/models'
import { useSettingsStore } from '../../stores/settingsStore'
import { useVimMode } from '../../hooks/useVimMode'
import { useAgent } from '../../hooks/useAgent'
import { useAutomationStore } from '../../stores/automationStore'
import { SCRATCH_PROJECT_PATH } from '../../constants/scratch'

interface ChatViewProps {
  sessionId: string
  projectPath: string
  reviewerMode?: boolean
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

const EMPTY_MESSAGES: UIMessage[] = []
const MESSAGES_PER_PAGE = 50

function formatDuration(ms: number): string {
  if (ms < 1000) return '<1s'
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainSec = seconds % 60
  if (minutes < 60) return remainSec > 0 ? `${minutes}m ${remainSec}s` : `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainMin = minutes % 60
  return remainMin > 0 ? `${hours}h ${remainMin}m` : `${hours}h`
}

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']
function isImagePath(p: string): boolean {
  const lower = p.toLowerCase()
  return IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext))
}

// Ephemeral per-session draft storage — survives session switches but not app restarts
type PastedChunk = { id: number; text: string; lineCount: number; charCount: number; source?: 'terminal' }
const sessionDrafts = new Map<string, { text: string; chunks: PastedChunk[]; images?: { path: string; previewUrl: string }[] }>()
let nextChunkId = 1

/** Generate the inline placeholder label for a pasted chunk */
function chunkLabel(c: { lineCount: number; charCount: number; source?: string }): string {
  return c.source === 'terminal'
    ? `[TERMINAL: ${c.lineCount}L, ${c.charCount}C]`
    : `[PASTED TEXT: ${c.lineCount}:${c.charCount}]`
}

// Regex to match paste placeholder labels in input text
const PASTE_LABEL_RE = /\[PASTED TEXT: \d+:\d+\]|\[TERMINAL: \d+L, \d+C\]/g

/** Render input text with @file references and paste placeholders highlighted */
function renderHighlightedInput(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = []
  // Match @file references and paste placeholder labels
  const regex = /@([\w./_-]+\.\w+)|\[PASTED TEXT: \d+:\d+\]|\[TERMINAL: \d+L, \d+C\]/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    if (match[1]) {
      // @file reference
      parts.push(<span key={match.index} className="input-file-ref">{match[0]}</span>)
    } else {
      // Paste placeholder label — same text as textarea for cursor alignment
      parts.push(<span key={match.index} className="input-paste-placeholder">{match[0]}</span>)
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

export default function ChatView({ sessionId, projectPath, reviewerMode }: ChatViewProps) {
  const isAutomationSession = sessionId.startsWith('automation-')
  const currentProjectPath = useProjectStore(s => s.currentPath)
  const effectiveProjectPath = isAutomationSession && currentProjectPath ? currentProjectPath : projectPath
  const isScratchSession = projectPath === SCRATCH_PROJECT_PATH && !isAutomationSession
  const [inputText, setInputText] = useState(() => sessionDrafts.get(sessionId)?.text ?? '')
  const [pastedChunks, setPastedChunks] = useState<PastedChunk[]>(() => sessionDrafts.get(sessionId)?.chunks ?? [])
  const [imageAttachments, setImageAttachments] = useState<{ path: string; previewUrl: string }[]>(() => sessionDrafts.get(sessionId)?.images ?? [])
  const [configPickerOpen, setConfigPickerOpen] = useState(false)
  const [planMode, setPlanMode] = useState(false)
  const [filePickerOpen, setFilePickerOpen] = useState(false)
  const [filePickerFilter, setFilePickerFilter] = useState('')
  const [filePickerFiles, setFilePickerFiles] = useState<string[]>([])
  const [filePickerIndex, setFilePickerIndex] = useState(0)
  const filePickerLoadedRef = useRef<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)
  const dragCounterRef = useRef(0)
  const listRef = useRef<HTMLDivElement>(null)
  const [visibleCount, setVisibleCount] = useState(MESSAGES_PER_PAGE)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Chat zoom (Ctrl+Scroll)
  const chatZoom = useUIStore(s => s.chatZoom)
  const setChatZoom = useUIStore(s => s.setChatZoom)

  // Font & layout settings
  const fontSize = useSettingsStore(s => s.fontSize)
  const fontFamily = useSettingsStore(s => s.fontFamily)
  const lineHeight = useSettingsStore(s => s.lineHeight)
  const compactMessages = useSettingsStore(s => s.compactMessages)
  const modKey = useSettingsStore(s => s.modKey)
  const modLabel = modKey === 'Meta' ? '⌘' : modKey + '+'
  const [zoomVisible, setZoomVisible] = useState(false)
  const zoomTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const delta = e.deltaY > 0 ? -0.05 : 0.05
      setChatZoom(useUIStore.getState().chatZoom + delta)
      setZoomVisible(true)
      if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current)
      zoomTimerRef.current = setTimeout(() => setZoomVisible(false), 1200)
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [setChatZoom])

  // Key moments rail state
  const [keyMomentsOpen, setKeyMomentsOpen] = useState(false)

  // Checkpoint state for revert-to-turn
  const [checkpointTurns, setCheckpointTurns] = useState<number[]>([]) // sorted turn numbers
  const checkpoints = useMemo(() => new Set(checkpointTurns.filter(t => t > 0)), [checkpointTurns])
  const addSystemMessage = useSessionStore(s => s.addSystemMessage)
  const truncateToTurn = useSessionStore(s => s.truncateToTurn)

  // Search state
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Refs for draft persistence across session switches
  const prevSessionIdRef = useRef(sessionId)
  const pastedChunksRef = useRef(pastedChunks)
  pastedChunksRef.current = pastedChunks
  const autoRunPendingRef = useRef(false)
  const imageAttachmentsRef = useRef(imageAttachments)
  imageAttachmentsRef.current = imageAttachments

  // Vim mode for chat input
  const skipPermissions = useSettingsStore(s => s.claude.dangerouslySkipPermissions)
  const vimChatEnabled = useSettingsStore(s => s.vimMode)
  const inputTextRef = useRef(inputText)
  inputTextRef.current = inputText
  const getInputText = useCallback(() => inputTextRef.current, [])
  const vim = useVimMode(textareaRef, getInputText, setInputText, vimChatEnabled)

  const refreshCheckpoints = useCallback(() => {
    if (isScratchSession) return
    window.api.checkpoint.list(sessionId).then(cps => {
      setCheckpointTurns(cps.map(c => c.turnNumber).sort((a, b) => a - b))
    })
  }, [sessionId, isScratchSession])

  // Load checkpoints on mount
  useEffect(() => { refreshCheckpoints() }, [refreshCheckpoints])

  // Listen for file-modification events from the main process, then create checkpoint with correct turn number
  useEffect(() => {
    if (isScratchSession) return
    const unsub = window.api.checkpoint.onFilesModified((data) => {
      if (data.sessionId !== sessionId) return
      const currentMessages = useSessionStore.getState().sessions[sessionId]?.messages
      if (!currentMessages) return
      const uiTurnNumber = currentMessages.filter(m => m.type === 'text' && m.role === 'user').length
      window.api.checkpoint.create({
        sessionId,
        projectPath: data.projectPath,
        filesModified: data.filesModified,
        messageCount: currentMessages.length,
        turnNumber: uiTurnNumber,
        sdkSessionId: data.sdkSessionId
      }).then(() => refreshCheckpoints()).catch(() => {})
    })
    return unsub
  }, [sessionId, isScratchSession, refreshCheckpoints])

  const handleRevert = useCallback(async (turnNumber: number) => {
    if (!sessionId) return

    // "Undo this turn" = revert to the checkpoint BEFORE this turn
    const prevTurn = checkpointTurns.filter(t => t < turnNumber).pop()
    if (prevTurn === undefined) {
      useSessionStore.getState().setError(sessionId, 'No earlier checkpoint to revert to')
      return
    }

    const confirmed = window.confirm(
      `Undo turn ${turnNumber}? File changes and messages from this turn will be reverted.`
    )
    if (!confirmed) return

    // Stop agent if running
    await window.api.agent.stop(sessionId)

    const result = await window.api.checkpoint.revert(sessionId, prevTurn)
    if (!result.success) {
      useSessionStore.getState().setError(sessionId, result.error ?? 'Failed to revert')
      return
    }

    // Truncate messages to the checkpoint's message count
    truncateToTurn(sessionId, result.messageCount ?? 0)

    if (prevTurn > 0) {
      addSystemMessage(sessionId, `Undid turn ${turnNumber} — reverted to turn ${prevTurn}`)
    }

    refreshCheckpoints()

    // Trigger diff panel refresh
    window.dispatchEvent(new CustomEvent('checkpoint-reverted'))
  }, [sessionId, checkpointTurns, truncateToTurn, addSystemMessage, refreshCheckpoints])

  // Listen for undo-turn events from DiffPanel
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { turnNumber: number }
      if (detail?.turnNumber) handleRevert(detail.turnNumber)
    }
    window.addEventListener('checkpoint-undo-turn', handler)
    return () => window.removeEventListener('checkpoint-undo-turn', handler)
  }, [handleRevert])

  // SDK agent hook
  const { sendMessage, startNewSession, stopAgent, forkSession, isProcessing, isStreaming } = useAgent(sessionId)

  // Read session data from stores
  const messages = useSessionStore(s => s.sessions[sessionId]?.messages ?? EMPTY_MESSAGES)
  const session = useSessionStore(s => s.sessions[sessionId])
  const isForkParent = session?.isForkParent ?? false
  const suggestion = session?.suggestion ?? null
  const setSuggestion = useSessionStore(s => s.setSuggestion)
  const detectedModel = session?.model ?? null
  const selectedModel = session?.selectedModel ?? DEFAULT_MODEL
  const selectedEffort = session?.selectedEffort ?? 'high'
  const streamingThinkingText = useSessionStore(s => s.streamingThinkingText[sessionId] ?? null)
  const streamingThinkingComplete = useSessionStore(s => s.streamingThinkingComplete[sessionId] ?? false)

  const gitBranch = useProjectStore(s => s.gitBranches[effectiveProjectPath] ?? null)
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
  const displayModel = selectedModel || detectedModel || DEFAULT_MODEL
  const isCodexModel = displayModel.startsWith('codex-') || displayModel.startsWith('gpt-')
  const effortLevels = getModelEffortLevels(displayModel)
  const assistantLabel = isCodexModel ? 'Codex' : 'Claude'

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
    if (!filePickerOpen || isScratchSession) return
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

  // Close config picker on outside click
  useEffect(() => {
    if (!configPickerOpen) return
    const handler = () => setConfigPickerOpen(false)
    const id = setTimeout(() => document.addEventListener('click', handler), 0)
    return () => {
      clearTimeout(id)
      document.removeEventListener('click', handler)
    }
  }, [configPickerOpen])

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

  // Persist draft to module-level Map on every change so it survives
  // component remounts (ChatView is keyed by sessionId).
  useEffect(() => {
    if (inputText || pastedChunks.length > 0 || imageAttachments.length > 0) {
      sessionDrafts.set(sessionId, { text: inputText, chunks: pastedChunks, images: imageAttachments })
    } else {
      sessionDrafts.delete(sessionId)
    }
  }, [sessionId, inputText, pastedChunks, imageAttachments])

  // Reset transient UI state on mount & auto-resize textarea for restored draft
  useEffect(() => {
    prevSessionIdRef.current = sessionId
    setMessageQueue([])
    sendingQueueRef.current = false
    historyIndexRef.current = -1
    setFilePickerOpen(false)
    filePickerLoadedRef.current = null
    setVisibleCount(MESSAGES_PER_PAGE)
    vim.resetToInsert()
    if (isScratchSession) {
      setWorktreeMode('local')
      setWorktreeLocked(false)
    } else if (isWorktreeThread) {
      setWorktreeMode('worktree')
      setWorktreeLocked(true)
    } else {
      setWorktreeMode('local')
      setWorktreeLocked(false)
    }
    setWorktreeDropdownOpen(false)
    // Prefill automation prompt if this is a new automation session with no messages and no run in progress
    if (isAutomationSession && !sessionDrafts.get(sessionId)?.text) {
      const autoId = sessionId.replace('automation-', '')
      const automation = useAutomationStore.getState().automations.find(a => a.id === autoId)
      const sessionState = useSessionStore.getState().sessions[sessionId]
      const sessionMessages = sessionState?.messages ?? []
      const hasRunInProgress = (useAutomationStore.getState().runs[autoId] ?? []).some(r => r.status === 'running' || r.status === 'pending')
      if (automation?.prompt && sessionMessages.length === 0 && !sessionState?.isProcessing && !hasRunInProgress) {
        setInputText(automation.prompt)
        sessionDrafts.set(sessionId, { text: automation.prompt, chunks: [] })
      }
    }
    // Auto-focus the input and resize for restored draft
    const draft = sessionDrafts.get(sessionId)
    setTimeout(() => {
      const ta = textareaRef.current
      if (ta) {
        ta.focus()
        if (draft?.text) {
          ta.style.height = 'auto'
          ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
        }
      }
    }, 0)
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

  // Listen for "Send to Claude" events from terminal context menu
  useEffect(() => {
    const handler = (e: Event) => {
      const { text, lineCount, charCount, autoRun } = (e as CustomEvent).detail
      const id = nextChunkId++
      const chunk: PastedChunk = { id, text, lineCount, charCount, source: 'terminal' as const }
      const placeholder = chunkLabel(chunk)
      setPastedChunks(prev => [...prev, chunk])
      // Append placeholder at end of current input
      setInputText(prev => {
        const prefix = prev.length > 0 && !prev.endsWith('\n') ? prev + '\n' : prev
        return prefix + placeholder
      })
      if (autoRun) {
        autoRunPendingRef.current = true
      } else {
        textareaRef.current?.focus()
      }
    }
    window.addEventListener('claude-add-terminal-output', handler)
    return () => window.removeEventListener('claude-add-terminal-output', handler)
  }, [])

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

  // Set of tool IDs that are genuinely still in-progress. Only the trailing batch
  // of consecutive tool_use messages at the END of the messages array can be in-progress.
  // If the agent is already streaming the next response, all tools are complete.
  const inProgressToolIds = useMemo(() => {
    if (isStreaming) return new Set<string>()
    const ids = new Set<string>()
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.type === 'tool_use') {
        ids.add((m as UIToolUseMessage).toolId)
      } else {
        break
      }
    }
    return ids
  }, [messages, isStreaming])

  // Collect all TodoWrite messages for timestamp/duration tracking + find latest
  const allTodoMessages = useMemo(() => {
    return messages.filter(m => m.type === 'tool_use' && (m as UIToolUseMessage).toolName === 'TodoWrite') as UIToolUseMessage[]
  }, [messages])
  const latestTodoMessage = allTodoMessages.length > 0 ? allTodoMessages[allTodoMessages.length - 1] : null
  const latestTodoId = latestTodoMessage?.id ?? null

  // Pre-process messages into render items: groups of completed tool calls + standalone items
  type RenderItem =
    | { kind: 'single'; index: number; msg: UIMessage }
    | { kind: 'group'; indices: number[]; toolNames: string[]; msgs: UIMessage[] }
    | { kind: 'read-group'; indices: number[]; toolUses: UIToolUseMessage[]; results: (UIToolResultMessage | null)[] }

  const renderItems = useMemo<RenderItem[]>(() => {
    const items: RenderItem[] = []
    let i = 0
    const NON_GROUPABLE = ['AskUserQuestion', 'ExitPlanMode', 'TodoWrite']
    while (i < messages.length) {
      const msg = messages[i]
      if (msg.type === 'tool_use') {
        const toolMsg = msg as UIToolUseMessage
        const isGroupable = !NON_GROUPABLE.includes(toolMsg.toolName)
        const hasResult = toolResultByToolUseId.has(toolMsg.toolId)
        if (isGroupable && hasResult) {
          // Greedily collect consecutive tool_use and tool_result messages into a group
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
                continue
              }
            }
            if (m.type === 'tool_result') {
              // Consume tool_result messages — they belong to a tool_use already in the group
              const resultMsg = m as UIToolResultMessage
              const parentTool = toolUseById.get(resultMsg.toolUseId)
              if (parentTool && !NON_GROUPABLE.includes(parentTool.toolName)) {
                groupIndices.push(j)
                groupMsgs.push(m)
                j++
                continue
              }
            }
            break
          }
          if (groupToolNames.length > 1) {
            // Check if all tools in this group are Read — use compact ReadGroup
            const allReads = groupToolNames.every(n => n === 'Read')
            if (allReads) {
              const toolUses = groupMsgs.filter(m => m.type === 'tool_use') as UIToolUseMessage[]
              const results = toolUses.map(tu => toolResultByToolUseId.get(tu.toolId) ?? null)
              items.push({ kind: 'read-group', indices: groupIndices, toolUses, results })
            } else {
              items.push({ kind: 'group', indices: groupIndices, toolNames: groupToolNames, msgs: groupMsgs })
            }
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
  }, [messages, toolResultByToolUseId, toolUseById])

  // Compute turn boundaries for response timing badges
  // A "turn" starts with a user message and ends at the last assistant/tool message before the next user message
  const turnTimings = useMemo(() => {
    const timings = new Map<number, { duration: number; turnNumber: number }>()
    let turnNumber = 0
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      if (msg.type === 'text' && (msg as UITextMessage).role === 'user') {
        turnNumber++
        const userTimestamp = (msg as UITextMessage).timestamp
        // Find the last message in this response (before next user message or end)
        let lastAssistantIdx = -1
        let lastTimestamp = userTimestamp
        for (let j = i + 1; j < messages.length; j++) {
          const next = messages[j]
          if (next.type === 'text' && (next as UITextMessage).role === 'user') break
          lastAssistantIdx = j
          lastTimestamp = (next as { timestamp: number }).timestamp || lastTimestamp
        }
        if (lastAssistantIdx >= 0) {
          const duration = Math.max(0, lastTimestamp - userTimestamp)
          timings.set(lastAssistantIdx, { duration, turnNumber })
        }
      }
    }
    return timings
  }, [messages])

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
    const trimmed = inputText.trim()
    const hasPasted = pastedChunks.length > 0
    const hasImages = imageAttachments.length > 0
    if (!trimmed && !hasPasted && !hasImages) return

    // Capture images before they get cleared
    const currentImages = hasImages ? [...imageAttachments] : undefined

    // Build full message: resolve paste placeholders inline, then prepend image refs
    // Replace [PASTED TEXT: ...] / [TERMINAL: ...] labels with actual pasted content
    let resolved = inputText
    for (const chunk of pastedChunks) {
      resolved = resolved.replace(chunkLabel(chunk), chunk.text)
    }
    resolved = resolved.trim()
    const parts: string[] = []
    if (hasImages) {
      const imageRefs = imageAttachments.map(img => '@' + img.path).join(' ')
      parts.push(imageRefs)
    }
    if (resolved) {
      parts.push(resolved)
    }
    let text = parts.join('\n\n')
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
      setPastedChunks([])
      setImageAttachments([])
      sessionDrafts.delete(sessionId)
      if (textareaRef.current) textareaRef.current.style.height = 'auto'

      // Scroll to bottom when user sends a message
      userScrolledUpRef.current = false
      if (listRef.current) {
        listRef.current.scrollTop = listRef.current.scrollHeight
      }

      // Start a new session with worktree
      const newId = await startNewSession(text, { useWorktree: true }, undefined, currentImages)
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
    setPastedChunks([])
    setImageAttachments([])
    setSuggestion(sessionId, null)
    sessionDrafts.delete(sessionId)
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }

    // Scroll to bottom when user sends a message
    userScrolledUpRef.current = false
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }

    if (isProcessing) {
      // Agent is busy — queue the message
      setMessageQueue(q => [...q, text])
      return
    }

    // Automation sessions: trigger via the automation backend instead of starting a regular agent
    if (isAutomationSession) {
      const autoId = sessionId.replace('automation-', '')
      const automation = useAutomationStore.getState().automations.find(a => a.id === autoId)
      if (automation) {
        // Add the prompt as a user message
        useSessionStore.getState().addUserMessage(sessionId, text)
        useSessionStore.getState().setProcessing(sessionId, true)
        // Trigger the automation run on the backend
        await window.api.automation.trigger(autoId, automation.projectPaths[0] ?? null)
        return
      }
    }

    // Check if session has had a first turn — if not, start new; else send follow-up
    // System messages (e.g. split-view link notifications) don't count as agent interaction
    const sessionState = useSessionStore.getState().sessions[sessionId]
    const hasAgentMessages = sessionState?.messages.some(m => m.type !== 'system') ?? false
    if (!sessionState || !hasAgentMessages) {
      // First message — start the agent
      await startNewSession(text, undefined, isScratchSession ? SCRATCH_PROJECT_PATH : undefined, currentImages)
    } else {
      // Follow-up message
      await sendMessage(text, currentImages)
    }
  }, [inputText, pastedChunks, imageAttachments, sessionId, isProcessing, worktreeMode, worktreeLocked, startNewSession, sendMessage])

  // Auto-run: when "Send to Claude (Run)" adds a chunk, submit immediately
  useEffect(() => {
    if (autoRunPendingRef.current && pastedChunks.length > 0) {
      autoRunPendingRef.current = false
      handleSend()
    }
  }, [pastedChunks, handleSend])

  const handleModelChange = useCallback((modelId: string) => {
    useSessionStore.getState().setSelectedModel(sessionId, modelId)
    window.api.agent.setModel(sessionId, modelId)
  }, [sessionId])

  const handleEffortChange = useCallback((effort: EffortLevel) => {
    useSessionStore.getState().setSelectedEffort(sessionId, effort)
    window.api.agent.setEffort(sessionId, effort)
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

    // Tab to accept suggestion
    if (e.key === 'Tab' && !filePickerOpen && suggestion && !inputText) {
      e.preventDefault()
      setInputText(suggestion)
      setSuggestion(sessionId, null)
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
          textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px'
        }
      }, 0)
      return
    }

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
        try {
          const preview = await window.api.utils.readImage(result.path)
          if (preview.success && preview.dataUrl) {
            setImageAttachments(prev => [...prev, { path: result.path!, previewUrl: preview.dataUrl! }])
          } else {
            throw new Error('preview failed')
          }
        } catch {
          // Fallback: add as text reference if preview fails
          setInputText(prev => {
            const prefix = prev.length > 0 && !prev.endsWith(' ') ? prev + ' ' : prev
            return prefix + '@' + result.path + ' '
          })
        }
        textareaRef.current?.focus()
      }
    } finally {
      setScreenshotCapturing(false)
    }
  }, [])

  // Listen for screenshot-trigger custom event (from hotkey)
  useEffect(() => {
    const handler = () => handleScreenshot()
    window.addEventListener('screenshot-trigger', handler)
    return () => window.removeEventListener('screenshot-trigger', handler)
  }, [handleScreenshot])

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInputText(val)
    historyIndexRef.current = -1
    if (suggestion) setSuggestion(sessionId, null)

    // Remove chunks whose placeholder label was deleted from the text
    setPastedChunks(prev => {
      const next = prev.filter(c => val.includes(chunkLabel(c)))
      return next.length === prev.length ? prev : next
    })

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

  const PASTE_LINE_THRESHOLD = 5
  const PASTE_CHAR_THRESHOLD = 300

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData.getData('text')
    const lineCount = pastedText.split('\n').length
    if (lineCount >= PASTE_LINE_THRESHOLD || pastedText.length >= PASTE_CHAR_THRESHOLD) {
      e.preventDefault()
      const id = nextChunkId++
      const chunk: PastedChunk = { id, text: pastedText, lineCount, charCount: pastedText.length }
      const placeholder = chunkLabel(chunk)
      setPastedChunks(prev => [...prev, chunk])
      // Insert placeholder at cursor position in the textarea
      const ta = textareaRef.current
      if (ta) {
        const currentText = inputTextRef.current
        const start = ta.selectionStart
        const end = ta.selectionEnd
        const before = currentText.slice(0, start)
        const after = currentText.slice(end)
        const newText = before + placeholder + after
        setInputText(newText)
        // Move cursor after the placeholder
        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = before.length + placeholder.length
          ta.style.height = 'auto'
          ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
        })
      }
    }
  }, [])

  const removePastedChunk = useCallback((index: number) => {
    setPastedChunks(prev => {
      const chunk = prev[index]
      if (chunk) {
        // Remove the placeholder label from the input text
        setInputText(text => text.replace(chunkLabel(chunk), ''))
      }
      return prev.filter((_, i) => i !== index)
    })
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

    const textPaths: string[] = []
    const imageFiles: { absPath: string; file: File }[] = []

    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const filePath = window.api.utils.getPathForFile(file)
      if (filePath && isImagePath(filePath)) {
        imageFiles.push({ absPath: filePath, file })
      } else if (filePath) {
        const relativePath = filePath.startsWith(projectPath + '/')
          ? filePath.slice(projectPath.length + 1)
          : filePath
        textPaths.push(relativePath)
      } else if (file.name) {
        textPaths.push(file.name)
      }
    }

    // Add non-image files as @path text references
    if (textPaths.length > 0) {
      const refs = textPaths.map(p => '@' + p).join(' ')
      setInputText(prev => {
        const prefix = prev.length > 0 && !prev.endsWith(' ') ? prev + ' ' : prev
        return prefix + refs + ' '
      })
    }

    // Add image files as visual attachments
    if (imageFiles.length > 0) {
      for (const { absPath, file } of imageFiles) {
        const reader = new FileReader()
        reader.onload = () => {
          const dataUrl = reader.result as string
          setImageAttachments(prev => [...prev, { path: absPath, previewUrl: dataUrl }])
        }
        reader.readAsDataURL(file)
      }
    }

    if (textareaRef.current) {
      textareaRef.current.focus()
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = 'auto'
          textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
        }
      })
    }
  }, [projectPath])

  const renderSingleMessage = useCallback((msg: UIMessage, absIdx: number) => {
    const isMatch = searchMatchIds.has(msg.id)
    const isCurrent = msg.id === currentMatchMsgId
    const matchClass = isMatch ? (isCurrent ? ' search-match search-match-current' : ' search-match') : ''
    if (msg.type === 'text') {
      return (
        <div key={msg.id} data-msg-id={msg.id} className={matchClass}>
          <MessageBubble message={msg as UITextMessage} searchQuery={searchOpen ? searchQuery : ''} projectPath={projectPath} modelLabel={assistantLabel} />
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
        // Skip rendering the latest todo inline if it's pinned above the input area
        // (pinned block hides itself when all tasks are complete, so show inline in that case)
        if (msg.id === latestTodoId) {
          const todos = (toolMsg.input?.todos as { status: string }[]) || []
          const allDone = todos.length > 0 && todos.every(t => t.status === 'completed')
          if (!allDone) return null
        }
        return <div key={msg.id} data-msg-id={msg.id} className={matchClass}><TodoBlock message={toolMsg} isLatest={msg.id === latestTodoId} allTodoMessages={allTodoMessages} /></div>
      }
      if (isFileEditTool(toolMsg.toolName)) {
        const pairedResult = toolResultByToolUseId.get(toolMsg.toolId)
        const hasResult = !!pairedResult
        const isLast = absIdx === messages.length - 1 || !messages.slice(absIdx + 1).some(m => m.type === 'tool_use' || m.type === 'tool_result')
        const needsPermission = !skipPermissions && !hasResult && isLast
        const effectivelyComplete = hasResult || !inProgressToolIds.has(toolMsg.toolId)
        const toolInProgress = isProcessing && !effectivelyComplete && !needsPermission
        return <div key={msg.id} data-msg-id={msg.id} className={matchClass}><FileEditBlock message={toolMsg} result={pairedResult ?? null} awaitingPermission={needsPermission} terminalId={sessionId} isInProgress={toolInProgress} projectPath={projectPath} /></div>
      }
      const hasToolResult = toolResultByToolUseId.has(toolMsg.toolId)
      const isLastToolUse = absIdx === messages.length - 1 || !messages.slice(absIdx + 1).some(m => m.type === 'tool_use' || m.type === 'tool_result')
      const awaitingPermission = !skipPermissions && !hasToolResult && isLastToolUse
      const effectivelyComplete = hasToolResult || !inProgressToolIds.has(toolMsg.toolId)
      const toolInProgress = isProcessing && !effectivelyComplete && !awaitingPermission
      return <div key={msg.id} data-msg-id={msg.id} className={matchClass}><ToolUseBlock message={toolMsg} awaitingPermission={awaitingPermission} terminalId={sessionId} isInProgress={toolInProgress} /></div>
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
  }, [messages, searchMatchIds, currentMatchMsgId, searchOpen, searchQuery, toolResultByToolUseId, toolUseById, skipPermissions, sessionId, isProcessing, inProgressToolIds])

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
      <div className="chat-view-body">
        {messages.length > 10 && (
          <button
            className={`key-moments-toggle${keyMomentsOpen ? ' active' : ''}`}
            onClick={() => setKeyMomentsOpen(o => !o)}
            title={keyMomentsOpen ? 'Hide key moments' : 'Show key moments'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>
          </button>
        )}
        <div className="chat-view-messages" ref={listRef}>
          <div
            className={`messages-container${compactMessages ? ' compact' : ''}`}
            style={{
              ...(chatZoom !== 1 ? { zoom: chatZoom } : {}),
              '--chat-font-size': `${fontSize}px`,
              '--chat-line-height': String(lineHeight),
              ...(fontFamily && fontFamily !== 'system' ? { fontFamily: fontFamily === 'mono' ? "'SF Mono', 'Fira Code', 'Cascadia Code', 'JetBrains Mono', monospace" : fontFamily === 'inter' ? "'Inter', system-ui, sans-serif" : fontFamily === 'fira-code' ? "'Fira Code', monospace" : fontFamily === 'jetbrains' ? "'JetBrains Mono', monospace" : fontFamily === 'cascadia' ? "'Cascadia Code', monospace" : undefined } : {}),
            } as React.CSSProperties}
          >
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
              if (item.kind === 'read-group') {
                const startIdx = Math.max(0, messages.length - visibleCount)
                if (item.indices[item.indices.length - 1] < startIdx) return null
                const lastIdx = item.indices[item.indices.length - 1]
                const timing = turnTimings.get(lastIdx)
                return (
                  <React.Fragment key={`rg-${itemIdx}`}>
                    <ReadGroup toolUses={item.toolUses} results={item.results} projectPath={projectPath} />
                    {timing && timing.duration > 0 && (
                      <div className="response-timing-badge">
                        <span className="response-timing-line" />
                        <span className="response-timing-label">Response &middot; {formatDuration(timing.duration)}</span>
                        <span className="response-timing-line" />
                      </div>
                    )}
                  </React.Fragment>
                )
              }
              if (item.kind === 'group') {
                const startIdx = Math.max(0, messages.length - visibleCount)
                if (item.indices[item.indices.length - 1] < startIdx) return null
                const lastIdx = item.indices[item.indices.length - 1]
                const timing = turnTimings.get(lastIdx)
                return (
                  <React.Fragment key={`group-${itemIdx}`}>
                    <ToolCallGroup toolNames={item.toolNames}>
                      {item.msgs.map(msg => renderSingleMessage(msg, messages.indexOf(msg)))}
                    </ToolCallGroup>
                    {timing && timing.duration > 0 && (
                      <div className="response-timing-badge">
                        <span className="response-timing-line" />
                        <span className="response-timing-label">Response &middot; {formatDuration(timing.duration)}</span>
                        <span className="response-timing-line" />
                      </div>
                    )}
                  </React.Fragment>
                )
              }
              const { msg, index: absIdx } = item
              const startIdx = Math.max(0, messages.length - visibleCount)
              if (absIdx < startIdx) return null
              const timing = turnTimings.get(absIdx)
              return (
                <React.Fragment key={`single-${itemIdx}`}>
                  {renderSingleMessage(msg, absIdx)}
                  {timing && timing.duration > 0 && (
                    <div className="response-timing-badge">
                      <span className="response-timing-line" />
                      <span className="response-timing-label">Response &middot; {formatDuration(timing.duration)}</span>
                      <span className="response-timing-line" />
                    </div>
                  )}
                </React.Fragment>
              )
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
        {keyMomentsOpen && (
          <KeyMomentsRail
            messages={messages}
            listRef={listRef}
            visibleCount={visibleCount}
            setVisibleCount={setVisibleCount}
            checkpoints={checkpoints}
            onRevert={handleRevert}
          />
        )}
      </div>

      {/* Pinned todo block — sticks above input area */}
      {latestTodoMessage && (() => {
        const todos = (latestTodoMessage.input?.todos as { status: string }[]) || []
        const allDone = todos.length > 0 && todos.every(t => t.status === 'completed')
        if (allDone) return null
        return (
          <div className="pinned-todo-wrapper">
            <TodoBlock message={latestTodoMessage} isLatest={true} allTodoMessages={allTodoMessages} />
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
            <span className="thinking-label">{isAutomationSession ? 'Running automation...' : 'Processing...'}</span>
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

        {isForkParent && (
          <div className="fork-parent-notice">
            This conversation was forked. Switch to a fork in the sidebar to continue.
          </div>
        )}
        {reviewerMode && !isProcessing && messages.every(m => m.type === 'system') && (
          <div className="reviewer-waiting-banner">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <polyline points="12 6 12 12 16 14"/>
            </svg>
            Waiting for the writer session to make changes...
          </div>
        )}
        <div className={`input-bar${isForkParent ? ' input-bar-disabled' : ''}${reviewerMode ? ' input-bar-reviewer' : ''}`}>
          {(pastedChunks.length > 0 || imageAttachments.length > 0) && (
            <div className="pasted-chunks">
              {imageAttachments.map((img, i) => (
                <div key={`img-${i}`} className="image-chip">
                  <img
                    src={img.previewUrl}
                    alt=""
                    className="image-chip-preview"
                    onClick={() => setLightboxImage(img.previewUrl)}
                    style={{ cursor: 'pointer' }}
                  />
                  <span className="image-chip-name">{img.path.split('/').pop()}</span>
                  <button
                    className="pasted-chip-remove"
                    onClick={() => setImageAttachments(prev => prev.filter((_, j) => j !== i))}
                    title="Remove"
                  >
                    &times;
                  </button>
                </div>
              ))}
              {pastedChunks.map((chunk, i) => (
                <div key={i} className={`pasted-chip${chunk.source === 'terminal' ? ' terminal-chip' : ''}`}>
                  <span className="pasted-chip-text">
                    {chunk.source === 'terminal'
                      ? `[TERMINAL: ${chunk.lineCount}L, ${chunk.charCount}C]`
                      : `[PASTED TEXT: ${chunk.lineCount}:${chunk.charCount}]`
                    }
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
          <div className="textarea-wrapper">
            <div className="input-highlight-overlay" aria-hidden="true">
              {inputText
                ? renderHighlightedInput(inputText)
                : suggestion && !isProcessing
                  ? <span className="input-suggestion-ghost">{suggestion}<span className="input-suggestion-hint">Tab</span></span>
                  : <span className="input-highlight-placeholder">{isForkParent ? 'Session forked — switch to a fork to continue' : reviewerMode ? 'Reviewer — input disabled' : `Message ${assistantLabel}... (Enter to send)`}</span>
              }
            </div>
            <textarea
              ref={textareaRef}
              className={`input-textarea${vimChatEnabled && vim.mode !== 'insert' ? ' vim-normal' : ''}${inputText ? ' has-content' : ''}`}
              placeholder={isForkParent ? 'Session forked — switch to a fork to continue' : reviewerMode ? 'Reviewer — input disabled (changes forwarded automatically)' : `Message ${assistantLabel}... (Enter to send)`}
              value={inputText}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              rows={2}
              disabled={isForkParent || reviewerMode}
            />
            {vimChatEnabled && vim.mode !== 'insert' && (
              <VimBlockCursor textareaRef={textareaRef} text={inputText} />
            )}
          </div>
          <div className="input-bar-toolbar">
            <div className="input-bar-toolbar-left">
              <div className="config-picker-wrapper">
                <button
                  className="btn-config-picker"
                  onClick={(e) => { e.stopPropagation(); setConfigPickerOpen(!configPickerOpen) }}
                  title="Model & reasoning settings"
                >
                  {getModelLabel(displayModel)}
                  {effortLevels && (
                    <>
                      <span className="config-picker-dot">&middot;</span>
                      <span className="config-picker-effort">{selectedEffort}</span>
                    </>
                  )}
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9"/>
                  </svg>
                </button>
                {configPickerOpen && (
                  <div className="config-picker-dropdown">
                    <div className="config-picker-section">
                      <div className="config-picker-section-label">Model</div>
                      <div className="model-picker-group-label">Anthropic</div>
                      {AVAILABLE_MODELS.filter(m => m.provider === 'anthropic').map(m => (
                        <button
                          key={m.id}
                          className={`model-picker-option ${m.id === displayModel ? 'active' : ''}`}
                          onClick={() => handleModelChange(m.id)}
                        >
                          {m.label}
                        </button>
                      ))}
                      <div className="model-picker-group-label">OpenAI</div>
                      {AVAILABLE_MODELS.filter(m => m.provider === 'openai').map(m => (
                        <button
                          key={m.id}
                          className={`model-picker-option ${m.id === displayModel ? 'active' : ''}`}
                          onClick={() => handleModelChange(m.id)}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                    {effortLevels && (
                      <div className="config-picker-section">
                        <div className="config-picker-section-label">Reasoning Effort</div>
                        {effortLevels.map(level => (
                          <button
                            key={level}
                            className={`effort-picker-option ${level === selectedEffort ? 'active' : ''}`}
                            onClick={() => handleEffortChange(level)}
                          >
                            {level}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <span className="toolbar-separator">|</span>
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
                {planMode ? 'Plan' : 'Chat'}
              </button>
              <span className="toolbar-separator">|</span>
              <button
                className="btn-access-mode"
                onClick={() => {
                  const { updateSettings, claude } = useSettingsStore.getState()
                  updateSettings({ claude: { ...claude, dangerouslySkipPermissions: !skipPermissions } })
                }}
                title={skipPermissions ? 'YOLO — Claude can run all tools without asking' : 'Supervised — Claude will ask before running tools'}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  {skipPermissions ? (
                    <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></>
                  ) : (
                    <><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>
                  )}
                </svg>
                {skipPermissions ? 'YOLO' : 'Supervised'}
              </button>
              {messages.length > 0 && !isForkParent && !isScratchSession && (
                <>
                  <span className="toolbar-separator">|</span>
                  <button
                    className={`btn-fork`}
                    onClick={() => forkSession()}
                    disabled={isProcessing || messages.length === 0}
                    title="Fork conversation into two parallel worktree sessions"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="18" r="3"/>
                      <circle cx="6" cy="6" r="3"/>
                      <circle cx="18" cy="6" r="3"/>
                      <path d="M6 9v3a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9"/>
                      <line x1="12" y1="12" x2="12" y2="15"/>
                    </svg>
                    Fork
                  </button>
                </>
              )}
            </div>
            <div className="input-actions">
              {vimChatEnabled && vim.mode !== 'insert' && (
                <div className="vim-mode-indicator">
                  {vim.mode === 'normal' ? 'NORMAL' : 'VISUAL'}
                </div>
              )}
              <button
                className="btn-screenshot"
                onClick={handleScreenshot}
                disabled={screenshotCapturing}
                title={`Take screenshot (${modLabel}Y)`}
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
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="white" stroke="none">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                </button>
              ) : (
                <button
                  className="btn-send"
                  onClick={handleSend}
                  disabled={!inputText.trim() && pastedChunks.length === 0 && imageAttachments.length === 0}
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
            {isScratchSession ? (
              <span className="input-footer-project" title="Quick Chat — no project">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
                Quick Chat
              </span>
            ) : (
              <>
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
                  <span className="input-footer-project" title={effectiveProjectPath}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    {effectiveProjectPath.split('/').pop()}
                  </span>
                )}
              </>
            )}
          </div>
          <div className="input-footer-right">
            {gitBranch && !isScratchSession && (
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
        </div>
      </div>
      {/* Zoom level indicator */}
      <div className={`zoom-indicator${zoomVisible ? ' visible' : ''}`}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          {chatZoom >= 1 ? <><line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/></> : <line x1="8" y1="11" x2="14" y2="11"/>}
        </svg>
        <span className="zoom-indicator-value">{Math.round(chatZoom * 100)}%</span>
        {chatZoom !== 1 && (
          <button className="zoom-indicator-reset" onClick={() => { setChatZoom(1); setZoomVisible(true); if (zoomTimerRef.current) clearTimeout(zoomTimerRef.current); zoomTimerRef.current = setTimeout(() => setZoomVisible(false), 800) }} title="Reset zoom">
            Reset
          </button>
        )}
      </div>
      {lightboxImage && (
        <div className="image-lightbox-overlay" onClick={() => setLightboxImage(null)}>
          <img
            src={lightboxImage}
            alt=""
            className="image-lightbox-img"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
