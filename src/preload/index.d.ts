export interface WorktreeInfo {
  sessionId: string
  projectPath: string
  worktreePath: string
  baseBranch: string | null
  baseCommit: string
  createdAt: number
  branchName: string | null
}

export interface ElectronAPI {
  agent: {
    start: (projectPath: string, prompt: string, model?: string | null, worktreeOptions?: { useWorktree: boolean; baseBranch?: string; includeChanges?: boolean }) => Promise<{ success: boolean; sessionId?: string; worktreePath?: string; worktreeSessionId?: string; error?: string }>
    send: (sessionId: string, content: string) => Promise<{ success: boolean; error?: string }>
    stop: (sessionId: string) => Promise<{ success: boolean }>
    status: (sessionId: string) => Promise<{ isRunning: boolean; sessionId: string | null; projectPath: string | null; hasSession: boolean }>
    setModel: (sessionId: string, model: string | null) => Promise<{ success: boolean }>
    onEvent: (callback: (data: { sessionId: string; event: unknown }) => void) => () => void
    onEvents: (callback: (data: { sessionId: string; events: unknown[] }) => void) => () => void
    onClosed: (callback: (data: { sessionId: string; code: number | null }) => void) => () => void
    onError: (callback: (data: { sessionId: string; error: string }) => void) => () => void
    onStderr: (callback: (data: { sessionId: string; data: string }) => void) => () => void
    onTitle: (callback: (data: { sessionId: string; title: string }) => void) => () => void
    resume: (sessionId: string, projectPath: string, message: string, model?: string | null) => Promise<{ success: boolean; sessionId?: string; error?: string }>
    fork: (sourceSessionId: string, projectPath: string, sourceSdkSessionId: string | null) => Promise<{
      success: boolean
      forkA?: { sessionId: string; worktreePath: string; worktreeSessionId: string }
      forkB?: { sessionId: string; worktreePath: string; worktreeSessionId: string }
      error?: string
    }>
  }
  project: {
    open: () => Promise<{ success: boolean; path?: string; isGitRepo?: boolean; canceled?: boolean }>
    recent: () => Promise<Array<{ path: string; name: string; lastOpened: number }>>
    selectRecent: (path: string) => Promise<{ success: boolean; path: string; isGitRepo: boolean }>
    removeRecent: (path: string) => Promise<{ success: boolean }>
    reorderRecent: (paths: string[]) => Promise<{ success: boolean }>
    diff: (projectPath: string, staged?: boolean) => Promise<{ success: boolean; diff?: string; error?: string }>
    gitStatus: (projectPath: string) => Promise<{ success: boolean; status?: unknown; error?: string }>
    diffFile: (projectPath: string, filePath: string, untracked?: boolean) => Promise<{ success: boolean; diff?: string; error?: string }>
    gitBranch: (projectPath: string) => Promise<{ success: boolean; branch?: string | null; error?: string }>
    getStartConfig: (projectPath: string) => Promise<{ commands: Array<{ name: string; command: string; cwd?: string }>; browserUrl?: string; buildCommand?: string } | null>
    saveStartConfig: (projectPath: string, config: { commands: Array<{ name: string; command: string; cwd?: string }>; browserUrl?: string; buildCommand?: string }) => Promise<{ success: boolean }>
    hasStartConfig: (projectPath: string) => Promise<boolean>
    runStart: (projectPath: string, cwdOverride?: string) => Promise<{ success: boolean; terminalIds?: string[]; browserUrl?: string | null; error?: string }>
    listFiles: (projectPath: string) => Promise<{ success: boolean; files: string[]; error?: string }>
    openInEditor: (projectPath: string, filePath?: string) => Promise<{ success: boolean; error?: string }>
    gitBranches: (projectPath: string) => Promise<{ success: boolean; current?: string; branches?: string[]; error?: string }>
    gitCheckout: (projectPath: string, branchName: string) => Promise<{ success: boolean; error?: string }>
    gitAdd: (projectPath: string, files?: string[]) => Promise<{ success: boolean; error?: string }>
    gitCommit: (projectPath: string, message: string) => Promise<{ success: boolean; commit?: string; error?: string }>
    gitPush: (projectPath: string) => Promise<{ success: boolean; error?: string }>
    gitLog: (projectPath: string, maxCount?: number) => Promise<{ success: boolean; log?: unknown; error?: string }>
    gitRemotes: (projectPath: string) => Promise<{ success: boolean; remotes?: Array<{ name: string; refs: { fetch: string; push: string } }>; error?: string }>
    gitDiffSummary: (projectPath: string, staged?: boolean) => Promise<{ success: boolean; summary?: { changed: number; insertions: number; deletions: number; files: Array<{ file: string; changes: number; insertions: number; deletions: number }> }; error?: string }>
    generateCommitMessage: (projectPath: string, includeUnstaged: boolean) => Promise<{ success: boolean; message?: string; error?: string }>
  }
  terminal: {
    create: (projectPath: string) => Promise<{ success: boolean; id?: string; projectPath?: string; pid?: number; error?: string }>
    write: (id: string, data: string) => Promise<{ success: boolean }>
    resize: (id: string, cols: number, rows: number) => Promise<{ success: boolean }>
    close: (id: string) => Promise<{ success: boolean }>
    list: (projectPath: string) => Promise<Array<{ id: string; projectPath: string; pid: number }>>
    rename: (id: string, name: string) => Promise<{ success: boolean }>
    onData: (callback: (id: string, data: string) => void) => () => void
    onExit: (callback: (id: string, exitCode: number) => void) => () => void
  }
  session: {
    history: (projectPath: string) => Promise<Array<{ id: string; claudeSessionId?: string; projectPath: string; name: string; createdAt: number; endedAt: number; worktreePath?: string | null; isWorktree?: boolean }>>
    clearHistory: (projectPath?: string) => Promise<{ success: boolean }>
    addHistory: (entry: { id: string; claudeSessionId?: string; projectPath: string; name: string; createdAt: number; endedAt: number; worktreePath?: string | null; isWorktree?: boolean }) => Promise<{ success: boolean }>
    onRestore: (callback: (state: unknown) => void) => () => void
  }
  settings: {
    get: () => Promise<{ claude: { dangerouslySkipPermissions: boolean }; modKey: string; vimMode: boolean }>
    update: (settings: Partial<{ claude: Partial<{ dangerouslySkipPermissions: boolean }>; modKey: string; vimMode: boolean }>) => Promise<{ claude: { dangerouslySkipPermissions: boolean }; modKey: string; vimMode: boolean }>
  }
  notification: {
    playSound: () => Promise<boolean>
  }
  voice: {
    transcribe: (pcmData: number[]) => Promise<{ success: boolean; text?: string; error?: string }>
    status: () => Promise<{ loaded: boolean; loading: boolean }>
  }
  win: {
    minimize: () => Promise<void>
    maximize: () => Promise<void>
    close: () => Promise<void>
    isMaximized: () => Promise<boolean>
    reload: () => Promise<void>
    devtools: () => Promise<void>
    onMaximizedChanged: (callback: (maximized: boolean) => void) => () => void
  }
  app: {
    onBeforeClose: (callback: () => void) => () => void
    sendUiSnapshot: (snapshot: { theme: string; sidebarWidth: number; activeProjectPath: string | null; expandedProjects: string[]; sessions?: unknown[] }) => void
  }
  popout: {
    create: (terminalId: string, projectPath: string, theme?: string, sessionSnapshot?: unknown) => Promise<{ success: boolean }>
    close: () => Promise<{ success: boolean }>
    onClosed: (callback: () => void) => () => void
    onInit: (callback: (data: { session: unknown }) => void) => () => void
  }
  browser: {
    navigate: (url: string) => Promise<{ success: boolean; error?: string }>
    back: () => Promise<{ success: boolean }>
    forward: () => Promise<{ success: boolean }>
    reload: () => Promise<{ success: boolean }>
    openDevTools: () => Promise<{ success: boolean }>
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<{ success: boolean }>
    getUrl: () => Promise<string>
    show: () => Promise<{ success: boolean }>
    hide: () => Promise<{ success: boolean }>
    switchProject: (projectPath: string) => Promise<{ url: string; tabs: Array<{ id: string; url: string; title: string }>; activeTabId: string | null }>
    destroy: () => Promise<{ success: boolean }>
    newTab: (url?: string) => Promise<{ id: string; url: string; title: string } | null>
    switchTab: (tabId: string) => Promise<{ success: boolean }>
    closeTab: (tabId: string) => Promise<{ success: boolean }>
    getTabs: () => Promise<{ tabs: Array<{ id: string; url: string; title: string }>; activeTabId: string | null }>
    onUrlChanged: (callback: (url: string) => void) => () => void
    onTitleChanged: (callback: (title: string) => void) => () => void
    onTabsUpdated: (callback: (tabs: Array<{ id: string; url: string; title: string }>, activeTabId: string | null) => void) => () => void
  }
  worktree: {
    create: (opts: { projectPath: string; sessionId: string; baseBranch?: string; includeChanges?: boolean }) => Promise<{ success: boolean; worktree?: WorktreeInfo; error?: string }>
    remove: (sessionId: string) => Promise<{ success: boolean; error?: string }>
    list: (projectPath: string) => Promise<WorktreeInfo[]>
    get: (sessionId: string) => Promise<WorktreeInfo | null>
    createBranch: (sessionId: string, branchName: string) => Promise<{ success: boolean; error?: string }>
    diff: (sessionId: string) => Promise<{ success: boolean; diff?: string; error?: string }>
    syncToLocal: (sessionId: string, mode: 'overwrite' | 'apply') => Promise<{ success: boolean; error?: string }>
    syncFromLocal: (sessionId: string, mode: 'overwrite' | 'apply') => Promise<{ success: boolean; error?: string }>
    openInEditor: (sessionId: string) => Promise<{ success: boolean; error?: string }>
  }
  neovim: {
    create: (projectPath: string, filePath?: string) => Promise<{ success: boolean; projectPath?: string; pid?: number; error?: string }>
    write: (projectPath: string, data: string) => Promise<{ success: boolean }>
    resize: (projectPath: string, cols: number, rows: number) => Promise<{ success: boolean }>
    openFile: (projectPath: string, filePath: string) => Promise<{ success: boolean }>
    close: (projectPath: string) => Promise<{ success: boolean }>
    refreshBuffers: (projectPath: string) => Promise<{ success: boolean }>
    isRunning: (projectPath: string) => Promise<boolean>
    onData: (callback: (projectPath: string, data: string) => void) => () => void
    onExit: (callback: (projectPath: string, exitCode: number) => void) => () => void
  }
  screenshot: {
    capture: () => Promise<{ success: boolean; path?: string; error?: string }>
  }
  utils: {
    getPathForFile: (file: File) => string
  }
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
