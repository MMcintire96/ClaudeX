import { ipcMain } from 'electron'
import { resolve } from 'path'
import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import { ProjectManager } from '../project/ProjectManager'
import { GitService } from '../project/GitService'

const execFileAsync = promisify(execFile)
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

  ipcMain.handle('project:git-branches', async (_event, projectPath: string) => {
    try {
      const git = new GitService(projectPath)
      const result = await git.branchList()
      return { success: true, current: result.current, branches: result.all }
    } catch (err) {
      return { success: false, error: (err as Error).message, branches: [] }
    }
  })

  ipcMain.handle('project:git-checkout', async (_event, projectPath: string, branchName: string) => {
    try {
      const git = new GitService(projectPath)
      await git.checkout(branchName)
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
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

  ipcMain.handle('project:run-start', (_event, projectPath: string, cwdOverride?: string) => {
    if (!projectConfigManager || !terminalManager) return { success: false, error: 'Not configured' }
    const config = projectConfigManager.getConfig(projectPath)
    if (!config || config.commands.length === 0) return { success: false, error: 'No start config' }

    const baseCwd = cwdOverride || projectPath
    const terminals: Array<{ id: string; projectPath: string; pid: number; name: string }> = []
    for (const cmd of config.commands) {
      const cwd = cmd.cwd ? resolve(baseCwd, cmd.cwd) : baseCwd
      const info = terminalManager.create(cwd)
      terminalManager.setTerminalName(info.id, cmd.name)
      // Write the command to the terminal
      terminalManager.write(info.id, cmd.command + '\n')
      terminals.push({ id: info.id, projectPath: info.projectPath, pid: info.pid, name: cmd.name })
    }

    return { success: true, terminals, terminalIds: terminals.map(t => t.id), browserUrl: config.browserUrl || null }
  })

  ipcMain.handle('project:open-in-editor', (_event, projectPath: string, filePath?: string) => {
    const editor = process.env.VISUAL || process.env.EDITOR || 'code'
    const bin = editor.split('/').pop() || editor
    const tuiEditors = ['vi', 'vim', 'nvim', 'neovim', 'nano', 'helix', 'hx', 'emacs', 'micro', 'kakoune', 'kak']
    const isTui = tuiEditors.includes(bin)
    const target = filePath ? resolve(projectPath, filePath) : projectPath

    return new Promise<{ success: boolean; error?: string }>((res) => {
      let cmd: string
      let args: string[]
      if (isTui) {
        cmd = process.env.TERMINAL || 'alacritty'
        args = ['--working-directory', projectPath, '-e', editor, target]
      } else {
        cmd = editor
        args = [target]
      }
      const child = spawn(cmd, args, { cwd: projectPath, detached: true, stdio: 'ignore' })
      child.on('error', (err) => {
        res({ success: false, error: err.message })
      })
      child.on('spawn', () => {
        child.unref()
        res({ success: true })
      })
    })
  })

  ipcMain.handle('project:git-add', async (_event, projectPath: string, files?: string[]) => {
    try {
      const git = new GitService(projectPath)
      if (files && files.length > 0) {
        await git.add(files)
      } else {
        await git.addAll()
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('project:git-commit', async (_event, projectPath: string, message: string) => {
    try {
      const git = new GitService(projectPath)
      const commit = await git.commit(message)
      return { success: true, commit }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('project:git-push', async (_event, projectPath: string) => {
    try {
      const git = new GitService(projectPath)
      await git.push()
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('project:git-log', async (_event, projectPath: string, maxCount?: number) => {
    try {
      const git = new GitService(projectPath)
      const log = await git.log(maxCount || 10)
      return { success: true, log }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('project:git-remotes', async (_event, projectPath: string) => {
    try {
      const git = new GitService(projectPath)
      const remotes = await git.getRemotes()
      return { success: true, remotes }
    } catch (err) {
      return { success: false, error: (err as Error).message, remotes: [] }
    }
  })

  ipcMain.handle('project:git-diff-summary', async (_event, projectPath: string, staged?: boolean) => {
    try {
      const git = new GitService(projectPath)
      const summary = await git.diffSummary(staged)
      return {
        success: true,
        summary: {
          changed: summary.changed,
          insertions: summary.insertions,
          deletions: summary.deletions,
          files: summary.files.map(f => ({ file: f.file, changes: f.changes, insertions: f.insertions, deletions: f.deletions }))
        }
      }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('project:list-files', async (_event, projectPath: string) => {
    try {
      // Use git ls-files for .gitignore-aware listing, include untracked non-ignored files
      const { stdout } = await execFileAsync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
        cwd: projectPath,
        maxBuffer: 10 * 1024 * 1024
      })
      const files = stdout.split('\n').filter(f => f.length > 0)
      return { success: true, files }
    } catch {
      return { success: false, files: [], error: 'Failed to list files' }
    }
  })
}
