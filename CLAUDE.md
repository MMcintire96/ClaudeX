# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ClaudeX is a desktop IDE for managing Claude Code agent sessions across multiple projects. It is built with **Electron + React 19 + TypeScript**, bundled with **electron-vite**, and uses **Zustand** for renderer state. The app embeds the `@anthropic-ai/claude-agent-sdk` for SDK-driven agent sessions and shells out to the `claude` CLI for "CC" terminal sessions. It also supports OpenAI Codex models via `@openai/codex-sdk`.

Author: Michael. Single-developer project. Linux-first (Arch). Notification + sound integration uses `notify-send` + `pw-play`/`paplay` (PipeWire/PulseAudio).

## Commands

```bash
npm run dev            # electron-vite dev server with HMR (renderer + main)
npm run build          # Build main, preload, renderer bundles to ./out
npm run preview        # Preview the built app
npm run package        # Build + electron-builder (publish never)
npm test               # Run vitest once
npm run test:watch     # Vitest watch mode
npm run test:coverage  # Vitest with v8 coverage
```

There is **no lint command**. Type errors surface via `electron-vite build`. Tests cover only `lib/`, `constants/`, `stores/`, `hooks/` in the renderer (see `vitest.config.ts`).

In dev mode the app sets `app.setName('claudex-dev')` and uses a separate `userData` directory (`<appData>/claudex-dev/`) so dev runs don't clobber installed-app state.

## High-Level Architecture

### Electron three-process model

- **`src/main/`** — Main process. Owns app lifecycle, native APIs, agent/terminal/MCP/git/checkpoint/worktree managers, and the localhost bridge HTTP server.
- **`src/preload/`** — Preload bridge. Exposes `window.api` via `contextBridge` (contextIsolation enabled, sandbox disabled, nodeIntegration disabled). `index.d.ts` defines the full IPC API surface.
- **`src/renderer/`** — React 19 UI. Components, Zustand stores, hooks, themes. Also hosts a `PopoutApp.tsx` entry for the popout chat window.

The main entry (`src/main/index.ts`) instantiates **all managers** as singletons, registers IPC handlers via `registerAllHandlers`, starts the bridge server, loads MCP configs, and creates the main `BrowserWindow`. A second `popoutWindow` may be created for a detached chat view (uses query params `?popout=true&terminalId=...&projectPath=...`).

### Agent System (main process)

`src/main/agent/`:
- `AgentManager.ts` — Orchestrator. Holds a `Map<sessionId, AgentProcess | CodexProcess>`. Wires SDK events → IPC events. Buffers `content_block_delta` text deltas and flushes via `setImmediate` (max buffer 500 events) into a single `agent:events` IPC message to keep the renderer fast. Handles session pairing (split-view collaborative review), title generation (after first turn), suggestion generation, file-change tracking for checkpoints, and Linux desktop notifications.
- `AgentProcess.ts` — Wraps `query()` from `@anthropic-ai/claude-agent-sdk`. Manages an `AbortController`, retry count (max 2), and resume state.
- `CodexProcess.ts` — Wraps `@openai/codex-sdk` for Codex/GPT models. `AgentManager.isCodexModel()` routes any model starting with `codex-` or `gpt-` here.
- `SkillLoader.ts` — Loads user-defined skills from `~/.claude/skills/<name>/SKILL.md` (YAML frontmatter `name`/`description` + body) and appends them to the system prompt.
- `TitleGenerator.ts` / `SuggestionGenerator.ts` — Use the SDK to derive a session title from the first prompt and a next-message suggestion after a turn finishes.
- `types.ts` — `AgentEvent` union and SDK message types.

**Event flow:** `query()` async iterator → typed SDK message → mapped to `AgentEvent` → emitted on `AgentProcess` → `AgentManager.wireEvents()` → IPC `agent:event` / `agent:events` / `agent:closed` / `agent:error` / `agent:title` / `agent:suggestion` / `agent:forwarded-review` → `App.tsx` listeners → `sessionStore.processEvent()`.

### MCP & Bridge

