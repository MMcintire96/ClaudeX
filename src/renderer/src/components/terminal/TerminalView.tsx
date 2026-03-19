import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal, FitAddon } from 'ghostty-web'
import { useUIStore } from '../../stores/uiStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { XTERM_THEMES } from '../../lib/xtermThemes'

interface Props {
  terminalId: string
  visible: boolean
  active?: boolean
  background?: string
}

export default function TerminalView({ terminalId, visible, active, background }: Props) {
  const xtermContainerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const theme = useUIStore(s => s.theme)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)
  const searchOpenRef = useRef(false)
  // Keep ref in sync for use in xterm key handler (avoids stale closure)
  searchOpenRef.current = searchOpen

  const handleCopy = useCallback(() => {
    const term = termRef.current
    if (!term) return
    const selection = term.getSelection()
    if (selection) {
      navigator.clipboard.writeText(selection)
    }
  }, [])

  const handlePaste = useCallback(async () => {
    const term = termRef.current
    if (!term) return
    const text = await navigator.clipboard.readText()
    if (text) {
      // ghostty-web's paste() handles bracketed paste automatically
      term.paste(text)
    }
  }, [])

  const handleSendToClaude = useCallback((autoRun = false) => {
    const term = termRef.current
    if (!term) return
    const selection = term.getSelection()
    if (!selection) return
    const lineCount = selection.split('\n').length
    window.dispatchEvent(new CustomEvent('claude-add-terminal-output', {
      detail: { text: selection, lineCount, charCount: selection.length, autoRun }
    }))
  }, [])

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null)
      }
    }
    window.addEventListener('mousedown', handleClick)
    return () => window.removeEventListener('mousedown', handleClick)
  }, [contextMenu])

  // Initialize terminal
  useEffect(() => {
    if (!xtermContainerRef.current) return

    const xtermTheme = XTERM_THEMES[theme] || XTERM_THEMES.dark

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: background
        ? { ...xtermTheme, background }
        : xtermTheme,
      cursorBlink: true,
      scrollback: 5000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(xtermContainerRef.current)

    // Initial fit
    requestAnimationFrame(() => {
      try {
        fitAddon.fit()
      } catch {
        // Ignore fit errors on initial render
      }
    })

    termRef.current = term
    fitAddonRef.current = fitAddon

    // Capture-phase keydown listener to intercept shortcuts before the browser
    // (contenteditable can cause Chrome to handle Ctrl+F as "find in page")
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

    // User keystrokes → PTY
    const onDataDisposable = term.onData((data: string) => {
      window.api.terminal.write(terminalId, data)
    })

    // PTY exit → handled by store (via App.tsx listener)
    const unsubExit = window.api.terminal.onExit((id: string) => {
      if (id === terminalId) {
        term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n')
      }
    })

    // Replay buffered output from main process, then subscribe to live data.
    // This ordering avoids duplicate output from the race between buffer
    // snapshot and live event subscription.
    let unsubData: (() => void) | null = null
    let disposed = false
    window.api.terminal.getBuffer(terminalId).then((raw: string) => {
      if (disposed) return
      if (raw) {
        term.write(raw)
      }
      // Subscribe to live PTY data only after buffer is replayed
      unsubData = window.api.terminal.onData(
        (id: string, data: string) => {
          if (id === terminalId) {
            term.write(data)
          }
        }
      )
    })

    // ResizeObserver → fit + notify PTY
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        window.api.terminal.resize(terminalId, term.cols, term.rows)
      } catch {
        // Ignore resize errors
      }
    })
    observer.observe(xtermContainerRef.current)

    return () => {
      disposed = true
      containerEl.removeEventListener('keydown', handleShortcuts, true)
      observer.disconnect()
      onDataDisposable.dispose()
      unsubData?.()
      unsubExit()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [terminalId]) // Only re-create on terminal ID change

  // Update theme without re-creating terminal
  useEffect(() => {
    const term = termRef.current
    if (term) {
      const base = XTERM_THEMES[theme] || XTERM_THEMES.dark
      term.options.theme = background ? { ...base, background } : base
    }
  }, [theme, background])

  // Re-fit and focus when visibility or active tab changes
  useEffect(() => {
    if (visible && fitAddonRef.current && termRef.current) {
      const refit = () => {
        try {
          fitAddonRef.current?.fit()
          if (termRef.current) {
            window.api.terminal.resize(terminalId, termRef.current.cols, termRef.current.rows)
            termRef.current.scrollToBottom()
            termRef.current.focus()
          }
        } catch {
          // Ignore
        }
      }
      // Double rAF to ensure container has dimensions
      requestAnimationFrame(() => requestAnimationFrame(refit))
      // Fallback for slower layout reflows
      const timer = setTimeout(refit, 150)
      return () => clearTimeout(timer)
    }
  }, [visible, active, terminalId])

  // Focus xterm when this terminal becomes the active one
  const activeTerminalId = useTerminalStore(s => s.activeTerminalId)
  useEffect(() => {
    if (activeTerminalId === terminalId && visible && termRef.current) {
      requestAnimationFrame(() => termRef.current?.focus())
    }
  }, [activeTerminalId, terminalId, visible])

  // Focus search input when search opens
  useEffect(() => {
    if (searchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus())
    } else {
      setSearchQuery('')
    }
  }, [searchOpen])

  // Buffer-based search: scan terminal buffer lines for query text
  const bufferSearch = useCallback((query: string, direction: 'next' | 'prev') => {
    const term = termRef.current
    if (!term || !query) return
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
      // Find which line the match is on and scroll to it
      let charCount = 0
      for (let i = 0; i < lines.length; i++) {
        if (charCount + lines[i].length >= idx) {
          const scrollTarget = Math.max(0, i - Math.floor(term.rows / 2))
          term.scrollToLine(scrollTarget)
          break
        }
        charCount += lines[i].length + 1 // +1 for newline
      }
    }
  }, [])

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setSearchOpen(false)
    } else if (e.key === 'Enter') {
      bufferSearch(searchQuery, e.shiftKey ? 'prev' : 'next')
    }
  }, [searchQuery, bufferSearch])

  return (
    <div
      className="terminal-view-wrapper"
      style={{ display: visible ? 'block' : 'none' }}
    >
      <div
        className="terminal-view"
        style={{ position: 'relative', height: '100%' }}
        ref={xtermContainerRef}
        onContextMenu={(e) => {
          e.preventDefault()
          setContextMenu({ x: e.clientX, y: e.clientY })
        }}
      />
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
          <button onClick={() => bufferSearch(searchQuery, 'prev')} title="Previous (Shift+Enter)">&#x25B2;</button>
          <button onClick={() => bufferSearch(searchQuery, 'next')} title="Next (Enter)">&#x25BC;</button>
          <button onClick={() => setSearchOpen(false)} title="Close (Escape)">&times;</button>
        </div>
      )}
      {contextMenu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{
            left: Math.min(contextMenu.x, window.innerWidth - 160),
            ...(contextMenu.y + 120 > window.innerHeight
              ? { bottom: window.innerHeight - contextMenu.y }
              : { top: contextMenu.y })
          }}
        >
          <button
            className="context-menu-item"
            onClick={() => { handleCopy(); setContextMenu(null) }}
          >
            Copy
          </button>
          <button
            className="context-menu-item"
            onClick={() => { handlePaste(); setContextMenu(null) }}
          >
            Paste
          </button>
          <div className="context-menu-separator" />
          <button
            className="context-menu-item"
            disabled={!termRef.current?.getSelection()}
            onClick={() => { handleSendToClaude(); setContextMenu(null) }}
          >
            Send to Claude
          </button>
          <button
            className="context-menu-item"
            disabled={!termRef.current?.getSelection()}
            onClick={() => { handleSendToClaude(true); setContextMenu(null) }}
          >
            Send to Claude (Run)
          </button>
          <div className="context-menu-separator" />
          <button
            className="context-menu-item context-menu-item-danger"
            onClick={() => {
              window.api.terminal.close(terminalId)
              useTerminalStore.getState().removeTerminal(terminalId)
              setContextMenu(null)
            }}
          >
            Kill
          </button>
        </div>
      )}
    </div>
  )
}
