# ClaudeX

ClaudeX is a desktop IDE built around Claude Code. Instead of running agents in a terminal, you get a proper workspace — multiple agent sessions, integrated terminals, a browser panel, diff views, and everything persists between restarts. Think of it as what Claude Code would look like if it shipped as a native app.

It runs on Linux, macOS, and Windows (unconfirmed, but I doubt as no WSL intergration).

## Screenshots

Main interface — chat, side panels, terminals:

![Main Interface](screenshots/main-interface.png)

Commit dialog — diff-aware with AI message generation:

![Commit Dialog](screenshots/commit-dialog.png)

Command palette — commands, files, sessions, projects, branches, themes:

![Command Palette](screenshots/command-palette.png)

## Automatons

The headline feature. Automatons let you schedule Claude agents to run tasks on their own — no babysitting required. Set up a prompt, pick a schedule, and ClaudeX handles the rest in the background.

**How it works:**

1. Create an automaton with a prompt describing what you want done
2. Choose a schedule — interval, daily, weekly, cron expression, or manual trigger
3. Pick a sandbox mode to control how much access the agent gets:
   - **Read-only** — agent can analyze but not modify anything
   - **Workspace-write** — agent works in an isolated git worktree; you review and apply changes
   - **Full-access** — agent runs directly in your project (use carefully)
4. Results land in a triage inbox where you can review diffs, apply changes, pin important findings, or archive

**Use cases:**
- Nightly code reviews or dependency audits
- Scheduled test analysis and bug triage
- Recurring refactoring or cleanup tasks
- Periodic codebase health checks
- Anything you'd otherwise remember to ask Claude about every few days

Each run tracks cost, duration, turns, and the full agent conversation. Automations that produce changes show up with diffs you can apply in one click. The scheduler ticks every 60 seconds, supports everything from "every 5 minutes" to full cron expressions, and won't double-run the same automation.

## ALERT
- It is unaware if this is legal with your Claude Code subscription. Under the hood you are calling the agent-sdk. anthropic 
has been very hard to understand here if thats legal.

If you get banned, it is not my fault. This is just a repo to help with workflow orcestration across multiple projects, and claude code is a great provider.

## Features

### Sessions and Projects
- Open multiple projects, each with its own sessions, terminals, and state
- Run several Claude threads per project at once — each shows whether it's active, idle, or waiting for input
- Fork a session into two parallel branches with independent worktrees
- Quick chat mode for one-off questions without a project
- Session history persists across restarts
- Pop out chat into its own window

### Agent Integration
- Streaming output with thinking blocks, tool timelines, and cost tracking
- Switch models per session — Opus 4.6, Sonnet 4.6, or Haiku 4.5 --- Added Codex Support
- Approve, deny, or always-allow tool calls inline
- Plan review and structured question flows
- Next-message suggestions shown as ghost text (Tab to accept)
- Key moments rail for jumping to milestones in long conversations
- Hover over sessions to preview model, turn count, and last messages

### Git and Diffs
- Built-in git status, staging, and diff views (staged, unstaged, and untracked)
- File tree browser with filters and status badges
- Branch switching from the chat footer or command palette
- Commit dialog with AI-generated messages, push, or create PR via `gh`
- Configurable startup commands and build steps per project

### Worktrees
- Optionally isolate each thread in its own git worktree
- Include uncommitted changes when creating a worktree
- Sync changes back to your main working tree (apply or overwrite)
- Automatic cleanup on shutdown

### Terminal
- Per-project terminal tabs with split view
- Pop out any terminal tab to an external emulator (kitty, alacritty, wezterm — auto-detected)
- Search terminal output with `Ctrl+F`
- Rename tabs, rearrange, add or remove

### Editor and Browser
- Embedded Neovim per project, with auto-refresh after agent changes
- Open files from the command palette, diffs, or project tree
- Browser panel with tabs, navigation, devtools, and page inspection
- Bridge APIs let agents interact with the browser (navigate, click, type, screenshot)

