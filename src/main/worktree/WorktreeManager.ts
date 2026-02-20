import { app, shell } from 'electron'
import { join } from 'path'
import { createHash } from 'crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import simpleGit, { SimpleGit } from 'simple-git'

/** Write patch to a temp file, apply it with git apply, then clean up */
async function applyPatch(git: SimpleGit, patch: string, threeWay = false): Promise<void> {
  const tmpPath = join(tmpdir(), `claudex-patch-${Date.now()}-${Math.random().toString(36).slice(2)}.patch`)
  try {
    writeFileSync(tmpPath, patch, 'utf-8')
    const args = ['apply']
    if (threeWay) args.push('--3way')
    args.push(tmpPath)
    await git.raw(args)
  } finally {
    try { unlinkSync(tmpPath) } catch { /* ignore */ }
  }
}

export interface WorktreeInfo {
  sessionId: string
  projectPath: string
  worktreePath: string
  baseBranch: string | null
  baseCommit: string
  createdAt: number
  branchName: string | null
}

interface WorktreeRegistry {
  worktrees: WorktreeInfo[]
}

export class WorktreeManager {
  private configDir: string
  private worktreeBaseDir: string
  private registryPath: string
  private registry: WorktreeRegistry = { worktrees: [] }

  constructor() {
    this.configDir = join(app.getPath('userData'))
    this.worktreeBaseDir = join(this.configDir, 'worktrees')
    this.registryPath = join(this.configDir, 'worktree-registry.json')
    mkdirSync(this.worktreeBaseDir, { recursive: true })
    this.loadRegistry()
  }

  private loadRegistry(): void {
    try {
      if (existsSync(this.registryPath)) {
        const raw = readFileSync(this.registryPath, 'utf-8')
        const parsed = JSON.parse(raw) as WorktreeRegistry
        // Validate: remove entries whose worktree directories no longer exist
        parsed.worktrees = parsed.worktrees.filter(w => existsSync(w.worktreePath))
        this.registry = parsed
        this.saveRegistry()
      }
    } catch (err) {
      console.warn('[WorktreeManager] Failed to load registry:', err)
      this.registry = { worktrees: [] }
    }
  }

