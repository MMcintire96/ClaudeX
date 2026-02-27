import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { useUIStore } from '../../stores/uiStore'
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
  const searchAddonRef = useRef<SearchAddon | null>(null)
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
      // Wrap in bracket paste sequences so CLI programs (e.g. Claude Code)
      // detect this as pasted text rather than individual keystrokes
      window.api.terminal.write(terminalId, `\x1b[200~${text}\x1b[201~`)
    }
  }, [terminalId])

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
      allowProposedApi: true,
      rightClickSelectsWord: true
    })

    const fitAddon = new FitAddon()
    const searchAddon = new SearchAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(searchAddon)
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
    searchAddonRef.current = searchAddon

    // Ctrl+Shift+C = copy, Ctrl+Shift+V = paste, Ctrl+F = search
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey) {
        if (e.key === 'C' || e.code === 'KeyC') {
          const selection = term.getSelection()
          if (selection) navigator.clipboard.writeText(selection)
          return false
        }
        if (e.key === 'V' || e.code === 'KeyV') {
          navigator.clipboard.readText().then(text => {
            if (text) window.api.terminal.write(terminalId, `\x1b[200~${text}\x1b[201~`)
          })
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

    // Prevent xterm's built-in paste handler so Ctrl+Shift+V doesn't paste twice
    const xtermEl = xtermContainerRef.current!.querySelector('.xterm') as HTMLElement | null
    const preventDoublePaste = (e: ClipboardEvent) => e.preventDefault()
    xtermEl?.addEventListener('paste', preventDoublePaste)

    // User keystrokes → PTY
    const onDataDisposable = term.onData((data: string) => {
      window.api.terminal.write(terminalId, data)
    })

    // PTY output → terminal screen (filtered by terminal ID)
    const unsubData = window.api.terminal.onData(
      (id: string, data: string) => {
        if (id === terminalId) {
          term.write(data)
        }
      }
    )

    // PTY exit → handled by store (via App.tsx listener)
    const unsubExit = window.api.terminal.onExit((id: string) => {
      if (id === terminalId) {
        term.write('\r\n\x1b[90m[Process exited]\x1b[0m\r\n')
      }
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
      xtermEl?.removeEventListener('paste', preventDoublePaste)
      observer.disconnect()
      onDataDisposable.dispose()
      unsubData()
      unsubExit()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
    }
  }, [terminalId]) // Only re-create on terminal ID change

  // Update theme without re-creating terminal
  useEffect(() => {
    const term = termRef.current
    if (term) {
      const base = XTERM_THEMES[theme] || XTERM_THEMES.dark
      term.options.theme = background ? { ...base, background } : base
      // Force a full repaint so existing content picks up the new colors
      term.refresh(0, term.rows - 1)
    }
  }, [theme, background])

  // Re-fit when visibility or active tab changes
  useEffect(() => {
    if (visible && fitAddonRef.current && termRef.current) {
      const refit = () => {
        try {
          fitAddonRef.current?.fit()
          if (termRef.current) {
            window.api.terminal.resize(terminalId, termRef.current.cols, termRef.current.rows)
            termRef.current.scrollToBottom()
            termRef.current.refresh(0, termRef.current.rows - 1)
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
          <button onClick={() => searchAddonRef.current?.findPrevious(searchQuery)} title="Previous (Shift+Enter)">&#x25B2;</button>
          <button onClick={() => searchAddonRef.current?.findNext(searchQuery)} title="Next (Enter)">&#x25BC;</button>
          <button onClick={() => setSearchOpen(false)} title="Close (Escape)">&times;</button>
        </div>
      )}
      {contextMenu && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
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
        </div>
      )}
    </div>
  )
}
