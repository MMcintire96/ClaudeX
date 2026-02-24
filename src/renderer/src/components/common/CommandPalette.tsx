import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore } from '../../stores/sessionStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useUIStore } from '../../stores/uiStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { THEME_META, ThemeName } from '../../lib/themes'

type PaletteCategory = 'command' | 'file' | 'session' | 'terminal' | 'project' | 'branch' | 'theme'

interface PaletteItem {
  id: string
  category: PaletteCategory
  label: string
  description?: string
  shortcut?: string
  action: () => void
}

const CATEGORY_LABELS: Record<PaletteCategory, string> = {
  command: 'Commands',
  file: 'Files',
  session: 'Sessions',
  terminal: 'Terminals',
  project: 'Recent Projects',
  branch: 'Git Branches',
  theme: 'Themes'
}

function fuzzyMatch(query: string, text: string): { match: boolean; score: number } {
  const q = query.toLowerCase()
  const t = text.toLowerCase()

  if (t.includes(q)) {
    return { match: true, score: t.startsWith(q) ? 3 : t.indexOf(q) === 0 ? 2 : 1 }
  }

  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  if (qi === q.length) {
    return { match: true, score: 0.5 }
  }

  return { match: false, score: 0 }
}

interface CommandPaletteProps {
  onClose: () => void
}

