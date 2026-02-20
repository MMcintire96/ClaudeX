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
}
