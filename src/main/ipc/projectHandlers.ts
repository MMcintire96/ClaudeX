import { ipcMain } from 'electron'
import { ProjectManager } from '../project/ProjectManager'
import { GitService } from '../project/GitService'

export function registerProjectHandlers(projectManager: ProjectManager): void {
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
}