- `src/main/bridge/ClaudexBridgeServer.ts` — Localhost HTTP server (random port, 32-byte hex token). Exposes terminal operations and inter-session messaging to the MCP server child process (which can't use Electron IPC). Holds a `sessionRegistry` for `session_list` and `messageInboxes` for `session_send` / `session_receive`.
- `resources/claudex-mcp-server.js` — Standalone Node script run as the `claudex-bridge` MCP server. Reads `CLAUDEX_BRIDGE_PORT` / `CLAUDEX_BRIDGE_TOKEN` / `CLAUDEX_PROJECT_PATH` from env to talk to the bridge. **Browser tools were removed** in commit `1f5fe06`.
- `src/main/mcp/McpManager.ts` — Manages user-configured, external (`~/.mcp.json` and project `.mcp.json`), built-in (`claudex-bridge`), and Claude-reported MCP servers. Tracks per-server enable/disable, autostart, and disallowed remote tools (passed to the SDK as `disallowedTools`).
- Each agent gets `mcpServers` built by `AgentManager.buildMcpServers(projectPath)`, which always includes `claudex-bridge` (if enabled) plus enabled user/external servers.

### IPC Pattern

All main↔renderer communication goes through Electron IPC via the preload bridge. Handlers live in `src/main/ipc/`, organized by domain and registered through `registerAllHandlers`:

- `agentHandlers` — start/send/stop/resume/fork agents, set model/effort
- `projectHandlers` — open project, recent list, git status/diff/branch/commit/push/pull/log/remotes, file listing/reading, start config (per-project boot commands)
- `terminalHandlers` — PTY create/write/resize/close/list/rename, plus CC terminal creation
- `ccHandlers` — Claude CLI session JSONL watcher (`watchSession`, `stopWatch`, `handoffToChat`)
- `settingsHandlers`, `voiceHandlers`, `worktreeHandlers`, `screenshotHandlers`
- `neovimHandlers` — Embedded Neovim PTY per project
- `mcpHandlers` — list/add/update/remove/start/stop/setEnabled MCP servers, refresh
- `checkpointHandlers` — list/create/revert/cleanup turn-level checkpoints

The preload script (`src/preload/index.ts`) and its types in `index.d.ts` define the full `window.api` surface — **edit both whenever IPC changes**.

### Renderer State (Zustand)

`src/renderer/src/stores/`:
- **sessionStore** — Per-session message history, streaming state, `processEvent()` event reducer, `sessionNeedsInput()` helper for AskUserQuestion / ExitPlanMode pending tool calls.
- **projectStore** — Active project, recent projects, git branches.
- **terminalStore** — Terminal tabs, Claude attention status per terminal, sub-agent tracking, context usage.
- **uiStore** — Layout dimensions, theme, panel visibility, per-project panel memory.
- **settingsStore** — User preferences (model, dangerouslySkipPermissions, modKey, vimMode, suggestNextMessage).
- **editorStore** — Neovim editor open state.
- **mcpStore** — MCP server statuses and configs.

### Hooks

`src/renderer/src/hooks/`:
- `useAgent(sessionId)` — Lifecycle: start/send/stop, exposes processing/streaming state.
- `useStreamingMessage(sessionId)` — Assembles streamed text deltas into a coherent message.
- `useCCBridge()` — Wires up Claude CLI session events for CC terminals.
- `useSessionPreview(sessionId)` — Sidebar preview card data.
- `useVimMode()` — Vim keybindings for the input area.

### Terminal System

- `src/main/terminal/TerminalManager.ts` — Per-project PTY instances via `node-pty`. Detects Claude CLI attention states from output patterns. Supports popout: each terminal can expose a Unix socket (`popout-connect.js`) that an external terminal emulator can attach to.
- `src/renderer/src/components/terminal/TerminalView.tsx` — Renders with **`ghostty-web`** (replaced xterm in commit `4f17d64`).
- CC terminals: `createCC` spawns the actual `claude` CLI in a PTY; `CCSessionWatcher` tails the SDK's JSONL session file under `~/.claude/projects/<pathHash>/<sessionId>.jsonl` to mirror messages into the chat UI.

### Worktrees

`src/main/worktree/WorktreeManager.ts` — Creates git worktrees under `<userData>/worktrees/` keyed by session ID. Used by chat sessions (`useWorktree: true` start option). Supports `syncToLocal` / `syncFromLocal` (overwrite or 3-way patch apply). Registry persisted to `<userData>/worktree-registry.json`.

### Checkpoints

`src/main/checkpoint/CheckpointManager.ts` — Per-turn snapshots stored as hidden git refs at `refs/claudex/checkpoints/<sessionId>/<turnNumber>`. Registry at `~/.config/claudex/checkpoint-registry.json`. Tracks `sdkJsonlLineCount` so revert can also truncate the SDK's JSONL session log to keep the SDK's view consistent with the restored tree.

### Session Persistence

- `src/main/session/SessionPersistence.ts` — Saves/loads UI snapshot to `~/.config/claudex/session-state.json`. The renderer sends a snapshot via `app:ui-snapshot` on `app:before-close`; main saves and then destroys the window. There is a 300ms timeout fallback.
- `CCSessionWatcher` watches Claude CLI's JSONL session files and streams parsed entries to the renderer (deduplicates by message UUID).

### Theming

Twenty-two built-in themes via CSS variables in `src/renderer/src/styles/themes.css`, applied via the `data-theme` attribute on the document root. Theme colors synchronize with `ghostty-web` terminal colors via `lib/xtermThemes.ts`.

### Voice

`src/main/voice/VoiceManager.ts` + `@huggingface/transformers` Whisper model — local PCM → text transcription via the `voice:transcribe` IPC. Linux media permissions auto-granted via Chromium command-line switches in `src/main/index.ts`.

## Key Entry Points

- [src/main/index.ts](src/main/index.ts) — Electron bootstrap: instantiates all managers, registers IPC, creates main + popout windows.
- [src/preload/index.ts](src/preload/index.ts) — `window.api` definition. Mirror types in [src/preload/index.d.ts](src/preload/index.d.ts).
- [src/renderer/src/App.tsx](src/renderer/src/App.tsx) — React root. Sets up agent + CC + popout IPC listeners, command palette, hotkeys.
- [src/main/agent/AgentManager.ts](src/main/agent/AgentManager.ts) — Core agent orchestration.
- [src/main/agent/AgentProcess.ts](src/main/agent/AgentProcess.ts) — SDK `query()` wrapper.
- [src/main/bridge/ClaudexBridgeServer.ts](src/main/bridge/ClaudexBridgeServer.ts) — Localhost HTTP bridge.
- [resources/claudex-mcp-server.js](resources/claudex-mcp-server.js) — Built-in MCP server script.
- [src/renderer/src/stores/sessionStore.ts](src/renderer/src/stores/sessionStore.ts) — Message/event reducer.

## File-System Layout (data the app writes)

- `~/.config/claudex/session-state.json` — UI snapshot (theme, sidebar width, active project, expanded projects, sessions).
- `~/.config/claudex/checkpoint-registry.json` — Checkpoint registry.
- `<userData>/worktrees/` — Git worktree clones for sessions.
- `<userData>/worktree-registry.json` — Worktree registry.
- `~/.claude/projects/<pathHash>/<sessionId>.jsonl` — SDK + CLI session logs (read by `CCSessionWatcher`, written by checkpoint cleanup).
- `~/.claude/skills/<name>/SKILL.md` — User-defined skills loaded into the system prompt.
- `~/.mcp.json` and `<project>/.mcp.json` — External MCP server configs (loaded by `McpManager`).

In dev mode (`!app.isPackaged`), `userData` is `<appData>/claudex-dev/`.

## Editing Conventions

- **Always update both `src/preload/index.ts` and `src/preload/index.d.ts`** when adding or changing an IPC channel — they're the contract between main and renderer.
- New main-process managers should be instantiated in `src/main/index.ts` and threaded through `registerAllHandlers` — don't reach into singletons from random handlers.
- New IPC handlers go into a domain file under `src/main/ipc/` and are registered in `src/main/ipc/index.ts`.
- New renderer state goes into a Zustand store, not React context.
- Themes are CSS-variable based — add new themes to both `styles/themes.css` and `lib/xtermThemes.ts` so the terminal stays in sync.
- Tests live under `__tests__/` next to the code they cover. Coverage scope is intentionally limited to pure modules (`lib`, `constants`, `stores`, `hooks`).
