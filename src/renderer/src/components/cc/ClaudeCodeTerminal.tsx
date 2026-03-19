import React, { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal, FitAddon } from 'ghostty-web'
import { useUIStore } from '../../stores/uiStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSessionStore } from '../../stores/sessionStore'
import { XTERM_THEMES } from '../../lib/xtermThemes'

interface Props {
  sessionId: string
  projectPath: string
  visible: boolean
  resumeSessionId?: string | null
  onCCSessionId?: (ccId: string) => void
  onResumeConsumed?: () => void
}

// Track CC terminal IDs per session so each thread gets its own instance
const sessionTerminals: Record<string, string> = {}

// Kill the PTY for a given session (called on cleanup)
function killCCTerminal(sessionId: string): void {
  const tid = sessionTerminals[sessionId]
  if (tid) {
    window.api.terminal.close(tid)
    delete sessionTerminals[sessionId]
  }
}

export { killCCTerminal }

export default function ClaudeCodeTerminal({ sessionId, projectPath, visible, resumeSessionId, onCCSessionId, onResumeConsumed }: Props) {
  const xtermContainerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  // Buffer-based search (replaces SearchAddon)
  const bufferSearchRef = useRef<{ findNext: (q: string) => void; findPrevious: (q: string) => void } | null>(null)
  const theme = useUIStore(s => s.theme)
  const skipPermissions = useSettingsStore(s => s.claude.dangerouslySkipPermissions)
  const fontSize = useSettingsStore(s => s.fontSize)
  const session = useSessionStore(s => s.sessions[sessionId])
  const model = session?.selectedModel ?? null
  const effort = session?.selectedEffort ?? null

  // Use worktree path if session is in a worktree
  const effectivePath = session?.worktreePath ?? projectPath

  const [initialized, setInitialized] = useState(false)
  const [exited, setExited] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [screenshotting, setScreenshotting] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchOpenRef = useRef(false)
  searchOpenRef.current = searchOpen
  const terminalIdRef = useRef<string | null>(null)
  const sessionIdRef = useRef(sessionId)
  sessionIdRef.current = sessionId
  const ccSessionIdRef = useRef<string | null>(null)
  const lastCcSessionIdRef = useRef<string | null>(null) // preserved through exit for auto-resume
  const resumeConsumedRef = useRef(false)
  const handoffInProgressRef = useRef(false)

  // Reset consumed flag when a new resume ID is set (e.g. new handoff)
  useEffect(() => {
    if (resumeSessionId) {
      resumeConsumedRef.current = false
    }
  }, [resumeSessionId])

  useEffect(() => {
    if (visible && effectivePath && !initialized) {
      setInitialized(true)
    }
  }, [visible, effectivePath, initialized])

  const spawnCC = useCallback(async (path: string, resumeId?: string | null) => {
    // Stop any existing watcher
    if (ccSessionIdRef.current) {
      window.api.cc.stopWatch(sessionIdRef.current)
    }

    const ccId = crypto.randomUUID()
    ccSessionIdRef.current = ccId

    const result = await window.api.terminal.createCC(
      path, skipPermissions, model, effort,
      resumeId ? undefined : ccId,  // --session-id (only if not resuming)
      resumeId ?? undefined         // --resume
    )
    if (result.success && result.id) {
      terminalIdRef.current = result.id
      sessionTerminals[sessionIdRef.current] = result.id

      // Start watching the JSONL for this CC session
      window.api.cc.watchSession({
        ccSessionId: resumeId ?? ccId,
        projectPath: path,
        rendererSessionId: sessionIdRef.current
      })

      onCCSessionId?.(resumeId ?? ccId)
    }
    return result
  }, [skipPermissions, model, effort, onCCSessionId])

  // Clean up PTY + watcher when session is removed
  useEffect(() => {
    return () => {
      killCCTerminal(sessionId)
      window.api.cc.stopWatch(sessionId)
    }
  }, [sessionId])

  // Initialize xterm + spawn claude CLI
  useEffect(() => {
    if (!initialized || !xtermContainerRef.current || !effectivePath) return

    // If this session already has a terminal, reconnect to it
    const existingId = sessionTerminals[sessionId]
    const xtermTheme = XTERM_THEMES[theme] || XTERM_THEMES.dark

    const term = new Terminal({
      fontSize,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: xtermTheme,
      cursorBlink: true,
      scrollback: 5000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(xtermContainerRef.current)

    termRef.current = term
    fitAddonRef.current = fitAddon

    // Create buffer-based search helper
    const makeBufferSearch = (direction: 'next' | 'prev') => (query: string) => {
      if (!query) return
      const buf = term.buffer.active
      const totalLines = buf.length
      const lines: string[] = []
      for (let i = 0; i < totalLines; i++) {
        const line = buf.getLine(i)
        lines.push(line ? line.translateToString(true) : '')
      }
      const text = lines.join('\n')
      const idx = direction === 'next'
        ? text.toLowerCase().indexOf(query.toLowerCase())
        : text.toLowerCase().lastIndexOf(query.toLowerCase())
      if (idx !== -1) {
        let charCount = 0
        for (let i = 0; i < lines.length; i++) {
          if (charCount + lines[i].length >= idx) {
            const scrollTarget = Math.max(0, i - Math.floor(term.rows / 2))
            term.scrollToLine(scrollTarget)
            break
          }
          charCount += lines[i].length + 1
        }
      }
    }
    bufferSearchRef.current = {
      findNext: makeBufferSearch('next'),
      findPrevious: makeBufferSearch('prev')
    }

    const doFit = () => {
      try {
        fitAddon.fit()
        const tid = terminalIdRef.current
        if (tid) {
          window.api.terminal.resize(tid, term.cols, term.rows)
        }
      } catch {
        // Ignore fit errors
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(doFit))
    const fitTimer = setTimeout(doFit, 100)

    // Capture-phase keydown listener to intercept shortcuts before the browser
    const containerEl = xtermContainerRef.current!
    const handleShortcuts = (e: KeyboardEvent) => {
      // Ctrl+Shift+C = copy
      if (e.ctrlKey && e.shiftKey && (e.key === 'C' || e.code === 'KeyC')) {
        e.preventDefault()
        e.stopPropagation()
        const selection = term.getSelection()
        if (selection) navigator.clipboard.writeText(selection)
        return
      }
      // Ctrl+F = toggle search
      if (e.ctrlKey && !e.shiftKey && (e.key === 'f' || e.code === 'KeyF')) {
        e.preventDefault()
        e.stopPropagation()
        setSearchOpen(prev => !prev)
        return
      }
      // Escape = close search
      if (e.key === 'Escape' && searchOpenRef.current) {
        e.preventDefault()
        e.stopPropagation()
        setSearchOpen(false)
        return
      }
    }
    containerEl.addEventListener('keydown', handleShortcuts, true)

    // User keystrokes -> PTY
    const onDataDisposable = term.onData((data: string) => {
      const tid = terminalIdRef.current
      if (tid) {
        window.api.terminal.write(tid, data)
      }
    })

    // PTY output -> terminal screen
    const unsubData = window.api.terminal.onData((id: string, data: string) => {
      if (id === terminalIdRef.current) {
        term.write(data)
      }
    })

    // Terminal exit
    const unsubExit = window.api.terminal.onExit((id: string) => {
      if (id === terminalIdRef.current) {
        term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n')
        // Preserve CC session ID for auto-resume before clearing
        if (ccSessionIdRef.current) {
          lastCcSessionIdRef.current = ccSessionIdRef.current
        }
        setExited(true)
        delete sessionTerminals[sessionIdRef.current]
        terminalIdRef.current = null
        window.api.cc.stopWatch(sessionIdRef.current)
        ccSessionIdRef.current = null
      }
    })

    // ResizeObserver
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        const tid = terminalIdRef.current
        if (tid) {
          window.api.terminal.resize(tid, term.cols, term.rows)
        }
      } catch {
        // Ignore resize errors
      }
    })
    observer.observe(xtermContainerRef.current)

    // Spawn or reconnect
    if (existingId) {
      terminalIdRef.current = existingId
      // Replay buffer from existing terminal
      window.api.terminal.getBuffer(existingId).then((buffer: string) => {
        if (buffer) term.write(buffer)
      })
    } else {
      // Consume resumeSessionId if provided (only once)
      const resumeId = !resumeConsumedRef.current ? resumeSessionId : null
      if (resumeId) {
        resumeConsumedRef.current = true
        handoffInProgressRef.current = true
        onResumeConsumed?.()
      }
      spawnCC(effectivePath, resumeId).then(() => {
        if (resumeId) handoffInProgressRef.current = false
        // Fit after spawn so PTY gets the correct size
        doFit()
      })
    }

    return () => {
      clearTimeout(fitTimer)
      containerEl.removeEventListener('keydown', handleShortcuts, true)
      observer.disconnect()
      onDataDisposable.dispose()
      unsubData()
      unsubExit()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
      bufferSearchRef.current = null
    }
  }, [initialized, sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update theme
  useEffect(() => {
    const term = termRef.current
    if (term) {
      const base = XTERM_THEMES[theme] || XTERM_THEMES.dark
      term.options.theme = base
    }
  }, [theme])

  // Update font size from settings
  useEffect(() => {
    const term = termRef.current
    if (term) {
      term.options.fontSize = fontSize
      fitAddonRef.current?.fit()
    }
  }, [fontSize])

  // Re-fit when becoming visible
  useEffect(() => {
    if (!visible || !fitAddonRef.current || !termRef.current) return
    const refit = () => {
      try {
        fitAddonRef.current?.fit()
        const tid = terminalIdRef.current
        if (termRef.current && tid) {
          window.api.terminal.resize(tid, termRef.current.cols, termRef.current.rows)
        }
      } catch {
        // Ignore
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(refit))
    const timer = setTimeout(refit, 150)
    return () => clearTimeout(timer)
  }, [visible])

  // Respawn after natural exit (CC process ended on its own — NOT during handoff)
  // Auto-resumes the previous CC session so the user doesn't see a fresh "Resume Session" menu
  useEffect(() => {
    if (!visible || !exited || !effectivePath || !termRef.current) return
    if (handoffInProgressRef.current) return // handoff effect handles respawn
    const term = termRef.current
    term.clear()
    setExited(false)
    const resumeId = lastCcSessionIdRef.current
    lastCcSessionIdRef.current = null
    spawnCC(effectivePath, resumeId).then(() => {
      try {
        fitAddonRef.current?.fit()
        const tid = terminalIdRef.current
        if (termRef.current && tid) {
          window.api.terminal.resize(tid, termRef.current.cols, termRef.current.rows)
        }
      } catch {
        // Ignore
      }
    })
  }, [visible, exited, effectivePath, spawnCC])

  // Chat → CC handoff: when resumeSessionId is set, kill existing and respawn with --resume
  useEffect(() => {
    if (!resumeSessionId || resumeConsumedRef.current) return
    if (!initialized || !effectivePath || !termRef.current) return
    resumeConsumedRef.current = true
    handoffInProgressRef.current = true

    // Kill existing CC process if running (suppress natural respawn via handoffInProgressRef)
    const existingTid = terminalIdRef.current
    if (existingTid) {
      window.api.terminal.close(existingTid)
      delete sessionTerminals[sessionId]
      terminalIdRef.current = null
      window.api.cc.stopWatch(sessionId)
      ccSessionIdRef.current = null
    }

    const term = termRef.current
    term.clear()
    term.write('\x1b[90m[Resuming from Chat...]\x1b[0m\r\n')
    setExited(false)

    spawnCC(effectivePath, resumeSessionId).then(() => {
      handoffInProgressRef.current = false
      onResumeConsumed?.()
      try {
        fitAddonRef.current?.fit()
        const tid = terminalIdRef.current
        if (termRef.current && tid) {
          window.api.terminal.resize(tid, termRef.current.cols, termRef.current.rows)
        }
      } catch {
        // Ignore
      }
    })
  }, [resumeSessionId, initialized, effectivePath, sessionId, spawnCC, onResumeConsumed])

  // Focus search input when search opens
  useEffect(() => {
    if (searchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus())
    } else {
      setSearchQuery('')
    }
  }, [searchOpen])

  const handleScreenshot = useCallback(async () => {
    const tid = terminalIdRef.current
    if (!tid || screenshotting) return
    setScreenshotting(true)
    try {
      const result = await window.api.screenshot.capture()
      if (result.success && result.path) {
        // Send the screenshot path as user input to the CC session
        window.api.terminal.write(tid, `${result.path}\n`)
      }
    } finally {
      setScreenshotting(false)
    }
  }, [screenshotting])

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSearchOpen(false)
    } else if (e.key === 'Enter') {
      if (e.shiftKey) {
        bufferSearchRef.current?.findPrevious(searchQuery)
      } else {
        bufferSearchRef.current?.findNext(searchQuery)
      }
    }
  }, [searchQuery])

  if (!effectivePath) {
    return (
      <div className="neovim-editor-empty">
        <p>Open a project to use Claude Code</p>
      </div>
    )
  }

  return (
    <div
      className="neovim-editor-wrapper"
      style={{ display: visible ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden', position: 'relative', minWidth: 0 }}
    >
      <div className="cc-terminal-padding">
        <div
          className="neovim-editor-xterm"
          ref={xtermContainerRef}
        />
      </div>
      <button
        className="cc-screenshot-btn"
        onClick={handleScreenshot}
        disabled={screenshotting || !terminalIdRef.current}
        title="Take screenshot and send to CC"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect x="1" y="3" width="14" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" fill="none"/>
          <circle cx="8" cy="8.5" r="2.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
          <rect x="5" y="1" width="6" height="2" rx="1" stroke="currentColor" strokeWidth="1" fill="none"/>
        </svg>
      </button>
      {searchOpen && (
        <div className="terminal-search-bar">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search..."
          />
          <button onClick={() => bufferSearchRef.current?.findPrevious(searchQuery)} title="Previous (Shift+Enter)">&#x25B2;</button>
          <button onClick={() => bufferSearchRef.current?.findNext(searchQuery)} title="Next (Enter)">&#x25BC;</button>
          <button onClick={() => setSearchOpen(false)} title="Close (Escape)">&times;</button>
        </div>
      )}
    </div>
  )
}
