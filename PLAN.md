# Plan: Embed Neovim as Editor Panel in ClaudeX

## Overview

Add a full file-editing Neovim panel to MainPanel as a tab alongside the existing Chat view. Uses the PTY/xterm.js approach — spawn `nvim` in a `node-pty` process and render it in an xterm.js terminal, reusing the same patterns as the existing terminal infrastructure.

## Architecture

```
MainPanel
├── Tab Bar: [Chat] [Editor]
├── ChatView (existing, shown when Chat tab active)
└── NeovimEditor (new, shown when Editor tab active)
        ├── Renderer: xterm.js Terminal (same as TerminalView)
        └── Main process: NeovimManager spawns `nvim` via node-pty
```

The neovim instance is **per-project** — switching projects switches the nvim instance. Each project gets at most one nvim PTY.

## Files to Create

### 1. `src/main/neovim/NeovimManager.ts` — Main process manager

Modeled on `TerminalManager`. Key differences:
- Spawns `nvim` instead of the user's shell
- One instance per project (not multiple like terminals)
- Opens nvim with `cwd` set to the project root
- Accepts an optional file path to open on launch (`nvim <file>`)
- Provides `openFile(projectPath, filePath)` that sends `:e <filePath><CR>` to the PTY
- Uses the same `broadcastSend` pattern for data events (`neovim:data`, `neovim:exit`)

```typescript
class NeovimManager {
  // Map<projectPath, ManagedNeovim>
  create(projectPath: string, filePath?: string): NeovimInfo
  write(projectPath: string, data: string): void
  resize(projectPath: string, cols: number, rows: number): void
  openFile(projectPath: string, filePath: string): void  // sends :e command
  close(projectPath: string): void
  destroy(): void
}
```

### 2. `src/main/ipc/neovimHandlers.ts` — IPC handlers

```
neovim:create   (projectPath, filePath?) → { success, pid }
neovim:write    (projectPath, data)
neovim:resize   (projectPath, cols, rows)
neovim:open-file (projectPath, filePath) → sends :e to nvim
neovim:close    (projectPath)
```

Events pushed to renderer:
```
neovim:data  (projectPath, data)
neovim:exit  (projectPath, exitCode)
```

### 3. `src/preload/index.ts` — Add `api.neovim` namespace

```typescript
neovim: {
  create: (projectPath, filePath?) => ipcRenderer.invoke('neovim:create', ...),
  write: (projectPath, data) => ipcRenderer.invoke('neovim:write', ...),
  resize: (projectPath, cols, rows) => ipcRenderer.invoke('neovim:resize', ...),
  openFile: (projectPath, filePath) => ipcRenderer.invoke('neovim:open-file', ...),
  close: (projectPath) => ipcRenderer.invoke('neovim:close', ...),
  onData: (callback) => ipcRenderer.on('neovim:data', ...),
  onExit: (callback) => ipcRenderer.on('neovim:exit', ...),
}
```

### 4. `src/renderer/src/stores/editorStore.ts` — Zustand store

```typescript
interface EditorState {
  // Per-project neovim state
  activeEditors: Record<string, { pid: number; ready: boolean }>

  // Which MainPanel tab is shown
  mainPanelTab: 'chat' | 'editor'
  setMainPanelTab: (tab: 'chat' | 'editor') => void

  // Editor lifecycle
  setEditorActive: (projectPath: string, pid: number) => void
  removeEditor: (projectPath: string) => void
}
```

### 5. `src/renderer/src/components/editor/NeovimEditor.tsx` — React component

Nearly identical to `TerminalView.tsx` but:
- Keyed by `projectPath` instead of `terminalId`
- On mount: calls `api.neovim.create(projectPath)` to spawn nvim
- Listens to `neovim:data` / `neovim:exit` filtered by projectPath
- User keystrokes → `api.neovim.write(projectPath, data)`
- ResizeObserver → `api.neovim.resize(projectPath, cols, rows)`
- Reuses the same `XTERM_THEMES` from TerminalView (extract to shared file or import)
- **Does NOT** attach Ctrl+Shift+C/V overrides (let nvim handle its own clipboard via OSC 52 or system clipboard)

