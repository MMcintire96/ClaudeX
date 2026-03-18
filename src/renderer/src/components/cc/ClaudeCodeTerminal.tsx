import React, { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
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
  const searchAddonRef = useRef<SearchAddon | null>(null)
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
      allowProposedApi: true
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    const webLinksAddon = new WebLinksAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
    term.loadAddon(webLinksAddon)
    term.open(xtermContainerRef.current)

    termRef.current = term
    fitAddonRef.current = fitAddon
    searchAddonRef.current = searchAddon

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

    // Ctrl+Shift+C = copy, Ctrl+Shift+V = paste, Ctrl+F = search
    let keyPasteInFlight = false
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey) {
        if (e.key === 'C' || e.code === 'KeyC') {
          const selection = term.getSelection()
          if (selection) navigator.clipboard.writeText(selection)
          return false
        }
        if (e.key === 'V' || e.code === 'KeyV') {
          keyPasteInFlight = true
          const tid = terminalIdRef.current
          if (tid) {
            navigator.clipboard.readText().then(text => {
              if (text) window.api.terminal.write(tid, `\x1b[200~${text}\x1b[201~`)
            })
          }
          return false
        }
      }
      // Ctrl+F to toggle search
      if (e.type === 'keydown' && e.ctrlKey && !e.shiftKey && (e.key === 'f' || e.code === 'KeyF')) {
        setSearchOpen(prev => !prev)
        return false
      }
      // Escape to close search if open
      if (e.type === 'keydown' && e.key === 'Escape' && searchOpenRef.current) {
        setSearchOpen(false)
        return false
      }
      return true
    })

    // Intercept paste events to avoid duplicates
    const handleTerminalPaste = (e: ClipboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (keyPasteInFlight) {
        keyPasteInFlight = false
        return
      }
      const text = e.clipboardData?.getData('text/plain')
      const tid = terminalIdRef.current
      if (text && tid) {
        window.api.terminal.write(tid, `\x1b[200~${text}\x1b[201~`)
      }
    }
    const containerEl = xtermContainerRef.current!
    containerEl.addEventListener('paste', handleTerminalPaste, true)

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
      })
    }

    return () => {
      clearTimeout(fitTimer)
      containerEl.removeEventListener('paste', handleTerminalPaste, true)
      observer.disconnect()
      onDataDisposable.dispose()
      unsubData()
      unsubExit()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
    }
  }, [initialized, sessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update theme
  useEffect(() => {
    const term = termRef.current
    if (term) {
      const base = XTERM_THEMES[theme] || XTERM_THEMES.dark
      term.options.theme = base
      term.refresh(0, term.rows - 1)
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
          termRef.current.refresh(0, termRef.current.rows - 1)
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
      searchAddonRef.current?.clearDecorations()
    }
  }, [searchOpen])

  // Incremental search on query change
  useEffect(() => {
    if (!searchOpen || !searchAddonRef.current) return
    if (searchQuery) {
      searchAddonRef.current.findNext(searchQuery)
    } else {
      searchAddonRef.current.clearDecorations()
    }
  }, [searchQuery, searchOpen])

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
        searchAddonRef.current?.findPrevious(searchQuery)
      } else {
        searchAddonRef.current?.findNext(searchQuery)
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
      style={{ display: visible ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden', position: 'relative' }}
    >
      <div
        className="neovim-editor-xterm"
        ref={xtermContainerRef}
        style={{ flex: 1, padding: '8px 8px 0 8px' }}
      />
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
          <button onClick={() => searchAddonRef.current?.findPrevious(searchQuery)} title="Previous (Shift+Enter)">&#x25B2;</button>
          <button onClick={() => searchAddonRef.current?.findNext(searchQuery)} title="Next (Enter)">&#x25BC;</button>
          <button onClick={() => setSearchOpen(false)} title="Close (Escape)">&times;</button>
        </div>
      )}
    </div>
  )
}
