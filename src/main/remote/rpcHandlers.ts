/**
 * RPC dispatcher for the mobile PWA. Curates a subset of the desktop IPC
 * surface and exposes it over `POST /api/rpc` via RemoteServer.
 *
 * Each entry is `domain.method` → handler(managers, args) → result.
 *
 * Design notes:
 *   - Allowlist by construction. Anything not listed here is not callable.
 *   - Read-only by default. Mutations are explicit.
 *   - No Electron-specific things (dialogs, native menus, native file picker).
 *   - No PTY (terminal/neovim) or CC sessions per scope.
 *   - Handlers may be sync or async; results are JSON-serialised.
 */

import type { ProjectManager } from '../project/ProjectManager'
import type { ProjectConfigManager } from '../project/ProjectConfigManager'
import type { SettingsManager } from '../settings/SettingsManager'
import type { McpManager } from '../mcp/McpManager'
import type { CheckpointManager } from '../checkpoint/CheckpointManager'
import type { WorktreeManager } from '../worktree/WorktreeManager'
import type { TerminalManager } from '../terminal/TerminalManager'
import type { SessionPersistence } from '../session/SessionPersistence'
import { GitService } from '../project/GitService'

export interface RpcManagers {
  projectManager: ProjectManager
  projectConfigManager: ProjectConfigManager
  settingsManager: SettingsManager
  mcpManager: McpManager
  checkpointManager: CheckpointManager
  worktreeManager: WorktreeManager
  terminalManager: TerminalManager
  sessionPersistence: SessionPersistence
}

export type RpcHandler = (m: RpcManagers, args: unknown[]) => unknown | Promise<unknown>

/* eslint-disable @typescript-eslint/no-explicit-any */

function arg<T>(args: unknown[], i: number, fallback?: T): T {
  return (args[i] === undefined ? fallback : args[i]) as T
}