### 6. `src/renderer/src/components/layout/MainPanel.tsx` — Add tab bar

Modify to support switching between Chat and Editor tabs:

```tsx
export default function MainPanel() {
  const mainPanelTab = useEditorStore(s => s.mainPanelTab)
  const setMainPanelTab = useEditorStore(s => s.setMainPanelTab)
  // ... existing code ...

  return (
    <main className="main-panel">
      {/* Tab bar */}
      <div className="main-panel-tabs">
        <button className={tab === 'chat' ? 'active' : ''} onClick={() => setMainPanelTab('chat')}>
          Chat
        </button>
        <button className={tab === 'editor' ? 'active' : ''} onClick={() => setMainPanelTab('editor')}>
          Editor
        </button>
      </div>

      {/* Tab content */}
      <div style={{ display: mainPanelTab === 'chat' ? undefined : 'none', flex: 1 }}>
        {/* existing ChatView / empty state / detached state */}
      </div>
      <div style={{ display: mainPanelTab === 'editor' ? undefined : 'none', flex: 1 }}>
        <NeovimEditor projectPath={currentPath} />
      </div>
    </main>
  )
}
```

Both views stay mounted (display:none toggle) so nvim doesn't lose state when switching tabs.

## Files to Modify

| File | Change |
|------|--------|
| `src/main/index.ts` | Instantiate `NeovimManager`, pass to `registerAllHandlers`, call `destroy()` on quit |
| `src/main/ipc/index.ts` | Import and call `registerNeovimHandlers(neovimManager)` |
| `src/preload/index.ts` | Add `neovim` namespace to the `api` object |
| `src/renderer/src/components/layout/MainPanel.tsx` | Add tab bar, conditionally render NeovimEditor |
| `src/renderer/src/components/layout/Sidebar.tsx` | Wire "open in editor" from project tree to switch to editor tab + `api.neovim.openFile()` |

## Key Design Decisions

1. **One nvim per project** — simpler than managing multiple nvim instances. Users can use nvim's built-in splits/tabs/buffers for multi-file editing.

2. **Project path as key** — unlike terminals which use UUIDs, neovim instances are keyed by project path since there's only one per project.

3. **Lazy spawn** — nvim is only spawned when the user first switches to the Editor tab for a project, not on project open.

4. **display:none toggling** — both ChatView and NeovimEditor stay mounted. Switching tabs just toggles visibility. This preserves nvim state (buffers, cursor position, undo history) across tab switches.

5. **openFile integration** — clicking a file in the project tree (Sidebar) can send `:e <path>` to the running nvim, switching the editor tab active and jumping to that file.

6. **Theme sync** — reuse the existing `XTERM_THEMES` map. Optionally generate a matching nvim colorscheme, but for MVP the terminal theme is sufficient since nvim inherits terminal colors.

## Implementation Order

1. `NeovimManager` (main process) — spawn/write/resize/close nvim PTY
2. `neovimHandlers.ts` — IPC wiring
3. `preload/index.ts` — expose `api.neovim`
4. `src/main/ipc/index.ts` + `src/main/index.ts` — register handlers, instantiate manager
5. `editorStore.ts` — Zustand state for tab switching
6. `NeovimEditor.tsx` — xterm.js component rendering nvim
7. `MainPanel.tsx` — tab bar + conditional rendering
8. CSS for tab bar styling
9. Sidebar integration — "open in editor" action on file click

## Non-goals (for now)

- Custom nvim UI renderer via `--embed` msgpack-rpc (future evolution)
- LSP or completion integration from ClaudeX into nvim
- Syncing nvim colorscheme with ClaudeX theme
- Multiple nvim instances per project
- Session persistence (restoring nvim state across app restarts)
