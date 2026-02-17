import { ipcMain } from 'electron'
import { resolve } from 'path'
import { ProjectManager } from '../project/ProjectManager'
import { GitService } from '../project/GitService'
import { ProjectConfigManager, ProjectStartConfig } from '../project/ProjectConfigManager'
import { TerminalManager } from '../terminal/TerminalManager'

export function registerProjectHandlers(
  projectManager: ProjectManager,
  projectConfigManager?: ProjectConfigManager,
  terminalManager?: TerminalManager
): void {
  ipcMain.handle('project:open', async () => {
    const path = await projectManager.openProjectDialog()
    if (!path) return { success: false, canceled: true }
    return {
      success: true,
      path,
      isGitRepo: projectManager.isGitRepo(path)
    }
  })

  ipcMain.handle('project:recent', () => {
    return projectManager.getRecent()
  })

  ipcMain.handle('project:reorder-recent', async (_event, paths: string[]) => {
    await projectManager.reorderRecent(paths)
    return { success: true }
  })

  ipcMain.handle('project:remove-recent', async (_event, path: string) => {
    await projectManager.removeRecent(path)
    return { success: true }
  })

  ipcMain.handle('project:select-recent', async (_event, path: string) => {
    await projectManager.addRecent(path)
    return {
      success: true,
      path,
      isGitRepo: projectManager.isGitRepo(path)
    }
  })

  ipcMain.handle('project:diff', async (_event, projectPath: string, staged?: boolean) => {
    try {
      const git = new GitService(projectPath)
      const diff = await git.diff(staged)
      return { success: true, diff }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('project:git-status', async (_event, projectPath: string) => {
    try {
      const git = new GitService(projectPath)
      const status = await git.status()
      // Serialize to plain object — StatusResult has non-cloneable properties
      return {
        success: true,
        status: {
          files: status.files.map(f => ({
            path: f.path,
            index: f.index,
            working_dir: f.working_dir
          })),
          staged: status.staged,
          modified: status.modified,
          not_added: status.not_added,
          deleted: status.deleted,
          renamed: status.renamed.map(r => ({ from: r.from, to: r.to })),
          conflicted: status.conflicted,
          isClean: status.isClean()
        }
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('project:diff-file', async (_event, projectPath: string, filePath: string) => {
    try {
      const git = new GitService(projectPath)
      const diff = await git.diffFile(filePath)
      return { success: true, diff }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('project:git-branch', async (_event, projectPath: string) => {
    try {
      const git = new GitService(projectPath)
      const branch = await git.branch()
      return { success: true, branch }
    } catch (err) {
      return { success: false, error: (err as Error).message, branch: null }
    }
  })

  // Start config handlers
  ipcMain.handle('project:get-start-config', (_event, projectPath: string) => {
    if (!projectConfigManager) return null
    return projectConfigManager.getConfig(projectPath)
  })

  ipcMain.handle('project:save-start-config', (_event, projectPath: string, config: ProjectStartConfig) => {
    if (!projectConfigManager) return { success: false }
    projectConfigManager.saveConfig(projectPath, config)
    return { success: true }
  })

  ipcMain.handle('project:has-start-config', (_event, projectPath: string) => {
    if (!projectConfigManager) return false
    return projectConfigManager.hasConfig(projectPath)
  })

  ipcMain.handle('project:run-start', (_event, projectPath: string) => {
    if (!projectConfigManager || !terminalManager) return { success: false, error: 'Not configured' }
    const config = projectConfigManager.getConfig(projectPath)
    if (!config || config.commands.length === 0) return { success: false, error: 'No start config' }

    const terminals: Array<{ id: string; projectPath: string; pid: number; name: string }> = []
    for (const cmd of config.commands) {
      const cwd = cmd.cwd ? resolve(projectPath, cmd.cwd) : projectPath
      const info = terminalManager.create(cwd)
      terminalManager.setTerminalName(info.id, cmd.name)
      // Write the command to the terminal
      terminalManager.write(info.id, cmd.command + '\n')
      terminals.push({ id: info.id, projectPath: info.projectPath, pid: info.pid, name: cmd.name })
    }

    return { success: true, terminals, terminalIds: terminals.map(t => t.id), browserUrl: config.browserUrl || null }
  })
}