export const rpcHandlers: Record<string, Record<string, RpcHandler>> = {
  // --------------------------------------------------------------------------
  // Project + git (read-only and curated mutations)
  // --------------------------------------------------------------------------
  project: {
    recent: (m) => m.projectManager.getRecent(),

    listFiles: async (_m, args) => {
      const projectPath = arg<string>(args, 0)
      const { readdir, stat } = await import('fs/promises')
      const { join } = await import('path')
      const out: string[] = []
      const skip = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.next'])
      async function walk(dir: string, prefix: string): Promise<void> {
        const entries = await readdir(dir, { withFileTypes: true })
        for (const e of entries) {
          if (skip.has(e.name)) continue
          if (e.name.startsWith('.')) continue
          const rel = prefix ? `${prefix}/${e.name}` : e.name
          if (e.isDirectory()) {
            await walk(join(dir, e.name), rel)
          } else {
            out.push(rel)
            if (out.length > 5000) return
          }
        }
      }
      try {
        await walk(projectPath, '')
        const s = await stat(projectPath)
        return { ok: !!s, files: out }
      } catch (err) {
        return { ok: false, files: [], error: (err as Error).message }
      }
    },

    readFile: async (_m, args) => {
      const projectPath = arg<string>(args, 0)
      const filePath = arg<string>(args, 1)
      const maxBytes = arg<number | undefined>(args, 2, 256 * 1024)
      const { readFile, stat } = await import('fs/promises')
      const { join, resolve } = await import('path')
      try {
        const abs = resolve(join(projectPath, filePath))
        if (!abs.startsWith(resolve(projectPath))) {
          return { ok: false, error: 'path outside project' }
        }
        const s = await stat(abs)
        const truncated = s.size > (maxBytes as number)
        const buf = await readFile(abs)
        const text = buf.slice(0, maxBytes as number).toString('utf-8')
        return { ok: true, content: text, truncated, bytes: s.size }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    gitStatus: async (_m, args) => {
      const projectPath = arg<string>(args, 0)
      try {
        const git = new GitService(projectPath)
        const status = await git.status()
        return {
          ok: true,
          status: {
            files: status.files.map((f: any) => ({ path: f.path, index: f.index, working_dir: f.working_dir })),
            staged: status.staged,
            modified: status.modified,
            not_added: status.not_added,
            deleted: status.deleted,
            renamed: status.renamed.map((r: any) => ({ from: r.from, to: r.to })),
            conflicted: status.conflicted,
            isClean: status.isClean()
          }
        }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    gitBranch: async (_m, args) => {
      try {
        const git = new GitService(arg<string>(args, 0))
        return { ok: true, branch: await git.branch() }
      } catch (err) {
        return { ok: false, branch: null, error: (err as Error).message }
      }
    },

    gitBranches: async (_m, args) => {
      try {
        const git = new GitService(arg<string>(args, 0))
        const result = await git.branchList()
        return { ok: true, current: result.current, branches: result.all }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    gitDiffSummary: async (_m, args) => {
      try {
        const git = new GitService(arg<string>(args, 0))
        const summary = await git.diffSummary(arg<boolean>(args, 1, false))
        return {
          ok: true,
          summary: {
            changed: summary.changed,
            insertions: summary.insertions,
            deletions: summary.deletions,
            files: summary.files.map((f: any) => ({
              file: f.file,
              changes: f.changes ?? 0,
              insertions: f.insertions ?? 0,
              deletions: f.deletions ?? 0
            }))
          }
        }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    diff: async (_m, args) => {
      try {
        const git = new GitService(arg<string>(args, 0))
        const staged = arg<boolean>(args, 1, false)
        const diff = await git.diff(staged)
        if (!staged) {
          const untracked = await git.diffAllUntracked()
          return { ok: true, diff: [diff, untracked].filter(Boolean).join('\n') }
        }
        return { ok: true, diff }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    diffFile: async (_m, args) => {
      try {
        const git = new GitService(arg<string>(args, 0))
        const filePath = arg<string>(args, 1)
        const untracked = arg<boolean>(args, 2, false)
        const fullFile = arg<boolean>(args, 3, false)
        const diff = untracked ? await git.diffUntrackedFile(filePath) : await git.diffFile(filePath, fullFile)
        return { ok: true, diff }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    gitLog: async (_m, args) => {
      try {
        const git = new GitService(arg<string>(args, 0))
        const log: any = await git.log(arg<number>(args, 1, 20))
        return { ok: true, log }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    gitRemotes: async (_m, args) => {
      try {
        const git = new GitService(arg<string>(args, 0))
        const remotes = await git.getRemotes()
        return { ok: true, remotes }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    // --- mutations (curated) ---

    gitAdd: async (_m, args) => {
      try {
        const git = new GitService(arg<string>(args, 0))
        const files = arg<string[] | undefined>(args, 1)
        if (files && files.length > 0) {
          await git.add(files)
        } else {
          await git.addAll()
        }
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    gitCommit: async (_m, args) => {
      try {
        const git = new GitService(arg<string>(args, 0))
        const sha = await git.commit(arg<string>(args, 1))
        return { ok: true, commit: sha }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    gitPush: async (_m, args) => {
      try {
        const git = new GitService(arg<string>(args, 0))
        await git.push()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    gitPull: async (_m, args) => {
      try {
        const git = new GitService(arg<string>(args, 0))
        await git.pull()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    getStartConfig: (m, args) => {
      try {
        return { ok: true, config: m.projectConfigManager.getConfig(arg<string>(args, 0)) }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    },

    runStart: (m, args) => {
      try {
        const projectPath = arg<string>(args, 0)
        const config = m.projectConfigManager.getConfig(projectPath)
        if (!config?.actions?.length) return { ok: false, error: 'no start actions configured' }
        const ids: string[] = []
        for (const action of config.actions) {
          if (action.autoRun === false) continue
          const t = m.terminalManager.create(projectPath)
          m.terminalManager.write(t.id, action.command + '\n')
          ids.push(t.id)
        }
        return { ok: true, terminalIds: ids }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  },

  // --------------------------------------------------------------------------
  // App state (theme, sidebar width, active project) — lives in session-state.json
  // --------------------------------------------------------------------------
  appState: {
    get: (m) => {
      const state = m.sessionPersistence.loadState()
      return { ok: true, theme: state.theme, activeProjectPath: state.activeProjectPath }
    }
  },

  // --------------------------------------------------------------------------
  // Settings (limited mutations)
  // --------------------------------------------------------------------------
  settings: {
    get: (m) => ({ ok: true, settings: m.settingsManager.get() }),
    update: async (m, args) => {
      try {
        const partial = arg<Record<string, unknown>>(args, 0, {})
        // Whitelist of phone-mutable settings — avoid letting the phone change
        // anything that affects the desktop renderer's identity, agent paths,
        // or sensitive credentials.
        const allowedTop = new Set([
          'notificationSounds', 'preventSleep', 'suggestNextMessage',
          'defaultModel', 'defaultEffort'
        ])
        const filtered: Record<string, unknown> = {}
        for (const [k, v] of Object.entries(partial)) {
          if (allowedTop.has(k)) filtered[k] = v
        }
        // Nested `claude.*` — only the YOLO toggle is mobile-mutable.
        if (partial.claude && typeof partial.claude === 'object') {
          const claudePartial = partial.claude as Record<string, unknown>
          const allowedClaude = new Set(['dangerouslySkipPermissions'])
          const filteredClaude: Record<string, unknown> = {}
          for (const [k, v] of Object.entries(claudePartial)) {
            if (allowedClaude.has(k)) filteredClaude[k] = v
          }
          if (Object.keys(filteredClaude).length > 0) {
            // Merge into existing claude object so we don't drop other fields.
            const current = m.settingsManager.get().claude as Record<string, unknown>
            filtered.claude = { ...current, ...filteredClaude }
          }
        }
        const next = await m.settingsManager.update(filtered as any)
        return { ok: true, settings: next }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  },

  // --------------------------------------------------------------------------
  // Worktree (read-only)
  // --------------------------------------------------------------------------
  worktree: {
    list: (m, args) => ({ ok: true, worktrees: m.worktreeManager.list(arg<string>(args, 0)) }),
    get: (m, args) => ({ ok: true, worktree: m.worktreeManager.get(arg<string>(args, 0)) }),
    diff: async (m, args) => {
      try {
        const id = arg<string>(args, 0)
        const diff = await m.worktreeManager.getDiff(id)
        return { ok: true, diff }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  },

  // --------------------------------------------------------------------------
  // Checkpoint (read-only)
  // --------------------------------------------------------------------------
  checkpoint: {
    list: async (m, args) => {
      try {
        const list = await m.checkpointManager.getCheckpoints(arg<string>(args, 0))
        return { ok: true, checkpoints: list }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  },

  // --------------------------------------------------------------------------
  // MCP (read-only)
  // --------------------------------------------------------------------------
  mcp: {
    list: (m) => ({ ok: true, servers: m.mcpManager.getServers() })
  }
}

export interface RpcRequest {
  domain: string
  method: string
  args?: unknown[]
}

export interface RpcResponse {
  ok: boolean
  result?: unknown
  error?: string
}

export async function dispatchRpc(
  managers: RpcManagers,
  req: RpcRequest
): Promise<RpcResponse> {
  if (!req.domain || !req.method) {
    return { ok: false, error: 'domain and method required' }
  }
  const domain = rpcHandlers[req.domain]
  if (!domain) return { ok: false, error: `unknown domain: ${req.domain}` }
  const handler = domain[req.method]
  if (!handler) return { ok: false, error: `unknown method: ${req.domain}.${req.method}` }
  try {
    const result = await handler(managers, req.args ?? [])
    return { ok: true, result }
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
}
