import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { useProjectStore } from '../../stores/projectStore'
import { useSessionStore, UIMessage } from '../../stores/sessionStore'
import { useTerminalStore } from '../../stores/terminalStore'
import { useUIStore } from '../../stores/uiStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useEditorStore } from '../../stores/editorStore'
import { THEME_META, ThemeName } from '../../lib/themes'
import hljs, { detectLanguage } from '../../lib/hljs'

type PaletteCategory = 'command' | 'file' | 'session' | 'terminal' | 'project' | 'branch' | 'theme'

interface PaletteItem {
  id: string
  category: PaletteCategory
  label: string
  description?: string
  shortcut?: string
  action: () => void
  // Preview metadata
  filePath?: string       // for files: relative path
  sessionId?: string      // for sessions: session ID
  branchName?: string     // for branches
  themeId?: string        // for themes
  projectPath?: string    // for recent projects
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

const CATEGORY_ICONS: Record<PaletteCategory, string> = {
  command: '\u25B6',
  file: '\u2630',
  session: '\u25CB',
  terminal: '\u25A0',
  project: '\u25A1',
  branch: '\u2387',
  theme: '\u25D0'
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// File extension to language name for display
function extToLang(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const map: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TypeScript JSX', js: 'JavaScript', jsx: 'JavaScript JSX',
    py: 'Python', rs: 'Rust', go: 'Go', rb: 'Ruby', java: 'Java', kt: 'Kotlin',
    cpp: 'C++', c: 'C', h: 'C Header', hpp: 'C++ Header', cs: 'C#',
    css: 'CSS', scss: 'SCSS', less: 'LESS', html: 'HTML', vue: 'Vue',
    json: 'JSON', yaml: 'YAML', yml: 'YAML', toml: 'TOML', xml: 'XML',
    md: 'Markdown', txt: 'Text', sh: 'Shell', bash: 'Bash', zsh: 'Zsh',
    sql: 'SQL', graphql: 'GraphQL', proto: 'Protobuf', swift: 'Swift',
    lua: 'Lua', zig: 'Zig', svelte: 'Svelte', astro: 'Astro',
  }
  return map[ext] || ext.toUpperCase() || 'File'
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

// --- Preview sub-component ---
function PreviewPane({ item, currentPath }: { item: PaletteItem | null; currentPath: string | null }) {
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [fileLoading, setFileLoading] = useState(false)
  const [fileMeta, setFileMeta] = useState<{ binary?: boolean; truncated?: boolean } | null>(null)
  const loadingFileRef = useRef<string | null>(null)

  // Load file content when a file item is selected
  useEffect(() => {
    if (!item || item.category !== 'file' || !item.filePath || !currentPath) {
      setFileContent(null)
      setFileMeta(null)
      loadingFileRef.current = null
      return
    }

    const filePath = item.filePath
    loadingFileRef.current = filePath
    setFileLoading(true)

    window.api.project.readFile(currentPath, filePath, 48 * 1024).then(r => {
      // Only update if this is still the current file
      if (loadingFileRef.current !== filePath) return
      if (r.success) {
        setFileContent(r.content ?? '')
        setFileMeta({ binary: r.binary, truncated: r.truncated })
      } else {
        setFileContent(null)
        setFileMeta(null)
      }
      setFileLoading(false)
    }).catch(() => {
      if (loadingFileRef.current !== filePath) return
      setFileContent(null)
      setFileLoading(false)
    })
  }, [item?.id, item?.filePath, currentPath]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!item) {
    return (
      <div className="cmd-palette-preview">
        <div className="cmd-palette-preview-empty">
          <span className="cmd-palette-preview-empty-icon">\u2630</span>
          <span>Select an item to preview</span>
        </div>
      </div>
    )
  }

  // === File preview ===
  if (item.category === 'file') {
    const filename = item.filePath || item.label
    const lang = extToLang(filename)

    if (fileLoading) {
      return (
        <div className="cmd-palette-preview">
          <div className="cmd-palette-preview-header">
            <span className="cmd-palette-preview-filename">{filename}</span>
            <span className="cmd-palette-preview-lang">{lang}</span>
          </div>
          <div className="cmd-palette-preview-body">
            <div className="cmd-palette-preview-loading">Loading...</div>
          </div>
        </div>
      )
    }

    if (fileMeta?.binary) {
      return (
        <div className="cmd-palette-preview">
          <div className="cmd-palette-preview-header">
            <span className="cmd-palette-preview-filename">{filename}</span>
            <span className="cmd-palette-preview-lang">Binary</span>
          </div>
          <div className="cmd-palette-preview-body">
            <div className="cmd-palette-preview-empty">Binary file — cannot preview</div>
          </div>
        </div>
      )
    }

    if (fileContent !== null) {
      const lines = fileContent.split('\n')
      const hljsLang = detectLanguage(filename)
      // Highlight each line, carrying state across lines for multi-line tokens
      let highlightedLines: string[]
      if (hljsLang) {
        highlightedLines = []
        let continuation: ReturnType<typeof hljs.highlight> | null = null
        for (const line of lines) {
          const result = hljs.highlight(line, {
            language: hljsLang,
            ignoreIllegals: true,
            ...(continuation ? { continuation } as Record<string, unknown> : {})
          })
          highlightedLines.push(result.value)
          continuation = result
        }
      } else {
        highlightedLines = lines.map(l => escapeHtml(l))
      }

      return (
        <div className="cmd-palette-preview">
          <div className="cmd-palette-preview-header">
            <span className="cmd-palette-preview-filename">{filename}</span>
            <span className="cmd-palette-preview-lang">{lang}</span>
          </div>
          <div className="cmd-palette-preview-body cmd-palette-preview-code">
            <table className="cmd-palette-preview-lines">
              <tbody>
                {highlightedLines.map((html, i) => (
                  <tr key={i}>
                    <td className="cmd-palette-line-num">{i + 1}</td>
                    <td className="cmd-palette-line-content">
                      <pre dangerouslySetInnerHTML={{ __html: html || ' ' }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {fileMeta?.truncated && (
              <div className="cmd-palette-preview-truncated">File truncated...</div>
            )}
          </div>
        </div>
      )
    }

    return (
      <div className="cmd-palette-preview">
        <div className="cmd-palette-preview-header">
          <span className="cmd-palette-preview-filename">{filename}</span>
        </div>
        <div className="cmd-palette-preview-body">
          <div className="cmd-palette-preview-empty">Could not load file</div>
        </div>
      </div>
    )
  }

  // === Session preview ===
  if (item.category === 'session' && item.sessionId) {
    const session = useSessionStore.getState().sessions[item.sessionId]
    if (session) {
      const messages = session.messages.filter(
        (m: UIMessage) => m.type === 'text' && (m.role === 'user' || m.role === 'assistant')
      )
      const recentMessages = messages.slice(-20)

      return (
        <div className="cmd-palette-preview">
          <div className="cmd-palette-preview-header">
            <span className="cmd-palette-preview-filename">{session.name}</span>
            <span className="cmd-palette-preview-lang">
              {session.numTurns} turn{session.numTurns !== 1 ? 's' : ''}
              {session.totalCostUsd > 0 ? ` \u00b7 $${session.totalCostUsd.toFixed(3)}` : ''}
            </span>
          </div>
          <div className="cmd-palette-preview-body cmd-palette-preview-session">
            {recentMessages.length === 0 ? (
              <div className="cmd-palette-preview-empty">No messages yet</div>
            ) : (
              recentMessages.map((m: UIMessage, i: number) => (
                <div key={i} className={`cmd-palette-preview-msg cmd-palette-preview-msg-${m.role}`}>
                  <span className="cmd-palette-preview-msg-role">{m.role === 'user' ? 'You' : 'Claude'}:</span>
                  <span className="cmd-palette-preview-msg-text">
                    {m.type === 'text' ? (m.content.length > 200 ? m.content.slice(0, 200) + '...' : m.content) : ''}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )
    }
    // History session (not loaded) — show basic info
    return (
      <div className="cmd-palette-preview">
        <div className="cmd-palette-preview-header">
          <span className="cmd-palette-preview-filename">{item.label}</span>
          <span className="cmd-palette-preview-lang">History</span>
        </div>
        <div className="cmd-palette-preview-body">
          <div className="cmd-palette-preview-empty">
            {item.description ? `Created: ${item.description}` : 'Resume to view session'}
          </div>
        </div>
      </div>
    )
  }

  // === Theme preview ===
  if (item.category === 'theme' && item.themeId) {
    const meta = THEME_META.find(t => t.id === item.themeId)
    if (meta) {
      return (
        <div className="cmd-palette-preview">
          <div className="cmd-palette-preview-header">
            <span className="cmd-palette-preview-filename">{meta.label}</span>
            <span className="cmd-palette-preview-lang">{meta.isDark ? 'Dark' : 'Light'}</span>
          </div>
          <div className="cmd-palette-preview-body cmd-palette-preview-theme-body">
            <div
              className="cmd-palette-preview-theme-swatch"
              style={{ background: meta.previewColors.bg }}
            >
              <div className="cmd-palette-preview-theme-bar" style={{ background: meta.previewColors.accent, opacity: 0.9 }} />
              <div className="cmd-palette-preview-theme-text" style={{ color: meta.previewColors.fg }}>
                <span>const app = </span>
                <span style={{ color: meta.previewColors.accent }}>create</span>
                <span>()</span>
              </div>
              <div className="cmd-palette-preview-theme-text" style={{ color: meta.previewColors.fg, opacity: 0.6 }}>
                <span>{'// ' + meta.label + ' theme'}</span>
              </div>
              <div className="cmd-palette-preview-theme-text" style={{ color: meta.previewColors.fg }}>
                <span>app.</span>
                <span style={{ color: meta.previewColors.accent }}>listen</span>
                <span>(3000)</span>
              </div>
            </div>
          </div>
        </div>
      )
    }
  }

  // === Branch preview ===
  if (item.category === 'branch') {
    return (
      <div className="cmd-palette-preview">
        <div className="cmd-palette-preview-header">
          <span className="cmd-palette-preview-filename">{item.label}</span>
          <span className="cmd-palette-preview-lang">Branch</span>
        </div>
        <div className="cmd-palette-preview-body">
          <div className="cmd-palette-preview-info">
            <div className="cmd-palette-preview-info-row">
              <span className="cmd-palette-preview-info-label">Switch to:</span>
              <span className="cmd-palette-preview-info-value">{item.label}</span>
            </div>
            {item.description && (
              <div className="cmd-palette-preview-info-row">
                <span className="cmd-palette-preview-info-label">Currently on:</span>
                <span className="cmd-palette-preview-info-value">{item.description.replace('current: ', '')}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // === Project preview ===
  if (item.category === 'project') {
    return (
      <div className="cmd-palette-preview">
        <div className="cmd-palette-preview-header">
          <span className="cmd-palette-preview-filename">{item.label}</span>
          <span className="cmd-palette-preview-lang">Project</span>
        </div>
        <div className="cmd-palette-preview-body">
          <div className="cmd-palette-preview-info">
            <div className="cmd-palette-preview-info-row">
              <span className="cmd-palette-preview-info-label">Path:</span>
              <span className="cmd-palette-preview-info-value">{item.description || item.projectPath}</span>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // === Command preview (default) ===
  return (
    <div className="cmd-palette-preview">
      <div className="cmd-palette-preview-header">
        <span className="cmd-palette-preview-filename">{item.label}</span>
        <span className="cmd-palette-preview-lang">Command</span>
      </div>
      <div className="cmd-palette-preview-body">
        <div className="cmd-palette-preview-info">
          {item.shortcut && (
            <div className="cmd-palette-preview-info-row">
              <span className="cmd-palette-preview-info-label">Shortcut:</span>
              <span className="cmd-palette-preview-info-value cmd-palette-preview-shortcut">
                {item.shortcut.split('+').map((k, i) => (
                  <kbd key={i}>{k.trim()}</kbd>
                ))}
              </span>
            </div>
          )}
          {item.description && (
            <div className="cmd-palette-preview-info-row">
              <span className="cmd-palette-preview-info-label">Info:</span>
              <span className="cmd-palette-preview-info-value">{item.description}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// --- Main component ---
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
        action: () => { if (!useUIStore.getState().settingsOpen) useTerminalStore.getState().togglePanel() }
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
        id: 'cmd:new-quick-chat',
        category: 'command',
        label: 'New Quick Chat',
        shortcut: `${modLabel}+Shift+N`,
        action: () => {
          const SCRATCH = '__scratch__'
          const store = useSessionStore.getState()
          const count = Object.values(store.sessions).filter(s => s.projectPath === SCRATCH).length
          const sessionId = `sdk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
          store.createSession(SCRATCH, sessionId)
          store.renameSession(sessionId, `Quick Chat${count > 0 ? ` ${count + 1}` : ''}`)
        }
      },
      {
        id: 'cmd:new-terminal',
        category: 'command',
        label: 'New Shell Terminal',
        shortcut: `${modLabel}+T`,
        action: () => {
          if (!currentPath || useUIStore.getState().settingsOpen) return
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
          if (!currentPath || useUIStore.getState().settingsOpen) return
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
          if (!currentPath || useUIStore.getState().settingsOpen) return
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
        id: 'cmd:toggle-editor',
        category: 'command',
        label: 'Toggle Editor',
        shortcut: `${modLabel}+E`,
        action: () => {
          if (useUIStore.getState().settingsOpen) return
          const { mainPanelTab, setMainPanelTab } = useEditorStore.getState()
          setMainPanelTab(mainPanelTab === 'editor' ? 'chat' : 'editor')
        }
      },
      {
        id: 'cmd:toggle-popout',
        category: 'command',
        label: 'Toggle Chat Pop-out',
        shortcut: `${modLabel}+P`,
        action: () => { if (!useUIStore.getState().settingsOpen) useUIStore.getState().toggleChatDetached() }
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
        filePath: f,
        action: () => {
          if (!currentPath) return
          const editorState = useEditorStore.getState()
          // Switch to editor tab (spawns neovim if first time)
          editorState.setMainPanelTab('editor')
          if (editorState.activeEditors[currentPath]) {
            // Neovim already running — open file immediately
            window.api.neovim.openFile(currentPath, f)
          } else {
            // Neovim not yet spawned — wait for it to become ready, then open
            const unsub = useEditorStore.subscribe((state) => {
              if (state.activeEditors[currentPath]?.ready) {
                unsub()
                window.api.neovim.openFile(currentPath, f)
              }
            })
          }
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
          sessionId: s.sessionId,
          action: () => {
            const store = useSessionStore.getState()
            const ui = useUIStore.getState()
            if (ui.splitView && ui.focusedSplitPane === 'right') {
              ui.setSplitSessionId(s.sessionId)
            } else {
              store.setActiveSession(s.sessionId)
            }
            store.markAsRead(s.sessionId)
          }
        })
      }
    }

    // Quick Chat sessions
    const scratchSessions = Object.values(useSessionStore.getState().sessions)
      .filter(s => s.projectPath === '__scratch__')
    for (const s of scratchSessions) {
      items.push({
        id: `session:${s.sessionId}`,
        category: 'session',
        label: s.name,
        description: 'Quick Chat',
        sessionId: s.sessionId,
        action: () => {
          const store = useSessionStore.getState()
          const ui = useUIStore.getState()
          if (ui.splitView && ui.focusedSplitPane === 'right') {
            ui.setSplitSessionId(s.sessionId)
          } else {
            store.setActiveSession(s.sessionId)
          }
          store.markAsRead(s.sessionId)
        }
      })
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
        sessionId: h.id,
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
        projectPath: p.path,
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
        branchName: branch,
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
        themeId: t.id,
        action: () => useUIStore.getState().setTheme(t.id as ThemeName)
      })
    }

    return items
  }, [currentPath, modLabel, asyncTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Filter items
  const filteredItems = useMemo(() => {
    const allItems = buildAllItems()

    if (!query.trim()) {
      // Default view: commands + active sessions + recent projects (no files/branches/terminals/themes)
      const defaultCategories = new Set<PaletteCategory>(['command', 'session', 'project'])
      return allItems.filter(i => defaultCategories.has(i.category)).slice(0, 30)
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

  // Current selected item for preview
  const selectedItem = filteredItems[selectedIndex] ?? null

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
    let catIndex = 0

    for (const item of filteredItems) {
      if (item.category !== lastCategory) {
        elements.push(
          <div key={`cat-${item.category}-${catIndex++}`} className="cmd-palette-category">
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
          <span className="cmd-palette-item-icon">{CATEGORY_ICONS[item.category]}</span>
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
      <div className="cmd-palette cmd-palette-with-preview" onClick={e => e.stopPropagation()}>
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
        <div className="cmd-palette-body">
          <div className="cmd-palette-results">
            {renderResults()}
          </div>
          <div className="cmd-palette-preview-wrapper">
            <PreviewPane item={selectedItem} currentPath={currentPath} />
          </div>
        </div>
      </div>
    </div>
  )
}
