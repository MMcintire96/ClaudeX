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
    }
  },
  project: {
    open: () =>
      ipcRenderer.invoke('project:open'),
    recent: () =>
      ipcRenderer.invoke('project:recent'),
    selectRecent: (path: string) =>
      ipcRenderer.invoke('project:select-recent', path),
    diff: (projectPath: string, staged?: boolean) =>
      ipcRenderer.invoke('project:diff', projectPath, staged),
    gitStatus: (projectPath: string) =>
      ipcRenderer.invoke('project:git-status', projectPath),
    diffFile: (projectPath: string, filePath: string) =>
      ipcRenderer.invoke('project:diff-file', projectPath, filePath)
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
  browser: {
    navigate: (url: string) =>
      ipcRenderer.invoke('browser:navigate', url),
    back: () =>
      ipcRenderer.invoke('browser:back'),
    forward: () =>
      ipcRenderer.invoke('browser:forward'),
    reload: () =>
      ipcRenderer.invoke('browser:reload'),
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
    onUrlChanged: (callback: (url: string) => void) => {
      const handler = (_: unknown, url: string) => callback(url)
      ipcRenderer.on('browser:url-changed', handler)
      return () => ipcRenderer.removeListener('browser:url-changed', handler)
    },
    onTitleChanged: (callback: (title: string) => void) => {
      const handler = (_: unknown, title: string) => callback(title)
      ipcRenderer.on('browser:title-changed', handler)
      return () => ipcRenderer.removeListener('browser:title-changed', handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)
