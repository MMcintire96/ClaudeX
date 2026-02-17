import simpleGit, { SimpleGit, StatusResult, DiffResult } from 'simple-git'

/**
 * Git operations via simple-git, used from the main process.
 */
export class GitService {
  private git: SimpleGit

  constructor(projectPath: string) {
    this.git = simpleGit(projectPath)
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
}
