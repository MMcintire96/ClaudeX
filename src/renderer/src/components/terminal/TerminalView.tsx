import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useUIStore } from '../../stores/uiStore'

interface Props {
  terminalId: string
  visible: boolean
  background?: string
}

const DARK_THEME = {
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
}

const LIGHT_THEME = {
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
}

export default function TerminalView({ terminalId, visible, background }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const theme = useUIStore(s => s.theme)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

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
      window.api.terminal.write(terminalId, text)
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
    if (!containerRef.current) return

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: background
        ? { ...(theme === 'dark' ? DARK_THEME : LIGHT_THEME), background }
        : theme === 'dark' ? DARK_THEME : LIGHT_THEME,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      rightClickSelectsWord: true
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)

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

    // Ctrl+Shift+C = copy, Ctrl+Shift+V = paste
    term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey) {
        if (e.key === 'C' || e.code === 'KeyC') {
          const selection = term.getSelection()
          if (selection) navigator.clipboard.writeText(selection)
          return false
        }
        if (e.key === 'V' || e.code === 'KeyV') {
          navigator.clipboard.readText().then(text => {
            if (text) window.api.terminal.write(terminalId, text)
          })
          return false
        }
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
    observer.observe(containerRef.current)

    return () => {
      observer.disconnect()
      onDataDisposable.dispose()
      unsubData()
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
      const base = theme === 'dark' ? DARK_THEME : LIGHT_THEME
      term.options.theme = background ? { ...base, background } : base
      // Force a full repaint so existing content picks up the new colors
      term.refresh(0, term.rows - 1)
    }
  }, [theme, background])

  // Re-fit when visibility changes
  useEffect(() => {
    if (visible && fitAddonRef.current) {
      requestAnimationFrame(() => {
        try {
          fitAddonRef.current?.fit()
        } catch {
          // Ignore
        }
      })
    }
  }, [visible])

  return (
    <div
      className="terminal-view"
      style={{ display: visible ? 'block' : 'none', position: 'relative' }}
      ref={containerRef}
      onContextMenu={(e) => {
        e.preventDefault()
        setContextMenu({ x: e.clientX, y: e.clientY })
      }}
    >
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
