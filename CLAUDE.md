# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ClaudeX is a desktop IDE for managing Claude Code agent sessions across multiple projects. Built with Electron + React + TypeScript using electron-vite for tooling.

## Commands

```bash
npm run dev        # Start dev server with hot reload
npm run build      # Build main, preload, renderer bundles
npm run preview    # Preview production build
npm run package    # Build + electron-builder packaging
```

No test or lint commands are currently configured.

## Architecture

**Electron three-process model:**
- `src/main/` — Main process: app lifecycle, native APIs, agent/terminal/browser management
- `src/preload/` — Preload bridge: exposes `window.api` via `contextBridge` (contextIsolation enabled)
- `src/renderer/` — React UI: components, Zustand stores, hooks

### Agent System (main process)

`AgentManager` → `AgentProcess` → calls `query()` from `@anthropic-ai/claude-agent-sdk` → async iterator yields typed SDK messages → mapped to `AgentEvent` types → sent to renderer via IPC `agent:event` → `sessionStore.processEvent()` updates UI state.

Each agent session gets an MCP config pointing to `ClaudexBridgeServer`, a localhost HTTP server (token-secured) that exposes terminal, browser, and session tools to the Claude agent.

### IPC Pattern

All main↔renderer communication uses Electron IPC through the preload bridge. Handlers are organized by domain in `src/main/ipc/` (agent, project, terminal, browser, settings, voice, sessionFile). The preload script (`src/preload/index.ts`) defines the full API surface and its TypeScript types (`index.d.ts`).

### State Management (renderer)

Zustand stores in `src/renderer/src/stores/`:
- **sessionStore** — Per-session message history, streaming state, event processing
- **projectStore** — Active project, recent projects, git branches
- **terminalStore** — Terminal tabs, Claude status per terminal, sub-agents, context usage
- **uiStore** — Layout dimensions, theme, panel visibility, per-project panel memory
- **settingsStore** — User preferences (API key, model, notifications)

### Key Hooks

- `useAgent(sessionId)` — Agent lifecycle: start/send/stop, exposes processing/streaming status
- `useStreamingMessage(sessionId)` — Assembles streamed message chunks
- `useVimMode()` — Vim keybindings for input

### Terminal System

`TerminalManager` (main) creates per-project PTY instances via node-pty. Detects Claude attention states from output patterns. `TerminalView` (renderer) renders with xterm.js.

### Session Persistence

`SessionPersistence` saves/loads app state to `~/.config/claudex/session-state.json`. `SessionFileWatcher` watches Claude CLI's JSON session files and streams parsed entries to the renderer.

### Theming

Twenty-two built-in themes via CSS variables in `styles/themes.css`, applied via `data-theme` attribute. Theme colors synchronize with xterm.js terminal colors.

## Key Entry Points

- `src/main/index.ts` — Electron bootstrap
- `src/preload/index.ts` — API surface definition
- `src/renderer/src/App.tsx` — React root, sets up IPC event listeners
- `src/main/agent/AgentManager.ts` — Core agent orchestration
- `src/renderer/src/stores/sessionStore.ts` — Message/event processing
