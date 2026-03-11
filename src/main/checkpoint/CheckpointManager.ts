import { homedir } from 'os'
import { join } from 'path'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { GitService } from '../project/GitService'

export interface Checkpoint {
  sessionId: string
  turnNumber: number
  commitSha: string
  treeSha: string
  ref: string
  projectPath: string
  createdAt: number
  messageCount: number
  filesModified: string[]
  sdkJsonlLineCount: number
  sdkSessionId: string | null
}

interface CheckpointRegistry {
  checkpoints: Checkpoint[]
}

const REGISTRY_PATH = join(homedir(), '.config', 'claudex', 'checkpoint-registry.json')
const REF_PREFIX = 'refs/claudex/checkpoints'

/**
 * Manages per-turn checkpoints for conversation revert.
 * Creates hidden git commits to snapshot the working directory state
 * after each agent turn, and can restore to any checkpoint.
 */
export class CheckpointManager {
  private registry: CheckpointRegistry = { checkpoints: [] }
  private loaded = false

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    try {
      const data = await readFile(REGISTRY_PATH, 'utf-8')
      this.registry = JSON.parse(data)
    } catch {
      this.registry = { checkpoints: [] }
    }
    this.loaded = true
  }

  private async persist(): Promise<void> {
    await mkdir(join(homedir(), '.config', 'claudex'), { recursive: true })
    await writeFile(REGISTRY_PATH, JSON.stringify(this.registry, null, 2), 'utf-8')
  }

  private getRefName(sessionId: string, turnNumber: number): string {
    return `${REF_PREFIX}/${sessionId}/${turnNumber}`
  }

  private getJsonlPath(sdkSessionId: string, projectPath: string): string | null {
    const pathHash = projectPath.replace(/\//g, '-')
    const sdkDir = join(homedir(), '.claude', 'projects', pathHash)
    const filePath = join(sdkDir, `${sdkSessionId}.jsonl`)
    return existsSync(filePath) ? filePath : null
  }

  private async countJsonlLines(sdkSessionId: string | null, projectPath: string): Promise<number> {
    if (!sdkSessionId) return 0
    const jsonlPath = this.getJsonlPath(sdkSessionId, projectPath)
    if (!jsonlPath) return 0
    try {
      const content = await readFile(jsonlPath, 'utf-8')
      return content.split('\n').filter(Boolean).length
    } catch {
      return 0
    }
  }

  /**
   * Create a checkpoint with an explicit turn number (renderer-driven).
   * The renderer knows the correct UI turn number so there's no mismatch.
   */
  async createCheckpointWithTurn(opts: {
    sessionId: string
    projectPath: string
    filesModified: string[]
    messageCount: number
    turnNumber: number
    sdkSessionId: string | null
  }): Promise<Checkpoint | null> {
    await this.ensureLoaded()

    const { sessionId, projectPath, filesModified, messageCount, turnNumber, sdkSessionId } = opts

    try {
      const git = new GitService(projectPath)

      // Create a baseline (turn 0) if one doesn't exist yet
      const hasBaseline = this.registry.checkpoints.some(
        c => c.sessionId === sessionId && c.turnNumber === 0
      )
      if (!hasBaseline) {
        const headCommit = await git.getHeadCommit()
        if (headCommit) {
          const baselineRef = this.getRefName(sessionId, 0)
          await git.updateRef(baselineRef, headCommit)
          const sdkLines = await this.countJsonlLines(sdkSessionId, projectPath)

          this.registry.checkpoints.push({
            sessionId,
            turnNumber: 0,
            commitSha: headCommit,
            treeSha: '',
            ref: baselineRef,
            projectPath,
            createdAt: Date.now(),
            messageCount: 0,
            filesModified: [],
            sdkJsonlLineCount: sdkLines,
            sdkSessionId
          })
          console.log(`[CheckpointManager] Created baseline: session=${sessionId.slice(0, 8)} commit=${headCommit.slice(0, 8)}`)
        }
      }

      // Create the actual checkpoint snapshot
      const { commitSha, treeSha } = await git.createSnapshot(
        `claudex checkpoint: session ${sessionId.slice(0, 8)} turn ${turnNumber}`
      )

      const ref = this.getRefName(sessionId, turnNumber)
      await git.updateRef(ref, commitSha)

      const sdkJsonlLineCount = await this.countJsonlLines(sdkSessionId, projectPath)

      const checkpoint: Checkpoint = {
        sessionId,
        turnNumber,
        commitSha,
        treeSha,
        ref,
        projectPath,
        createdAt: Date.now(),
        messageCount,
        filesModified,
        sdkJsonlLineCount,
        sdkSessionId
      }

      this.registry.checkpoints.push(checkpoint)
      await this.persist()

      console.log(`[CheckpointManager] Created checkpoint: session=${sessionId.slice(0, 8)} turn=${turnNumber} commit=${commitSha.slice(0, 8)}`)
      return checkpoint
    } catch (err) {
      console.warn(`[CheckpointManager] Failed to create checkpoint:`, err)
      return null
    }
  }

  /** Get all checkpoints for a session, sorted by turn number */
  async getCheckpoints(sessionId: string): Promise<Checkpoint[]> {
    await this.ensureLoaded()
    return this.registry.checkpoints
      .filter(c => c.sessionId === sessionId)
      .sort((a, b) => a.turnNumber - b.turnNumber)
  }

  /** Revert working directory and SDK session to a specific checkpoint */
  async revertToCheckpoint(sessionId: string, turnNumber: number): Promise<{ messageCount: number }> {
    await this.ensureLoaded()

    const checkpoint = this.registry.checkpoints.find(
      c => c.sessionId === sessionId && c.turnNumber === turnNumber
    )
    if (!checkpoint) {
      throw new Error(`Checkpoint not found: session=${sessionId} turn=${turnNumber}`)
    }

    // 1. Restore working directory
    const git = new GitService(checkpoint.projectPath)
    await git.restoreFromCommit(checkpoint.commitSha)

    // 2. Truncate SDK JSONL if we have the info
    if (checkpoint.sdkSessionId && checkpoint.sdkJsonlLineCount > 0) {
      const jsonlPath = this.getJsonlPath(checkpoint.sdkSessionId, checkpoint.projectPath)
      if (jsonlPath) {
        try {
          const content = await readFile(jsonlPath, 'utf-8')
          const lines = content.split('\n').filter(Boolean)
          const truncated = lines.slice(0, checkpoint.sdkJsonlLineCount).join('\n') + '\n'
          await writeFile(jsonlPath, truncated, 'utf-8')
          console.log(`[CheckpointManager] Truncated JSONL to ${checkpoint.sdkJsonlLineCount} lines`)
        } catch (err) {
          console.warn(`[CheckpointManager] Failed to truncate JSONL:`, err)
        }
      }
    }

    // 3. Remove checkpoints after this turn
    const toRemove = this.registry.checkpoints.filter(
      c => c.sessionId === sessionId && c.turnNumber > turnNumber
    )
    for (const cp of toRemove) {
      await git.deleteRef(cp.ref)
    }
    this.registry.checkpoints = this.registry.checkpoints.filter(
      c => !(c.sessionId === sessionId && c.turnNumber > turnNumber)
    )

    await this.persist()
    console.log(`[CheckpointManager] Reverted to turn ${turnNumber} (commit=${checkpoint.commitSha.slice(0, 8)})`)

    return { messageCount: checkpoint.messageCount }
  }

  /** Clean up all checkpoints for a session (e.g., on session close) */
  async cleanupCheckpoints(sessionId: string): Promise<void> {
    await this.ensureLoaded()

    const sessionCheckpoints = this.registry.checkpoints.filter(c => c.sessionId === sessionId)
    if (sessionCheckpoints.length === 0) return

    // Delete git refs
    const projectPath = sessionCheckpoints[0].projectPath
    try {
      const git = new GitService(projectPath)
      for (const cp of sessionCheckpoints) {
        await git.deleteRef(cp.ref)
      }
    } catch (err) {
      console.warn(`[CheckpointManager] Failed to clean up refs:`, err)
    }

    // Remove from registry
    this.registry.checkpoints = this.registry.checkpoints.filter(c => c.sessionId !== sessionId)
    await this.persist()
  }
}
