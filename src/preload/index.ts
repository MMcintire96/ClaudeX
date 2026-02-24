import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  agent: {
    start: (projectPath: string, prompt: string, model?: string | null, worktreeOptions?: { useWorktree: boolean; baseBranch?: string; includeChanges?: boolean }) =>
      ipcRenderer.invoke('agent:start', projectPath, prompt, model, worktreeOptions),
    send: (sessionId: string, content: string) =>
      ipcRenderer.invoke('agent:send', sessionId, content),
    stop: (sessionId: string) =>
      ipcRenderer.invoke('agent:stop', sessionId),
    status: (sessionId: string) =>
      ipcRenderer.invoke('agent:status', sessionId),
    setModel: (sessionId: string, model: string | null) =>
      ipcRenderer.invoke('agent:set-model', sessionId, model),
    onEvent: (callback: (data: { sessionId: string; event: unknown }) => void) => {
      const handler = (_: unknown, data: { sessionId: string; event: unknown }) => callback(data)
      ipcRenderer.on('agent:event', handler)
      return () => ipcRenderer.removeListener('agent:event', handler)
    },
    onEvents: (callback: (data: { sessionId: string; events: unknown[] }) => void) => {
      const handler = (_: unknown, data: { sessionId: string; events: unknown[] }) => callback(data)
      ipcRenderer.on('agent:events', handler)
      return () => ipcRenderer.removeListener('agent:events', handler)
    },
    onClosed: (callback: (data: { sessionId: string; code: number | null }) => void) => {
      const handler = (_: unknown, data: { sessionId: string; code: number | null }) => callback(data)
      ipcRenderer.on('agent:closed', handler)
      return () => ipcRenderer.removeListener('agent:closed', handler)
    },
    onError: (callback: (data: { sessionId: string; error: string }) => void) => {
      const handler = (_: unknown, data: { sessionId: string; error: string }) => callback(data)
      ipcRenderer.on('agent:error', handler)
      return () => ipcRenderer.removeListener('agent:error', handler)
    },
    onStderr: (callback: (data: { sessionId: string; data: string }) => void) => {
      const handler = (_: unknown, data: { sessionId: string; data: string }) => callback(data)
      ipcRenderer.on('agent:stderr', handler)
      return () => ipcRenderer.removeListener('agent:stderr', handler)
    },
    onTitle: (callback: (data: { sessionId: string; title: string }) => void) => {
      const handler = (_: unknown, data: { sessionId: string; title: string }) => callback(data)
      ipcRenderer.on('agent:title', handler)
      return () => ipcRenderer.removeListener('agent:title', handler)
    },
    resume: (sessionId: string, projectPath: string, message: string, model?: string | null) =>
      ipcRenderer.invoke('agent:resume', sessionId, projectPath, message, model),
    fork: (sourceSessionId: string, projectPath: string, sourceSdkSessionId: string | null) =>
      ipcRenderer.invoke('agent:fork', sourceSessionId, projectPath, sourceSdkSessionId),
  },
  project: {
    open: () =>
      ipcRenderer.invoke('project:open'),
    recent: () =>
      ipcRenderer.invoke('project:recent'),
    selectRecent: (path: string) =>
      ipcRenderer.invoke('project:select-recent', path),
    removeRecent: (path: string) =>
      ipcRenderer.invoke('project:remove-recent', path),
    reorderRecent: (paths: string[]) =>
      ipcRenderer.invoke('project:reorder-recent', paths),
    diff: (projectPath: string, staged?: boolean) =>
      ipcRenderer.invoke('project:diff', projectPath, staged),
    gitStatus: (projectPath: string) =>
      ipcRenderer.invoke('project:git-status', projectPath),
    diffFile: (projectPath: string, filePath: string) =>
      ipcRenderer.invoke('project:diff-file', projectPath, filePath),
    gitBranch: (projectPath: string) =>
      ipcRenderer.invoke('project:git-branch', projectPath),
    getStartConfig: (projectPath: string) =>
      ipcRenderer.invoke('project:get-start-config', projectPath),
    saveStartConfig: (projectPath: string, config: unknown) =>
      ipcRenderer.invoke('project:save-start-config', projectPath, config),
    hasStartConfig: (projectPath: string) =>
      ipcRenderer.invoke('project:has-start-config', projectPath),
    runStart: (projectPath: string, cwdOverride?: string) =>
      ipcRenderer.invoke('project:run-start', projectPath, cwdOverride),
    listFiles: (projectPath: string) =>
      ipcRenderer.invoke('project:list-files', projectPath),
    openInEditor: (projectPath: string, filePath?: string) =>
      ipcRenderer.invoke('project:open-in-editor', projectPath, filePath),
    gitBranches: (projectPath: string) =>
      ipcRenderer.invoke('project:git-branches', projectPath),
    gitCheckout: (projectPath: string, branchName: string) =>
      ipcRenderer.invoke('project:git-checkout', projectPath, branchName),
    gitAdd: (projectPath: string, files?: string[]) =>
      ipcRenderer.invoke('project:git-add', projectPath, files),
    gitCommit: (projectPath: string, message: string) =>
      ipcRenderer.invoke('project:git-commit', projectPath, message),
    gitPush: (projectPath: string) =>
      ipcRenderer.invoke('project:git-push', projectPath),
    gitLog: (projectPath: string, maxCount?: number) =>
      ipcRenderer.invoke('project:git-log', projectPath, maxCount),
    gitRemotes: (projectPath: string) =>
      ipcRenderer.invoke('project:git-remotes', projectPath),
    gitDiffSummary: (projectPath: string, staged?: boolean) =>
      ipcRenderer.invoke('project:git-diff-summary', projectPath, staged)
  },
  terminal: {
    create: (projectPath: string) =>
      ipcRenderer.invoke('terminal:create', projectPath),
    write: (id: string, data: string) =>
      ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', id, cols, rows),
    close: (id: string) =>
      ipcRenderer.invoke('terminal:close', id),
    list: (projectPath: string) =>
      ipcRenderer.invoke('terminal:list', projectPath),
    rename: (id: string, name: string) =>
      ipcRenderer.invoke('terminal:rename', id, name),
    onData: (callback: (id: string, data: string) => void) => {
      const handler = (_: unknown, id: string, data: string) => callback(id, data)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.removeListener('terminal:data', handler)
    },
    onExit: (callback: (id: string, exitCode: number) => void) => {
      const handler = (_: unknown, id: string, exitCode: number) => callback(id, exitCode)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    }
  },
  session: {
    history: (projectPath: string) =>
      ipcRenderer.invoke('session:history', projectPath),
    clearHistory: (projectPath?: string) =>
      ipcRenderer.invoke('session:clear-history', projectPath),
    addHistory: (entry: { id: string; claudeSessionId?: string; projectPath: string; name: string; createdAt: number; endedAt: number; worktreePath?: string | null; isWorktree?: boolean }) =>
      ipcRenderer.invoke('session:add-history', entry),
    onRestore: (callback: (state: unknown) => void) => {
      const handler = (_: unknown, state: unknown) => callback(state)
      ipcRenderer.on('session:restore', handler)
      return () => ipcRenderer.removeListener('session:restore', handler)
    }
  },
  settings: {
    get: () =>
      ipcRenderer.invoke('settings:get'),
    update: (settings: Record<string, unknown>) =>
      ipcRenderer.invoke('settings:update', settings)
  },
  voice: {
    transcribe: (pcmData: number[]) =>
      ipcRenderer.invoke('voice:transcribe', pcmData),
    status: () =>
      ipcRenderer.invoke('voice:status')
  },
  win: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    reload: () => ipcRenderer.invoke('window:reload'),
    devtools: () => ipcRenderer.invoke('window:devtools'),
    onMaximizedChanged: (callback: (maximized: boolean) => void) => {
      const handler = (_: unknown, maximized: boolean) => callback(maximized)
      ipcRenderer.on('window:maximized-changed', handler)
      return () => ipcRenderer.removeListener('window:maximized-changed', handler)
    }
  },
  app: {
    onBeforeClose: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('app:before-close', handler)
      return () => ipcRenderer.removeListener('app:before-close', handler)
    },
    sendUiSnapshot: (snapshot: { theme: string; sidebarWidth: number; activeProjectPath: string | null; expandedProjects: string[]; sessions?: unknown[] }) =>
      ipcRenderer.send('app:ui-snapshot', snapshot)
  },
  popout: {
    create: (terminalId: string, projectPath: string, theme?: string, sessionSnapshot?: unknown) =>
      ipcRenderer.invoke('popout:create', terminalId, projectPath, theme, sessionSnapshot),
    close: () =>
      ipcRenderer.invoke('popout:close'),
    onClosed: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('popout:closed', handler)
      return () => ipcRenderer.removeListener('popout:closed', handler)
    },
    onInit: (callback: (data: { session: unknown }) => void) => {
      const handler = (_: unknown, data: { session: unknown }) => callback(data)
      ipcRenderer.on('popout:init', handler)
      return () => ipcRenderer.removeListener('popout:init', handler)
    }
  },
  browser: {
    navigate: (url: string) =>
      ipcRenderer.invoke('browser:navigate', url),
    back: () =>
      ipcRenderer.invoke('browser:back'),
    forward: () =>
      ipcRenderer.invoke('browser:forward'),
    reload: () =>
      ipcRenderer.invoke('browser:reload'),
    openDevTools: () =>
      ipcRenderer.invoke('browser:open-devtools'),
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('browser:set-bounds', bounds),
    getUrl: () =>
      ipcRenderer.invoke('browser:get-url'),
    show: () =>
      ipcRenderer.invoke('browser:show'),
    hide: () =>
      ipcRenderer.invoke('browser:hide'),
    switchProject: (projectPath: string) =>
      ipcRenderer.invoke('browser:switch-project', projectPath),
    destroy: () =>
      ipcRenderer.invoke('browser:destroy'),
    newTab: (url?: string) =>
      ipcRenderer.invoke('browser:new-tab', url),
    switchTab: (tabId: string) =>
      ipcRenderer.invoke('browser:switch-tab', tabId),
    closeTab: (tabId: string) =>
      ipcRenderer.invoke('browser:close-tab', tabId),
    getTabs: () =>
      ipcRenderer.invoke('browser:get-tabs'),
    onUrlChanged: (callback: (url: string) => void) => {
      const handler = (_: unknown, url: string) => callback(url)
      ipcRenderer.on('browser:url-changed', handler)
      return () => ipcRenderer.removeListener('browser:url-changed', handler)
    },
    onTitleChanged: (callback: (title: string) => void) => {
      const handler = (_: unknown, title: string) => callback(title)
      ipcRenderer.on('browser:title-changed', handler)
      return () => ipcRenderer.removeListener('browser:title-changed', handler)
    },
    onTabsUpdated: (callback: (tabs: Array<{ id: string; url: string; title: string }>, activeTabId: string | null) => void) => {
      const handler = (_: unknown, tabs: Array<{ id: string; url: string; title: string }>, activeTabId: string | null) => callback(tabs, activeTabId)
      ipcRenderer.on('browser:tabs-updated', handler)
      return () => ipcRenderer.removeListener('browser:tabs-updated', handler)
    }
  },
  worktree: {
    create: (opts: { projectPath: string; sessionId: string; baseBranch?: string; includeChanges?: boolean }) =>
      ipcRenderer.invoke('worktree:create', opts),
    remove: (sessionId: string) =>
      ipcRenderer.invoke('worktree:remove', sessionId),
    list: (projectPath: string) =>
      ipcRenderer.invoke('worktree:list', projectPath),
    get: (sessionId: string) =>
      ipcRenderer.invoke('worktree:get', sessionId),
    createBranch: (sessionId: string, branchName: string) =>
      ipcRenderer.invoke('worktree:create-branch', sessionId, branchName),
    diff: (sessionId: string) =>
      ipcRenderer.invoke('worktree:diff', sessionId),
    syncToLocal: (sessionId: string, mode: 'overwrite' | 'apply') =>
      ipcRenderer.invoke('worktree:sync-to-local', sessionId, mode),
    syncFromLocal: (sessionId: string, mode: 'overwrite' | 'apply') =>
      ipcRenderer.invoke('worktree:sync-from-local', sessionId, mode),
    openInEditor: (sessionId: string) =>
      ipcRenderer.invoke('worktree:open-in-editor', sessionId)
  },
  screenshot: {
    capture: () =>
      ipcRenderer.invoke('screenshot:capture') as Promise<{ success: boolean; path?: string; error?: string }>
  },
  utils: {
    getPathForFile: (file: File): string => {
      try {
        return webUtils.getPathForFile(file)
      } catch {
        return ''
      }
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
