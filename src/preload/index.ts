import { contextBridge, ipcRenderer } from 'electron'

const api = {
  agent: {
    start: (projectPath: string, prompt: string) =>
      ipcRenderer.invoke('agent:start', projectPath, prompt),
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
    }
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
    runStart: (projectPath: string) =>
      ipcRenderer.invoke('project:run-start', projectPath)
  },
  terminal: {
    create: (projectPath: string) =>
      ipcRenderer.invoke('terminal:create', projectPath),
    createClaude: (projectPath: string) =>
      ipcRenderer.invoke('terminal:create-claude', projectPath),
    write: (id: string, data: string) =>
      ipcRenderer.invoke('terminal:write', id, data),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', id, cols, rows),
    close: (id: string) =>
      ipcRenderer.invoke('terminal:close', id),
    list: (projectPath: string) =>
      ipcRenderer.invoke('terminal:list', projectPath),
    onData: (callback: (id: string, data: string) => void) => {
      const handler = (_: unknown, id: string, data: string) => callback(id, data)
      ipcRenderer.on('terminal:data', handler)
      return () => ipcRenderer.removeListener('terminal:data', handler)
    },
    onExit: (callback: (id: string, exitCode: number) => void) => {
      const handler = (_: unknown, id: string, exitCode: number) => callback(id, exitCode)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    },
    onClaudeStatus: (callback: (id: string, status: string) => void) => {
      const handler = (_: unknown, id: string, status: string) => callback(id, status)
      ipcRenderer.on('terminal:claude-status', handler)
      return () => ipcRenderer.removeListener('terminal:claude-status', handler)
    },
    onClaudeRename: (callback: (id: string, name: string) => void) => {
      const handler = (_: unknown, id: string, name: string) => callback(id, name)
      ipcRenderer.on('terminal:claude-rename', handler)
      return () => ipcRenderer.removeListener('terminal:claude-rename', handler)
    },
    createClaudeResume: (projectPath: string, claudeSessionId: string, name?: string) =>
      ipcRenderer.invoke('terminal:create-claude-resume', projectPath, claudeSessionId, name),
    getClaudeSessionId: (terminalId: string) =>
      ipcRenderer.invoke('session:get-claude-session-id', terminalId),
    onAgentSpawned: (callback: (parentId: string, agent: { id: string; name: string; status: string; startedAt: number }) => void) => {
      const handler = (_: unknown, parentId: string, agent: { id: string; name: string; status: string; startedAt: number }) => callback(parentId, agent)
      ipcRenderer.on('terminal:agent-spawned', handler)
      return () => ipcRenderer.removeListener('terminal:agent-spawned', handler)
    },
    onAgentCompleted: (callback: (parentId: string) => void) => {
      const handler = (_: unknown, parentId: string) => callback(parentId)
      ipcRenderer.on('terminal:agent-completed', handler)
      return () => ipcRenderer.removeListener('terminal:agent-completed', handler)
    },
    onContextUsage: (callback: (id: string, percent: number) => void) => {
      const handler = (_: unknown, id: string, percent: number) => callback(id, percent)
      ipcRenderer.on('terminal:context-usage', handler)
      return () => ipcRenderer.removeListener('terminal:context-usage', handler)
    },
    onClaudeSessionId: (callback: (id: string, sessionId: string) => void) => {
      const handler = (_: unknown, id: string, sessionId: string) => callback(id, sessionId)
      ipcRenderer.on('terminal:claude-session-id', handler)
      return () => ipcRenderer.removeListener('terminal:claude-session-id', handler)
    }
  },
  session: {
    history: (projectPath: string) =>
      ipcRenderer.invoke('session:history', projectPath),
    clearHistory: (projectPath?: string) =>
      ipcRenderer.invoke('session:clear-history', projectPath),
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
  sessionFile: {
    watch: (terminalId: string, claudeSessionId: string, projectPath: string) =>
      ipcRenderer.invoke('session-file:watch', terminalId, claudeSessionId, projectPath),
    unwatch: (terminalId: string) =>
      ipcRenderer.invoke('session-file:unwatch', terminalId),
    read: (claudeSessionId: string, projectPath: string) =>
      ipcRenderer.invoke('session-file:read', claudeSessionId, projectPath),
    findLatest: (projectPath: string, afterTimestamp?: number) =>
      ipcRenderer.invoke('session-file:find-latest', projectPath, afterTimestamp),
    onEntries: (callback: (terminalId: string, entries: unknown[]) => void) => {
      const handler = (_: unknown, terminalId: string, entries: unknown[]) => callback(terminalId, entries)
      ipcRenderer.on('session-file:entries', handler)
      return () => ipcRenderer.removeListener('session-file:entries', handler)
    },
    onReset: (callback: (terminalId: string, entries: unknown[]) => void) => {
      const handler = (_: unknown, terminalId: string, entries: unknown[]) => callback(terminalId, entries)
      ipcRenderer.on('session-file:reset', handler)
      return () => ipcRenderer.removeListener('session-file:reset', handler)
    }
  },
  app: {
    onBeforeClose: (callback: () => void) => {
      const handler = () => callback()
      ipcRenderer.on('app:before-close', handler)
      return () => ipcRenderer.removeListener('app:before-close', handler)
    },
    sendUiSnapshot: (snapshot: { theme: string; sidebarWidth: number; activeProjectPath: string | null; expandedProjects: string[] }) =>
      ipcRenderer.send('app:ui-snapshot', snapshot)
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
  }
}

contextBridge.exposeInMainWorld('api', api)
