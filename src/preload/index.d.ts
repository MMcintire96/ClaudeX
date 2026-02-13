export interface ElectronAPI {
  agent: {
    start: (projectPath: string, prompt: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
    send: (sessionId: string, content: string) => Promise<{ success: boolean; error?: string }>
    stop: (sessionId: string) => Promise<{ success: boolean }>
    status: (sessionId: string) => Promise<{ isRunning: boolean; sessionId: string | null; projectPath: string | null; hasSession: boolean }>
    setModel: (sessionId: string, model: string | null) => Promise<{ success: boolean }>
    onEvent: (callback: (data: { sessionId: string; event: unknown }) => void) => () => void
    onClosed: (callback: (data: { sessionId: string; code: number | null }) => void) => () => void
    onError: (callback: (data: { sessionId: string; error: string }) => void) => () => void
  }
  project: {
    open: () => Promise<{ success: boolean; path?: string; isGitRepo?: boolean; canceled?: boolean }>
    recent: () => Promise<Array<{ path: string; name: string; lastOpened: number }>>
    selectRecent: (path: string) => Promise<{ success: boolean; path: string; isGitRepo: boolean }>
    diff: (projectPath: string, staged?: boolean) => Promise<{ success: boolean; diff?: string; error?: string }>
    gitStatus: (projectPath: string) => Promise<{ success: boolean; status?: unknown; error?: string }>
    diffFile: (projectPath: string, filePath: string) => Promise<{ success: boolean; diff?: string; error?: string }>
  }
  browser: {
    navigate: (url: string) => Promise<{ success: boolean; error?: string }>
    back: () => Promise<{ success: boolean }>
    forward: () => Promise<{ success: boolean }>
    reload: () => Promise<{ success: boolean }>
    setBounds: (bounds: { x: number; y: number; width: number; height: number }) => Promise<{ success: boolean }>
    getUrl: () => Promise<string>
    show: () => Promise<{ success: boolean }>
    hide: () => Promise<{ success: boolean }>
    switchProject: (projectPath: string) => Promise<string>
    destroy: () => Promise<{ success: boolean }>
    onUrlChanged: (callback: (url: string) => void) => () => void
    onTitleChanged: (callback: (title: string) => void) => () => void
  }
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}