export default function CommandPalette({ onClose }: CommandPaletteProps) {
  const currentPath = useProjectStore(s => s.currentPath)
  const modKey = useSettingsStore(s => s.modKey)
  const modLabel = modKey === 'Meta' ? '\u2318' : modKey

  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const selectedItemRef = useRef<HTMLDivElement>(null)

  // Async data
  const filesRef = useRef<string[]>([])
  const historyRef = useRef<Array<{ id: string; name: string; createdAt: number }>>([])
  const branchesRef = useRef<{ current?: string; branches: string[] }>({ branches: [] })
  const [asyncTick, setAsyncTick] = useState(0)

  // Auto-focus input
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Load async data on mount
  useEffect(() => {
    if (!currentPath) return
    let cancelled = false

    window.api.project.listFiles(currentPath).then(r => {
      if (cancelled || !r.success) return
      filesRef.current = r.files
      setAsyncTick(n => n + 1)
    })

    window.api.session.history(currentPath).then(entries => {
      if (cancelled) return
      historyRef.current = entries.map(e => ({ id: e.id, name: e.name, createdAt: e.createdAt }))
      setAsyncTick(n => n + 1)
    })

    window.api.project.gitBranches(currentPath).then(r => {
      if (cancelled || !r.success) return
      branchesRef.current = { current: r.current, branches: r.branches || [] }
      setAsyncTick(n => n + 1)
    })

    return () => { cancelled = true }
  }, [currentPath])

  const buildAllItems = useCallback((): PaletteItem[] => {
    const items: PaletteItem[] = []

    // === Commands ===
    const commands: PaletteItem[] = [
      {
        id: 'cmd:toggle-sidebar',
        category: 'command',
        label: 'Toggle Sidebar',
        shortcut: `${modLabel}+S`,
        action: () => useUIStore.getState().toggleSidebar()
      },
      {
        id: 'cmd:toggle-terminal',
        category: 'command',
        label: 'Toggle Terminal',
        shortcut: 'Ctrl+`',
        action: () => useTerminalStore.getState().togglePanel()
      },
      {
        id: 'cmd:new-session',
        category: 'command',
        label: 'New Claude Session',
        shortcut: `${modLabel}+N`,
        action: () => {
          if (!currentPath) return
          const store = useSessionStore.getState()
          const count = Object.values(store.sessions).filter(s => s.projectPath === currentPath).length
          const sessionId = `sdk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          store.createSession(currentPath, sessionId)
          store.renameSession(sessionId, `Claude Code${count > 0 ? ` ${count + 1}` : ''}`)
        }
      },
      {
        id: 'cmd:new-terminal',
        category: 'command',
        label: 'New Shell Terminal',
        shortcut: `${modLabel}+T`,
        action: () => {
          if (!currentPath) return
          window.api.terminal.create(currentPath).then(r => {
            if (r.success && r.id) {
              useTerminalStore.getState().addTerminal({ id: r.id, projectPath: r.projectPath!, pid: r.pid! })
            }
          })
        }
      },
      {
        id: 'cmd:open-project',
        category: 'command',
        label: 'Open Project',
        shortcut: `${modLabel}+O`,
        action: () => {
          window.api.project.open().then(r => {
            if (r.success && r.path) {
              useProjectStore.getState().setProject(r.path, r.isGitRepo ?? false)
            }
          })
        }
      },
      {
        id: 'cmd:toggle-browser',
        category: 'command',
        label: 'Toggle Browser Panel',
        shortcut: `${modLabel}+B`,
        action: () => {
          if (!currentPath) return
          const { sidePanelView, setSidePanelView } = useUIStore.getState()
          if (sidePanelView?.type === 'browser' && sidePanelView.projectPath === currentPath) {
            setSidePanelView(null)
          } else {
            setSidePanelView({ type: 'browser', projectPath: currentPath })
          }
        }
      },
      {
        id: 'cmd:toggle-diff',
        category: 'command',
        label: 'Toggle Diff Panel',
        shortcut: `${modLabel}+D`,
        action: () => {
          if (!currentPath) return
          const { sidePanelView, setSidePanelView } = useUIStore.getState()
          if (sidePanelView?.type === 'diff' && sidePanelView.projectPath === currentPath) {
            setSidePanelView(null)
          } else {
            setSidePanelView({ type: 'diff', projectPath: currentPath })
          }
        }
      },
      {
        id: 'cmd:cycle-theme',
        category: 'command',
        label: 'Cycle Color Scheme',
        shortcut: `${modLabel}+L`,
        action: () => useUIStore.getState().cycleTheme()
      },
      {
        id: 'cmd:voice-input',
        category: 'command',
        label: 'Voice Input',
        shortcut: `${modLabel}+V`,
        action: () => window.dispatchEvent(new CustomEvent('voice-toggle'))
      },
      {
        id: 'cmd:close-session',
        category: 'command',
        label: 'Close Active Session',
        shortcut: `${modLabel}+W`,
        action: () => {
          if (!currentPath) return
          const store = useSessionStore.getState()
          const activeId = store.activeSessionId
          if (activeId) {
            window.api.agent.stop(activeId).catch(() => {})
            store.removeSession(activeId)
          }
        }
      },
      {
        id: 'cmd:toggle-popout',
        category: 'command',
        label: 'Toggle Chat Pop-out',
        shortcut: `${modLabel}+P`,
        action: () => useUIStore.getState().toggleChatDetached()
      },
      {
        id: 'cmd:reload-window',
        category: 'command',
        label: 'Reload Window',
        action: () => window.api.win.reload()
      },
      {
        id: 'cmd:devtools',
        category: 'command',
        label: 'Developer Tools',
        action: () => window.api.win.devtools()
      }
    ]
    items.push(...commands)

    // === Files ===
    for (const f of filesRef.current) {
      items.push({
        id: `file:${f}`,
        category: 'file',
        label: f.split('/').pop() || f,
        description: f,
        action: () => {
          if (currentPath) window.api.project.openInEditor(currentPath, f)
        }
      })
    }

    // === Active Sessions ===
    if (currentPath) {
      const sessions = useSessionStore.getState().getSessionsForProject(currentPath)
      for (const s of sessions) {
        items.push({
          id: `session:${s.sessionId}`,
          category: 'session',
          label: s.name,
          description: 'Active',
          action: () => useSessionStore.getState().setActiveSession(s.sessionId)
        })
      }
    }

    // === Session History ===
    const activeIds = new Set(Object.keys(useSessionStore.getState().sessions))
    for (const h of historyRef.current) {
      if (activeIds.has(h.id)) continue
      items.push({
        id: `history:${h.id}`,
        category: 'session',
        label: h.name,
        description: new Date(h.createdAt).toLocaleDateString(),
        action: () => {
          // Resume: create session and load history
          if (!currentPath) return
          const store = useSessionStore.getState()
          store.createSession(currentPath, h.id)
          store.renameSession(h.id, h.name)
        }
      })
    }

    // === Terminals ===
    if (currentPath) {
      const terminals = useTerminalStore.getState().terminals.filter(t => t.projectPath === currentPath)
      for (const t of terminals) {
        items.push({
          id: `terminal:${t.id}`,
          category: 'terminal',
          label: t.name || `Terminal ${t.id.slice(-4)}`,
          action: () => {
            const store = useTerminalStore.getState()
            store.setActiveTerminal(t.id)
            if (!store.panelVisible) store.togglePanel()
          }
        })
      }
    }

    // === Recent Projects ===
    const recentProjects = useProjectStore.getState().recentProjects
    for (const p of recentProjects) {
      if (p.path === currentPath) continue
      items.push({
        id: `project:${p.path}`,
        category: 'project',
        label: p.name,
        description: p.path,
        action: () => {
          window.api.project.selectRecent(p.path).then(r => {
            if (r.success) useProjectStore.getState().setProject(r.path, r.isGitRepo)
          })
        }
      })
    }

    // === Git Branches ===
    const { current: currentBranch, branches } = branchesRef.current
    for (const branch of branches) {
      if (branch === currentBranch) continue
      items.push({
        id: `branch:${branch}`,
        category: 'branch',
        label: branch,
        description: currentBranch ? `current: ${currentBranch}` : undefined,
        action: () => {
          if (!currentPath) return
          window.api.project.gitCheckout(currentPath, branch).then(r => {
            if (r.success) {
              useProjectStore.getState().setGitBranch(currentPath!, branch)
            }
          })
        }
      })
    }

    // === Themes ===
    const currentTheme = useUIStore.getState().theme
    for (const t of THEME_META) {
      if (t.id === currentTheme) continue
      items.push({
        id: `theme:${t.id}`,
        category: 'theme',
        label: t.label,
        description: t.isDark ? 'Dark' : 'Light',
        action: () => useUIStore.getState().setTheme(t.id as ThemeName)
      })
    }

    return items
  }, [currentPath, modLabel, asyncTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filter items
  const filteredItems = useMemo(() => {
    const allItems = buildAllItems()

    if (!query.trim()) {
      // Default view: commands + active sessions + recent projects
      return allItems.filter(i => ['command', 'session', 'project'].includes(i.category)).slice(0, 30)
    }

    return allItems
      .map(item => ({ item, ...fuzzyMatch(query, item.label + ' ' + (item.description || '')) }))
      .filter(r => r.match)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map(r => r.item)
  }, [query, buildAllItems])

  // Reset selection on query change
  useEffect(() => { setSelectedIndex(0) }, [query])

  // Scroll selected into view
  useEffect(() => {
    selectedItemRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setSelectedIndex(i => Math.min(i + 1, filteredItems.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setSelectedIndex(i => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (filteredItems[selectedIndex]) {
          filteredItems[selectedIndex].action()
          onClose()
        }
        break
      case 'Escape':
        e.preventDefault()
        onClose()
        break
    }
  }

  const renderResults = () => {
    if (filteredItems.length === 0) {
      return <div className="cmd-palette-empty">No results found</div>
    }

    const elements: React.ReactNode[] = []
    let lastCategory: PaletteCategory | null = null
    let flatIndex = 0

    for (const item of filteredItems) {
      if (item.category !== lastCategory) {
        elements.push(
          <div key={`cat-${item.category}`} className="cmd-palette-category">
            {CATEGORY_LABELS[item.category]}
          </div>
        )
        lastCategory = item.category
      }

      const idx = flatIndex++
      elements.push(
        <div
          key={item.id}
          className="cmd-palette-item"
          data-selected={idx === selectedIndex}
          ref={idx === selectedIndex ? selectedItemRef : undefined}
          onClick={() => { item.action(); onClose() }}
          onMouseEnter={() => setSelectedIndex(idx)}
        >
          <span className="cmd-palette-item-label">{item.label}</span>
          {item.description && (
            <span className="cmd-palette-item-description">{item.description}</span>
          )}
          {item.shortcut && (
            <span className="cmd-palette-item-shortcut">
              {item.shortcut.split('+').map((k, i) => (
                <kbd key={i}>{k.trim()}</kbd>
              ))}
            </span>
          )}
        </div>
      )
    }

    return elements
  }

  return (
    <div className="cmd-palette-overlay" onClick={onClose}>
      <div className="cmd-palette" onClick={e => e.stopPropagation()}>
        <div className="cmd-palette-input-wrapper">
          <input
            ref={inputRef}
            className="cmd-palette-input"
            placeholder="Search commands, files, sessions..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="cmd-palette-results">
          {renderResults()}
        </div>
      </div>
    </div>
  )
}
