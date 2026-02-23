import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { useUIStore } from '../../stores/uiStore'
import type { ThemeName } from '../../lib/themes'

interface Props {
  terminalId: string
  visible: boolean
  active?: boolean
  background?: string
}

const XTERM_THEMES: Record<ThemeName, Record<string, string>> = {
  dark: {
    background: '#1a1a1a',
    foreground: '#e5e5e5',
    cursor: '#e5e5e5',
    selectionBackground: '#444444',
    black: '#000000',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff'
  },
  light: {
    background: '#ffffff',
    foreground: '#1a1a1a',
    cursor: '#1a1a1a',
    selectionBackground: '#add6ff',
    black: '#000000',
    red: '#cd3131',
    green: '#00bc00',
    yellow: '#949800',
    blue: '#0451a5',
    magenta: '#bc05bc',
    cyan: '#0598bc',
    white: '#555555',
    brightBlack: '#666666',
    brightRed: '#cd3131',
    brightGreen: '#14ce14',
    brightYellow: '#b5ba00',
    brightBlue: '#0451a5',
    brightMagenta: '#bc05bc',
    brightCyan: '#0598bc',
    brightWhite: '#1a1a1a'
  },
  monokai: {
    background: '#272822',
    foreground: '#f8f8f2',
    cursor: '#f8f8f0',
    selectionBackground: '#49483e',
    black: '#272822',
    red: '#f92672',
    green: '#a6e22e',
    yellow: '#f4bf75',
    blue: '#66d9ef',
    magenta: '#ae81ff',
    cyan: '#a1efe4',
    white: '#f8f8f2',
    brightBlack: '#75715e',
    brightRed: '#f92672',
    brightGreen: '#a6e22e',
    brightYellow: '#f4bf75',
    brightBlue: '#66d9ef',
    brightMagenta: '#ae81ff',
    brightCyan: '#a1efe4',
    brightWhite: '#f9f8f5'
  },
  'solarized-dark': {
    background: '#002b36',
    foreground: '#839496',
    cursor: '#839496',
    selectionBackground: '#073642',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#586e75',
    brightRed: '#cb4b16',
    brightGreen: '#859900',
    brightYellow: '#b58900',
    brightBlue: '#268bd2',
    brightMagenta: '#6c71c4',
    brightCyan: '#2aa198',
    brightWhite: '#fdf6e3'
  },
  'solarized-light': {
    background: '#fdf6e3',
    foreground: '#657b83',
    cursor: '#657b83',
    selectionBackground: '#eee8d5',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#586e75',
    brightRed: '#cb4b16',
    brightGreen: '#859900',
    brightYellow: '#b58900',
    brightBlue: '#268bd2',
    brightMagenta: '#6c71c4',
    brightCyan: '#2aa198',
    brightWhite: '#fdf6e3'
  },
  nord: {
    background: '#2e3440',
    foreground: '#d8dee9',
    cursor: '#d8dee9',
    selectionBackground: '#434c5e',
    black: '#3b4252',
    red: '#bf616a',
    green: '#a3be8c',
    yellow: '#ebcb8b',
    blue: '#81a1c1',
    magenta: '#b48ead',
    cyan: '#88c0d0',
    white: '#e5e9f0',
    brightBlack: '#4c566a',
    brightRed: '#bf616a',
    brightGreen: '#a3be8c',
    brightYellow: '#ebcb8b',
    brightBlue: '#81a1c1',
    brightMagenta: '#b48ead',
    brightCyan: '#8fbcbb',
    brightWhite: '#eceff4'
  },
  dracula: {
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    selectionBackground: '#44475a',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff'
  },
  'catppuccin-mocha': {
    background: '#1e1e2e',
    foreground: '#cdd6f4',
    cursor: '#f5e0dc',
    selectionBackground: '#45475a',
    black: '#45475a',
    red: '#f38ba8',
    green: '#a6e3a1',
    yellow: '#f9e2af',
    blue: '#89b4fa',
    magenta: '#f5c2e7',
    cyan: '#94e2d5',
    white: '#bac2de',
    brightBlack: '#585b70',
    brightRed: '#f38ba8',
    brightGreen: '#a6e3a1',
    brightYellow: '#f9e2af',
    brightBlue: '#89b4fa',
    brightMagenta: '#f5c2e7',
    brightCyan: '#94e2d5',
    brightWhite: '#a6adc8'
  },
  'tokyo-night': {
    background: '#1a1b26',
    foreground: '#a9b1d6',
    cursor: '#c0caf5',
    selectionBackground: '#33467c',
    black: '#15161e',
    red: '#f7768e',
    green: '#9ece6a',
    yellow: '#e0af68',
    blue: '#7aa2f7',
    magenta: '#bb9af7',
    cyan: '#7dcfff',
    white: '#a9b1d6',
    brightBlack: '#414868',
    brightRed: '#f7768e',
    brightGreen: '#9ece6a',
    brightYellow: '#e0af68',
    brightBlue: '#7aa2f7',
    brightMagenta: '#bb9af7',
    brightCyan: '#7dcfff',
    brightWhite: '#c0caf5'
  },
  'gruvbox-dark': {
    background: '#282828',
    foreground: '#ebdbb2',
    cursor: '#ebdbb2',
    selectionBackground: '#504945',
    black: '#282828',
    red: '#cc241d',
    green: '#98971a',
    yellow: '#d79921',
    blue: '#458588',
    magenta: '#b16286',
    cyan: '#689d6a',
    white: '#a89984',
    brightBlack: '#928374',
    brightRed: '#fb4934',
    brightGreen: '#b8bb26',
    brightYellow: '#fabd2f',
    brightBlue: '#83a598',
    brightMagenta: '#d3869b',
    brightCyan: '#8ec07c',
    brightWhite: '#ebdbb2'
  },
  'one-dark': {
    background: '#282c34',
    foreground: '#abb2bf',
    cursor: '#528bff',
    selectionBackground: '#3e4452',
    black: '#282c34',
    red: '#e06c75',
    green: '#98c379',
    yellow: '#e5c07b',
    blue: '#61afef',
    magenta: '#c678dd',
    cyan: '#56b6c2',
    white: '#abb2bf',
    brightBlack: '#5c6370',
    brightRed: '#e06c75',
    brightGreen: '#98c379',
    brightYellow: '#e5c07b',
    brightBlue: '#61afef',
    brightMagenta: '#c678dd',
    brightCyan: '#56b6c2',
    brightWhite: '#d7dae0'
  },
  'rose-pine': {
    background: '#191724',
    foreground: '#e0def4',
    cursor: '#524f67',
    selectionBackground: '#2a283e',
    black: '#26233a',
    red: '#eb6f92',
    green: '#9ccfd8',
    yellow: '#f6c177',
    blue: '#31748f',
    magenta: '#c4a7e7',
    cyan: '#ebbcba',
    white: '#e0def4',
    brightBlack: '#6e6a86',
    brightRed: '#eb6f92',
    brightGreen: '#9ccfd8',
    brightYellow: '#f6c177',
    brightBlue: '#31748f',
    brightMagenta: '#c4a7e7',
    brightCyan: '#ebbcba',
    brightWhite: '#e0def4'
  }
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
