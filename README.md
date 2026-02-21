# ClaudeX

A desktop IDE for managing Claude Code agent sessions across multiple projects. Built with Electron, React, and TypeScript.

ClaudeX gives you a visual interface to run Claude Code agents with integrated terminals, an embedded browser, diff views, and session persistence — all in one window.

## Features

- **Multi-project management** — Open and switch between multiple projects with independent sessions
- **Agent sessions** — Spawn Claude Code agents with streaming output, tool use visualization, and cost tracking
- **Integrated terminals** — Per-project PTY terminals with optional tmux integration and Claude attention detection
- **Embedded browser** — Side-panel browser with tabs for previewing web apps alongside your code
- **Diff viewer** — GitHub-style diff visualization for reviewing changes
- **Git worktrees** — Create isolated worktrees per session with branch selection and automatic cleanup
- **Session persistence** — Sessions survive restarts; conversation history and layout state are restored
- **Popout chat** — Detach conversations into floating windows
- **Vim mode** — Optional Vim keybindings for the chat input
- **Themes** — Dark, Light, and Monokai themes with terminal color sync
- **Model switching** — Choose between Opus, Sonnet, and Haiku per session

## Installation

### Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated

### Pre-built packages

Download the latest release from the [Releases](https://github.com/MMcintire96/ClaudeX/releases) page, then:

**AppImage (any Linux distro):**
```bash
chmod +x ClaudeX-*.AppImage
./ClaudeX-*.AppImage
```

**Deb (Debian/Ubuntu):**
```bash
sudo dpkg -i claudex_*_amd64.deb
```

**macOS:**
Open the `.dmg` and drag ClaudeX to Applications.

**Windows:**
Run the `.exe` installer.

### Build from source

Requires Node.js (v18+) and npm.

```bash
git clone https://github.com/MMcintire96/ClaudeX.git
cd ClaudeX
npm install
npm run package    # Outputs to dist/
```

### Development

```bash
npm run dev        # Start with hot reload
npm run build      # Build all bundles
npm run preview    # Preview production build
```

## Architecture

ClaudeX follows Electron's three-process model:

```
src/
├── main/           # Main process — app lifecycle, native APIs, agent/terminal management
│   ├── agent/      #   AgentManager → AgentProcess → claude CLI
│   ├── bridge/     #   ClaudexBridgeServer (MCP tool bridge)
│   ├── browser/    #   Embedded browser tabs
│   ├── terminal/   #   PTY + tmux terminal management
│   ├── worktree/   #   Git worktree lifecycle
│   ├── project/    #   Project & git operations
│   └── session/    #   State persistence & session file watching
├── preload/        # Preload bridge — exposes window.api via contextBridge
└── renderer/       # React UI — components, Zustand stores, hooks
    ├── components/
    │   ├── chat/       # Chat view, message rendering, tool blocks
    │   ├── layout/     # App shell, sidebar, panels
    │   ├── terminal/   # xterm.js terminal views
    │   ├── diff/       # Diff panel with diff2html
    │   └── settings/   # Settings panel
    └── stores/         # Zustand state (session, project, terminal, ui, settings)
```

### How agents work

1. `AgentManager` spawns a `claude` CLI process with streaming JSON output
2. `StreamParser` converts the stream into typed events
3. Events flow to the renderer via IPC and are processed by `sessionStore`
4. Each agent gets an MCP config pointing to `ClaudexBridgeServer`, a localhost HTTP server that exposes terminal, browser, and session tools back to the agent

### Key technologies

- **Electron 40** — Desktop runtime
- **React 19** — UI framework
- **Zustand** — State management
- **xterm.js** — Terminal rendering
- **node-pty** — PTY creation
- **simple-git** — Git operations
- **electron-vite** — Build tooling

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Mod+N` | New session |
| `Mod+T` | New terminal |
| `Mod+O` | Open project |
| `Mod+B` | Toggle browser panel |
| `Mod+D` | Toggle diff panel |
| `Mod+S` | Toggle sidebar |
| `Mod+L` | Clear chat |
| `Mod+W` | Toggle worktree |
| `Mod+1-9` | Switch terminal tabs |
| `Shift+Tab` | Toggle plan/execute mode |

## License

MIT
