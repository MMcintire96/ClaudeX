import simpleGit, { SimpleGit, StatusResult, DiffResult } from 'simple-git'
import { readFile, copyFile, unlink, writeFile } from 'fs/promises'
import { join, resolve } from 'path'
import { tmpdir } from 'os'

/**
 * Git operations via simple-git, used from the main process.
 */
export class GitService {
  private git: SimpleGit
  private projectPath: string

  constructor(projectPath: string) {
    this.git = simpleGit(projectPath)
    this.projectPath = projectPath
  }

  async status(): Promise<StatusResult> {
    return this.git.status()
  }

  async diff(staged = false): Promise<string> {
    if (staged) {
      return this.git.diff(['--cached'])
    }
    return this.git.diff()
  }

  async diffSummary(staged = false): Promise<DiffResult> {
    if (staged) {
      return this.git.diffSummary(['--cached'])
    }
    return this.git.diffSummary()
  }

  async log(maxCount = 20): Promise<unknown> {
    return this.git.log({ maxCount })
  }

  async diffFile(filePath: string): Promise<string> {
    return this.git.diff([filePath])
  }

  async branch(): Promise<string | null> {
    try {
      const summary = await this.git.branchLocal()
      return summary.current || null
    } catch {
      return null
    }
  }

  async branchList(): Promise<{ current: string; all: string[] }> {
    const summary = await this.git.branchLocal()
    return { current: summary.current, all: summary.all }
  }

  async checkout(branchName: string): Promise<void> {
    await this.git.checkout(branchName)
  }

  async add(files: string[]): Promise<void> {
    await this.git.add(files)
  }

  async addAll(): Promise<void> {
    await this.git.add(['-A'])
  }

  async commit(message: string): Promise<string> {
    const result = await this.git.commit(message)
    return result.commit
  }

  async push(remote?: string, branch?: string): Promise<void> {
    const args: string[] = []
    if (remote) args.push(remote)
    if (branch) args.push(branch)
    await this.git.push(args)
  }

  async getRemotes(): Promise<Array<{ name: string; refs: { fetch: string; push: string } }>> {
    const remotes = await this.git.getRemotes(true)
    return remotes.map(r => ({ name: r.name, refs: r.refs }))
  }

  /** Generate a unified diff for a single untracked file (shows all lines as added) */
  async diffUntrackedFile(filePath: string): Promise<string> {
    const absPath = resolve(this.projectPath, filePath)
    try {
      const content = await readFile(absPath, 'utf-8')
      const lines = content.split('\n')
      // Remove trailing empty line from final newline
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
      const header = `diff --git a/${filePath} b/${filePath}\nnew file mode 100644\n--- /dev/null\n+++ b/${filePath}\n@@ -0,0 +1,${lines.length} @@\n`
      return header + lines.map(l => `+${l}`).join('\n') + '\n'
    } catch {
      return ''
    }
  }

  /** Generate unified diffs for all untracked files */
  async diffAllUntracked(): Promise<string> {
    const status = await this.status()
    const untrackedFiles = status.not_added
    if (!untrackedFiles || untrackedFiles.length === 0) return ''
    const diffs = await Promise.all(untrackedFiles.map(f => this.diffUntrackedFile(f)))
    return diffs.filter(Boolean).join('\n')
  }

  // --- Checkpoint plumbing ---

  /**
   * Create a snapshot commit of the full working directory state using a temporary
   * index file so the user's real staging area is never touched.
   * Returns the commit SHA and tree SHA.
   */
  async createSnapshot(message: string): Promise<{ commitSha: string; treeSha: string }> {
    const tempIndex = join(tmpdir(), `claudex-index-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    const realIndex = join(this.projectPath, '.git', 'index')

    try {
      // Copy the real index so we have a baseline
      try {
        await copyFile(realIndex, tempIndex)
      } catch {
        // If no index exists (fresh repo), write an empty one
        await writeFile(tempIndex, '')
      }

      const env = { GIT_INDEX_FILE: tempIndex }

      // Stage everything (including untracked) into temp index
      await this.git.env(env).raw(['add', '-A'])

      // Write the temp index as a tree object
      const treeSha = (await this.git.env(env).raw(['write-tree'])).trim()

      // Create a commit object from the tree (no parent needed for snapshot)
      // Provide explicit author/committer identity so this works even without git config
      const commitEnv = {
        GIT_AUTHOR_NAME: 'ClaudeX',
        GIT_AUTHOR_EMAIL: 'checkpoint@claudex.local',
        GIT_COMMITTER_NAME: 'ClaudeX',
        GIT_COMMITTER_EMAIL: 'checkpoint@claudex.local'
      }
      const commitSha = (await this.git.env(commitEnv).raw([
        'commit-tree', treeSha, '-m', message
      ])).trim()

      return { commitSha, treeSha }
    } finally {
      await unlink(tempIndex).catch(() => {})
    }
  }

  /** Get the current HEAD commit SHA, or null if no commits exist */
  async getHeadCommit(): Promise<string | null> {
    try {
      return (await this.git.raw(['rev-parse', 'HEAD'])).trim()
    } catch {
      return null
    }
  }

  /** Store a git ref to prevent garbage collection of a commit */
  async updateRef(refName: string, commitSha: string): Promise<void> {
    await this.git.raw(['update-ref', refName, commitSha])
  }

  /** Delete a git ref */
  async deleteRef(refName: string): Promise<void> {
    await this.git.raw(['update-ref', '-d', refName]).catch(() => {})
  }

  /** List files in a commit's tree */
  async lsTree(commitSha: string): Promise<string[]> {
    const output = await this.git.raw(['ls-tree', '-r', '--name-only', commitSha])
    return output.trim().split('\n').filter(Boolean)
  }

  /**
   * Restore the working directory to match a checkpoint commit's tree.
   * Handles additions, modifications, and deletions.
   */
  async restoreFromCommit(commitSha: string): Promise<void> {
    // Get files in the checkpoint
    const checkpointFiles = new Set(await this.lsTree(commitSha))

    // Get current tracked + untracked files
    const trackedOutput = await this.git.raw(['ls-files', '--cached']).catch(() => '')
    const untrackedOutput = await this.git.raw(['ls-files', '--others', '--exclude-standard']).catch(() => '')
    const currentFiles = new Set([
      ...trackedOutput.trim().split('\n').filter(Boolean),
      ...untrackedOutput.trim().split('\n').filter(Boolean)
    ])

    // Restore all files from the checkpoint
    await this.git.raw(['checkout', commitSha, '--', '.'])

    // Remove files that exist now but didn't at checkpoint time
    const toRemove = [...currentFiles].filter(f => !checkpointFiles.has(f))
    for (const f of toRemove) {
      const absPath = resolve(this.projectPath, f)
      await unlink(absPath).catch(() => {})
    }
    // Clean up index entries for removed files
    if (toRemove.length > 0) {
      await this.git.raw(['rm', '--cached', '--ignore-unmatch', '--force', ...toRemove]).catch(() => {})
    }

    // Unstage everything to restore a clean working directory
    await this.git.raw(['reset']).catch(() => {})
  }
}
