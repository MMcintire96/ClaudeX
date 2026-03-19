import React, { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal, FitAddon } from 'ghostty-web'
import { useUIStore } from '../../stores/uiStore'
import { useEditorStore } from '../../stores/editorStore'
import { XTERM_THEMES } from '../../lib/xtermThemes'

interface Props {
  projectPath: string | null
  visible: boolean
}

export default function NeovimEditor({ projectPath, visible }: Props) {
  const xtermContainerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const theme = useUIStore(s => s.theme)
  const setEditorActive = useEditorStore(s => s.setEditorActive)
  const removeEditor = useEditorStore(s => s.removeEditor)
  const projectPathRef = useRef(projectPath)
  projectPathRef.current = projectPath

  // Track whether we've ever been visible — gate creation on this
  const [initialized, setInitialized] = useState(false)
  const [exited, setExited] = useState(false)
  useEffect(() => {
    if (visible && projectPath && !initialized) {
      setInitialized(true)
    }
  }, [visible, projectPath, initialized])

  const spawnNeovim = useCallback(async (path: string) => {
    const result = await window.api.neovim.create(path)
    if (result.success) {
      setEditorActive(path, result.pid!)
    }
  }, [setEditorActive])

  // Initialize xterm + spawn neovim — only after first visible
  useEffect(() => {
    if (!initialized || !xtermContainerRef.current || !projectPath) return

    const xtermTheme = XTERM_THEMES[theme] || XTERM_THEMES.dark

    const term = new Terminal({
      fontSize: 13,
      fontFamily: "'SF Mono', 'Fira Code', 'Cascadia Code', monospace",
      theme: xtermTheme,
      cursorBlink: true,
      scrollback: 1000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(xtermContainerRef.current)

    termRef.current = term
    fitAddonRef.current = fitAddon

    // Fit after layout settles (container is now visible)
    const doFit = () => {
      try {
        fitAddon.fit()
        if (projectPathRef.current) {
          window.api.neovim.resize(projectPathRef.current, term.cols, term.rows)
        }
      } catch {
        // Ignore fit errors
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(doFit))
    const fitTimer = setTimeout(doFit, 100)

    // User keystrokes → neovim PTY
    const onDataDisposable = term.onData((data: string) => {
      if (projectPathRef.current) {
        window.api.neovim.write(projectPathRef.current, data)
      }
    })

    // Neovim PTY output → terminal screen
    const unsubData = window.api.neovim.onData(
      (path: string, data: string) => {
        if (path === projectPathRef.current) {
          term.write(data)
        }
      }
    )

    // Neovim exit
    const unsubExit = window.api.neovim.onExit((path: string) => {
      if (path === projectPathRef.current) {
        setExited(true)
        removeEditor(path)
      }
    })

    // ResizeObserver → fit + notify neovim PTY
    const observer = new ResizeObserver(() => {
      try {
        fitAddon.fit()
        if (projectPathRef.current) {
          window.api.neovim.resize(projectPathRef.current, term.cols, term.rows)
        }
      } catch {
        // Ignore resize errors
      }
    })
    observer.observe(xtermContainerRef.current)

    // Spawn neovim
    spawnNeovim(projectPath)

    return () => {
      clearTimeout(fitTimer)
      observer.disconnect()
      onDataDisposable.dispose()
      unsubData()
      unsubExit()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [initialized, projectPath]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update theme without re-creating terminal
  useEffect(() => {
    const term = termRef.current
    if (term) {
      const base = XTERM_THEMES[theme] || XTERM_THEMES.dark
      term.options.theme = base
    }
  }, [theme])

  // Re-fit when becoming visible again (after tab switch)
  useEffect(() => {
    if (!visible || !fitAddonRef.current || !termRef.current) return
    const refit = () => {
      try {
        fitAddonRef.current?.fit()
        if (termRef.current && projectPathRef.current) {
          window.api.neovim.resize(projectPathRef.current, termRef.current.cols, termRef.current.rows)
        }
      } catch {
        // Ignore
      }
    }
    requestAnimationFrame(() => requestAnimationFrame(refit))
    const timer = setTimeout(refit, 150)
    return () => clearTimeout(timer)
  }, [visible])

  // Respawn Neovim when switching to editor tab after it exited
  useEffect(() => {
    if (!visible || !exited || !projectPath || !termRef.current) return
    const term = termRef.current
    term.clear()
    setExited(false)
    spawnNeovim(projectPath).then(() => {
      // Re-fit after spawn so neovim gets the correct dimensions
      try {
        fitAddonRef.current?.fit()
        if (termRef.current && projectPathRef.current) {
          window.api.neovim.resize(projectPathRef.current, termRef.current.cols, termRef.current.rows)
        }
      } catch {
        // Ignore
      }
    })
  }, [visible, exited, projectPath, spawnNeovim])

  if (!projectPath) {
    return (
      <div className="neovim-editor-empty">
        <p>Open a project to use the editor</p>
      </div>
    )
  }

  return (
    <div
      className="neovim-editor-wrapper"
      style={{ display: visible ? 'flex' : 'none', flex: 1, flexDirection: 'column', overflow: 'hidden' }}
    >
      <div
        className="neovim-editor-xterm"
        ref={xtermContainerRef}
        style={{ flex: 1 }}
      />
    </div>
  )
}