### MCP Servers
- Built-in bridge server gives agents access to terminals, browser, and inter-session messaging
- Add your own local MCP servers — start, stop, enable per project
- Remote MCP servers (like HubSpot) with per-session tool filtering
- Auto-discovers configs from `~/.mcp.json` and project `.mcp.json` files

### Voice, Screenshots, and Notifications
- Voice input with local Whisper transcription
- Screenshot capture that inserts image references into your prompt
- Desktop notifications when a session needs attention
- Optional sound on completion, prevent-sleep toggle

### Appearance
- 22 themes — dark, light, monokai, solarized, nord, dracula, catppuccin, tokyo-night, gruvbox, rose-pine, kanagawa, synthwave, and more
- Vim keybindings in the chat input (normal/insert/visual modes)
- Resizable panes everywhere
- Command palette with fuzzy search across commands, files, sessions, terminals, projects, branches, and themes

## Installation

### Prerequisites

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- `git` on `PATH`

### Optional

- `nvim` — embedded editor
- `scrot` — screenshot capture
- `gh` — "commit and create PR" workflow

### Pre-built packages

Grab the latest from the [Releases](https://github.com/MMcintire96/ClaudeX/releases) page.

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

ClaudeX uses Electron's three-process model:

```
src/
├── main/              # Main process — lifecycle, native APIs, agent/terminal management
│   ├── agent/         #   AgentManager → AgentProcess → Claude Agent SDK
│   ├── automation/    #   AutomationManager, scheduler, persistence
│   ├── bridge/        #   ClaudexBridgeServer (MCP tool bridge)
│   ├── browser/       #   Embedded browser tabs
│   ├── terminal/      #   PTY terminal management
│   ├── worktree/      #   Git worktree lifecycle
│   ├── project/       #   Project & git operations
│   └── session/       #   State persistence & session history
├── preload/           # Preload bridge — window.api via contextBridge
└── renderer/          # React UI — components, Zustand stores, hooks
    ├── components/
    │   ├── chat/          # Chat view, message rendering, tool blocks
    │   ├── layout/        # App shell, sidebar, panels
    │   ├── terminal/      # xterm.js terminal views
    │   ├── diff/          # Diff panel with diff2html
    │   ├── automation/    # Automaton panel, editor, triage inbox
    │   └── settings/      # Settings panel
    └── stores/            # Zustand state (session, project, terminal, ui, settings, automation)
```

### How agents work

1. `AgentManager` spins up an `AgentProcess` that calls `query()` from the Claude Agent SDK
2. The SDK returns an async stream of typed events
3. Events flow to the renderer over IPC and land in the session store
4. Each agent gets an MCP config pointing to `ClaudexBridgeServer` — a localhost HTTP server exposing terminal, browser, and session tools back to the agent
5. When an agent pauses (waiting for tool approval, a question answer, or plan decision), it resumes via `agent.send()`

### Key technologies

- **Electron 40** — desktop runtime
- **React 19** — UI
- **Zustand** — state management
- **@anthropic-ai/claude-agent-sdk** — agent integration
- **xterm.js** — terminal rendering
- **node-pty** — PTY creation
- **simple-git** — git operations
- **electron-vite** — build tooling

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Mod+K` | Command palette |
| `Mod+?` | Show keyboard shortcuts |
| `Mod+N` | New session |
| `Mod+Shift+N` | New quick chat |
| `Mod+T` | New terminal |
| `Mod+O` | Open project |
| `Mod+B` | Toggle browser panel |
| `Mod+D` | Toggle diff panel |
| `Mod+S` | Toggle sidebar |
| `Mod+L` | Cycle color scheme |
| `Mod+V` | Voice input toggle |
| `Mod+P` | Popout chat |
| `Mod+W` | Close active session |
| `Mod+1-9` | Switch session by index |
| `Ctrl+`` ` | Toggle terminal panel |

## License

MIT
