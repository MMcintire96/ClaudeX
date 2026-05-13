import { dialog, app } from 'electron'
import { existsSync } from 'fs'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'

interface RecentProject {
  path: string
  name: string
  lastOpened: number
}

export interface ProjectGroup {
  id: string
  name: string
  projectPaths: string[]
}

interface RecentProjectsData {
  version: 2
  projects: RecentProject[]
  groups: ProjectGroup[]
  groupOrder: string[] // mix of group IDs and ungrouped project paths
}

const MAX_RECENT = 10

/**
 * Manages project selection, validation, and persistence of recent projects.
 */
export class ProjectManager {
  private recentProjects: RecentProject[] = []
  private groups: ProjectGroup[] = []
  private groupOrder: string[] = []
  private configPath: string

  constructor() {
    this.configPath = join(app.getPath('userData'), 'recent-projects.json')
  }

  async init(): Promise<void> {
    try {
      const data = await readFile(this.configPath, 'utf-8')
      const parsed = JSON.parse(data)

      // Migrate from old flat array format
      if (Array.isArray(parsed)) {
        this.recentProjects = parsed as RecentProject[]
        this.groups = []
        this.groupOrder = this.recentProjects.map(p => p.path)
        await this.persist()
      } else if (parsed.version === 2) {
        const d = parsed as RecentProjectsData
        this.recentProjects = d.projects
        this.groups = d.groups || []
        this.groupOrder = d.groupOrder || d.projects.map(p => p.path)
      } else {
        this.recentProjects = []
        this.groups = []
        this.groupOrder = []
      }
    } catch {
      this.recentProjects = []
      this.groups = []
      this.groupOrder = []
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
    const existed = this.recentProjects.some(p => p.path === projectPath)
    // Remove existing entry for this path
    this.recentProjects = this.recentProjects.filter(p => p.path !== projectPath)
    // Add to front
    this.recentProjects.unshift({ path: projectPath, name, lastOpened: Date.now() })
    // Trim
    this.recentProjects = this.recentProjects.slice(0, MAX_RECENT)
    // Add to groupOrder if new
    if (!existed && !this.groupOrder.includes(projectPath)) {
      this.groupOrder.unshift(projectPath)
    }
    await this.persist()
  }

  getRecent(): RecentProject[] {
    return this.recentProjects
  }

  getGroups(): ProjectGroup[] {
    return this.groups
  }

  getGroupOrder(): string[] {
    return this.groupOrder
  }

  getRecentWithGroups(): RecentProjectsData {
    return {
      version: 2,
      projects: this.recentProjects,
      groups: this.groups,
      groupOrder: this.groupOrder
    }
  }

  async reorderRecent(paths: string[]): Promise<void> {
    const byPath = new Map(this.recentProjects.map(p => [p.path, p]))
    const reordered: RecentProject[] = []
    for (const path of paths) {
      const proj = byPath.get(path)
      if (proj) reordered.push(proj)
    }
    // Append any that weren't in the new order (shouldn't happen, but safe)
    for (const proj of this.recentProjects) {
      if (!reordered.some(r => r.path === proj.path)) {
        reordered.push(proj)
      }
    }
    this.recentProjects = reordered
    await this.persist()
  }

  async removeRecent(projectPath: string): Promise<void> {
    this.recentProjects = this.recentProjects.filter(p => p.path !== projectPath)
    // Remove from any group
    for (const group of this.groups) {
      group.projectPaths = group.projectPaths.filter(p => p !== projectPath)
    }
    // Remove from groupOrder
    this.groupOrder = this.groupOrder.filter(e => e !== projectPath)
    await this.persist()
  }

  // --- Group management ---

  async createGroup(name: string): Promise<ProjectGroup> {
    const group: ProjectGroup = {
      id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      projectPaths: []
    }
    this.groups.push(group)
    this.groupOrder.push(group.id)
    await this.persist()
    return group
  }

  async renameGroup(groupId: string, name: string): Promise<void> {
    const group = this.groups.find(g => g.id === groupId)
    if (group) {
      group.name = name
      await this.persist()
    }
  }

  async deleteGroup(groupId: string): Promise<void> {
    const group = this.groups.find(g => g.id === groupId)
    if (!group) return
    // Insert ungrouped projects into groupOrder where the group was
    const groupIdx = this.groupOrder.indexOf(groupId)
    if (groupIdx !== -1) {
      this.groupOrder.splice(groupIdx, 1, ...group.projectPaths)
    }
    this.groups = this.groups.filter(g => g.id !== groupId)
    await this.persist()
  }

  async moveToGroup(projectPath: string, groupId: string | null): Promise<void> {
    // Remove from any current group
    for (const group of this.groups) {
      group.projectPaths = group.projectPaths.filter(p => p !== projectPath)
    }

    if (groupId === null) {
      // Move to ungrouped — ensure it's in groupOrder as a standalone entry
      if (!this.groupOrder.includes(projectPath)) {
        this.groupOrder.push(projectPath)
      }
    } else {
      const targetGroup = this.groups.find(g => g.id === groupId)
      if (targetGroup) {
        targetGroup.projectPaths.push(projectPath)
        // Remove from groupOrder as standalone (it's now inside the group)
        this.groupOrder = this.groupOrder.filter(e => e !== projectPath)
      }
    }
    await this.persist()
  }

  async reorderAll(newGroupOrder: string[]): Promise<void> {
    this.groupOrder = newGroupOrder
    await this.persist()
  }

  async reorderWithinGroup(groupId: string, projectPaths: string[]): Promise<void> {
    const group = this.groups.find(g => g.id === groupId)
    if (group) {
      group.projectPaths = projectPaths
      await this.persist()
    }
  }

  private async persist(): Promise<void> {
    try {
      const dir = join(app.getPath('userData'))
      await mkdir(dir, { recursive: true })
      const data: RecentProjectsData = {
        version: 2,
        projects: this.recentProjects,
        groups: this.groups,
        groupOrder: this.groupOrder
      }
      await writeFile(this.configPath, JSON.stringify(data, null, 2))
    } catch {
      // Silently fail on persistence errors
    }
  }
}
