import { dialog, app } from 'electron'
import { existsSync } from 'fs'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

interface RecentProject {
  path: string
  name: string
  lastOpened: number
}

const MAX_RECENT = 10

/**
 * Manages project selection, validation, and persistence of recent projects.
 */
export class ProjectManager {
  private recentProjects: RecentProject[] = []
  private configPath: string

  constructor() {
    this.configPath = join(app.getPath('userData'), 'recent-projects.json')
  }

  async init(): Promise<void> {
    try {
      const data = await readFile(this.configPath, 'utf-8')
      this.recentProjects = JSON.parse(data)
    } catch {
      this.recentProjects = []
    }
  }

  async openProjectDialog(): Promise<string | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Open Project'
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    const projectPath = result.filePaths[0]
    await this.addRecent(projectPath)
    return projectPath
  }

  isGitRepo(projectPath: string): boolean {
    return existsSync(join(projectPath, '.git'))
  }

  async addRecent(projectPath: string): Promise<void> {
    const name = projectPath.split('/').pop() || projectPath
    // Remove existing entry for this path
    this.recentProjects = this.recentProjects.filter(p => p.path !== projectPath)
    // Add to front
    this.recentProjects.unshift({ path: projectPath, name, lastOpened: Date.now() })
    // Trim
    this.recentProjects = this.recentProjects.slice(0, MAX_RECENT)
    await this.persist()
  }

  getRecent(): RecentProject[] {
    return this.recentProjects
  }

  private async persist(): Promise<void> {
    try {
      const dir = join(app.getPath('userData'))
      await mkdir(dir, { recursive: true })
      await writeFile(this.configPath, JSON.stringify(this.recentProjects, null, 2))
    } catch {
      // Silently fail on persistence errors
    }
  }
}