  private saveRegistry(): void {
    try {
      writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2), 'utf-8')
    } catch (err) {
      console.error('[WorktreeManager] Failed to save registry:', err)
    }
  }

  private projectHash(projectPath: string): string {
    return createHash('sha256').update(projectPath).digest('hex').slice(0, 12)
  }

  async create(opts: {
    projectPath: string
    sessionId: string
    baseBranch?: string
    includeChanges?: boolean
  }): Promise<WorktreeInfo> {
    const { projectPath, sessionId, baseBranch, includeChanges } = opts
    const hash = this.projectHash(projectPath)
    const worktreePath = join(this.worktreeBaseDir, hash, sessionId)
    mkdirSync(join(this.worktreeBaseDir, hash), { recursive: true })

    const git = simpleGit(projectPath)

    // Determine the base commit
    let baseCommit: string
    if (baseBranch) {
      baseCommit = (await git.revparse([baseBranch])).trim()
    } else {
      baseCommit = (await git.revparse(['HEAD'])).trim()
    }

    // Create worktree in detached HEAD state
    await git.raw(['worktree', 'add', '--detach', worktreePath, baseCommit])

    // If includeChanges, capture uncommitted work and apply to worktree
    if (includeChanges) {
      try {
        // Create a stash-like commit without modifying the real stash list
        const stashCommit = (await git.raw(['stash', 'create'])).trim()
        if (stashCommit) {
          const wtGit = simpleGit(worktreePath)
          // Apply the stash diff to the worktree
          const patch = await git.raw(['diff', baseCommit, stashCommit])
          if (patch.trim()) {
            try {
              await applyPatch(wtGit, patch, true)
            } catch {
              try {
                await applyPatch(wtGit, patch, false)
              } catch (applyErr) {
                console.warn('[WorktreeManager] Could not apply uncommitted changes:', applyErr)
              }
            }
          }
        }
      } catch (err) {
        console.warn('[WorktreeManager] Failed to capture uncommitted changes:', err)
      }
    }

    // Resolve the current branch name for metadata
    let resolvedBranch: string | null = null
    if (baseBranch) {
      resolvedBranch = baseBranch
    } else {
      try {
        const branch = (await git.raw(['rev-parse', '--abbrev-ref', 'HEAD'])).trim()
        if (branch !== 'HEAD') resolvedBranch = branch
      } catch { /* detached HEAD */ }
    }

    const info: WorktreeInfo = {
      sessionId,
      projectPath,
      worktreePath,
      baseBranch: resolvedBranch,
      baseCommit,
      createdAt: Date.now(),
      branchName: null
    }

    this.registry.worktrees.push(info)
    this.saveRegistry()
    return info
  }

  async remove(sessionId: string): Promise<void> {
    const info = this.get(sessionId)
    if (!info) return

    try {
      const git = simpleGit(info.projectPath)
      await git.raw(['worktree', 'remove', '--force', info.worktreePath])
    } catch {
      // Fallback: manually remove the directory
      try {
        if (existsSync(info.worktreePath)) {
          rmSync(info.worktreePath, { recursive: true, force: true })
        }
      } catch (err) {
        console.error('[WorktreeManager] Failed to remove worktree directory:', err)
      }
    }

    this.registry.worktrees = this.registry.worktrees.filter(w => w.sessionId !== sessionId)
    this.saveRegistry()
  }

  list(projectPath: string): WorktreeInfo[] {
    return this.registry.worktrees.filter(w => w.projectPath === projectPath)
  }

  get(sessionId: string): WorktreeInfo | null {
    return this.registry.worktrees.find(w => w.sessionId === sessionId) ?? null
  }

  async createBranch(sessionId: string, branchName: string): Promise<void> {
    const info = this.get(sessionId)
    if (!info) throw new Error(`Worktree not found: ${sessionId}`)

    const wtGit = simpleGit(info.worktreePath)
    await wtGit.raw(['checkout', '-b', branchName])

    // Update registry
    info.branchName = branchName
    this.saveRegistry()
  }

  async getDiff(sessionId: string): Promise<string> {
    const info = this.get(sessionId)
    if (!info) throw new Error(`Worktree not found: ${sessionId}`)

    const wtGit = simpleGit(info.worktreePath)
    // Show all changes: committed since base + uncommitted
    const committedDiff = await wtGit.raw(['diff', info.baseCommit, 'HEAD'])
    const uncommittedDiff = await wtGit.diff()
    return committedDiff + (uncommittedDiff ? '\n' + uncommittedDiff : '')
  }

  async syncToLocal(sessionId: string, mode: 'overwrite' | 'apply'): Promise<void> {
    const info = this.get(sessionId)
    if (!info) throw new Error(`Worktree not found: ${sessionId}`)

    const mainGit = simpleGit(info.projectPath)
    const wtGit = simpleGit(info.worktreePath)

    if (mode === 'overwrite') {
      const wtHead = (await wtGit.revparse(['HEAD'])).trim()
      await mainGit.raw(['reset', '--hard', wtHead])
      // Also apply any uncommitted changes
      const uncommitted = await wtGit.diff()
      if (uncommitted.trim()) {
        await applyPatch(mainGit, uncommitted)
      }
    } else {
      // Apply mode: generate patch from shared base and apply
      const wtHead = (await wtGit.revparse(['HEAD'])).trim()
      const mainHead = (await mainGit.revparse(['HEAD'])).trim()
      let mergeBase: string
      try {
        mergeBase = (await mainGit.raw(['merge-base', mainHead, wtHead])).trim()
      } catch {
        mergeBase = info.baseCommit
      }
      const patch = await wtGit.raw(['diff', mergeBase, 'HEAD'])
      if (patch.trim()) {
        await applyPatch(mainGit, patch, true)
      }
      // Also apply uncommitted changes
      const uncommitted = await wtGit.diff()
      if (uncommitted.trim()) {
        await applyPatch(mainGit, uncommitted, true)
      }
    }
  }

  async syncFromLocal(sessionId: string, mode: 'overwrite' | 'apply'): Promise<void> {
    const info = this.get(sessionId)
    if (!info) throw new Error(`Worktree not found: ${sessionId}`)

    const mainGit = simpleGit(info.projectPath)
    const wtGit = simpleGit(info.worktreePath)

    if (mode === 'overwrite') {
      const mainHead = (await mainGit.revparse(['HEAD'])).trim()
      await wtGit.raw(['reset', '--hard', mainHead])
      const uncommitted = await mainGit.diff()
      if (uncommitted.trim()) {
        await applyPatch(wtGit, uncommitted)
      }
    } else {
      const mainHead = (await mainGit.revparse(['HEAD'])).trim()
      const wtHead = (await wtGit.revparse(['HEAD'])).trim()
      let mergeBase: string
      try {
        mergeBase = (await mainGit.raw(['merge-base', mainHead, wtHead])).trim()
      } catch {
        mergeBase = info.baseCommit
      }
      const patch = await mainGit.raw(['diff', mergeBase, mainHead])
      if (patch.trim()) {
        await applyPatch(wtGit, patch, true)
      }
      const uncommitted = await mainGit.diff()
      if (uncommitted.trim()) {
        await applyPatch(wtGit, uncommitted, true)
      }
    }
  }

  openInEditor(sessionId: string): void {
    const info = this.get(sessionId)
    if (!info) throw new Error(`Worktree not found: ${sessionId}`)
    shell.openPath(info.worktreePath)
  }

  /**
   * Look up worktree info by worktree path (as opposed to sessionId).
   * Used to find worktree metadata for a terminal running in a worktree directory.
   */
  getByWorktreePath(worktreePath: string): WorktreeInfo | null {
    return this.registry.worktrees.find(w => w.worktreePath === worktreePath) ?? null
  }

  async cleanupAll(): Promise<void> {
    // Prune git worktree references
    const projectPaths = new Set(this.registry.worktrees.map(w => w.projectPath))
    for (const pp of projectPaths) {
      try {
        const git = simpleGit(pp)
        await git.raw(['worktree', 'prune'])
      } catch (err) {
        console.warn(`[WorktreeManager] Failed to prune worktrees for ${pp}:`, err)
      }
    }

    // Remove orphaned worktree directories not in the registry
    try {
      const { readdirSync } = await import('fs')
      const projectHashDirs = readdirSync(this.worktreeBaseDir)
      for (const hashDir of projectHashDirs) {
        const hashPath = join(this.worktreeBaseDir, hashDir)
        try {
          const wtDirs = readdirSync(hashPath)
          for (const wtDir of wtDirs) {
            const wtPath = join(hashPath, wtDir)
            const inRegistry = this.registry.worktrees.some(w => w.worktreePath === wtPath)
            if (!inRegistry) {
              console.log(`[WorktreeManager] Removing orphaned worktree directory: ${wtPath}`)
              rmSync(wtPath, { recursive: true, force: true })
            }
          }
          // Remove empty hash directories
          const remaining = readdirSync(hashPath)
          if (remaining.length === 0) {
            rmSync(hashPath, { recursive: true, force: true })
          }
        } catch { /* ignore per-dir errors */ }
      }
    } catch (err) {
      console.warn('[WorktreeManager] Failed to cleanup orphaned directories:', err)
    }
  }
}
