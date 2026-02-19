import { app, BrowserWindow, shell, globalShortcut, session, Menu, ipcMain } from 'electron'
import { join } from 'path'
import { AgentManager } from './agent/AgentManager'
import { ProjectManager } from './project/ProjectManager'
import { BrowserManager } from './browser/BrowserManager'
import { TerminalManager } from './terminal/TerminalManager'
import { SettingsManager } from './settings/SettingsManager'
import { VoiceManager } from './voice/VoiceManager'
import { SessionPersistence } from './session/SessionPersistence'
import { SessionFileWatcher } from './session/SessionFileWatcher'
import { ProjectConfigManager } from './project/ProjectConfigManager'
import { CodexBridgeServer } from './bridge/CodexBridgeServer'
import { registerAllHandlers } from './ipc'

const agentManager = new AgentManager()
const projectManager = new ProjectManager()
const browserManager = new BrowserManager()
const terminalManager = new TerminalManager()
const settingsManager = new SettingsManager()
const voiceManager = new VoiceManager()
const sessionPersistence = new SessionPersistence()
const sessionFileWatcher = new SessionFileWatcher()
const projectConfigManager = new ProjectConfigManager()
const bridgeServer = new CodexBridgeServer(terminalManager, browserManager)

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  // Remove GTK/native menu bar
  Menu.setApplicationMenu(null)

  const isMac = process.platform === 'darwin'

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Claude Codex',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    },
    // macOS: inset title bar with traffic lights; Linux/Windows: frameless
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 15, y: 15 } }
      : { frame: false })
  })

  // Window control IPC handlers
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:is-maximized', () => mainWindow?.isMaximized() ?? false)
  ipcMain.handle('window:reload', () => mainWindow?.webContents.reload())
  ipcMain.handle('window:devtools', () => mainWindow?.webContents.toggleDevTools())

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', false)
  })

  agentManager.setMainWindow(mainWindow)
  browserManager.setMainWindow(mainWindow)
  terminalManager.setMainWindow(mainWindow)
  sessionFileWatcher.setMainWindow(mainWindow)

  // Prevent the window from navigating away (e.g. when a file is dropped)
  mainWindow.webContents.on('will-navigate', (e) => {
    e.preventDefault()
  })

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Send restore data after renderer loads
  mainWindow.webContents.on('did-finish-load', () => {
    const savedState = sessionPersistence.loadState()
    if (savedState.sessions.length > 0) {
      mainWindow?.webContents.send('session:restore', savedState)
    }
  })

  // Load the renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Deferred close: request UI snapshot from renderer before saving
  let isClosing = false
  ipcMain.on('app:ui-snapshot', (_event, snapshot: { theme: string; sidebarWidth: number; activeProjectPath: string | null; expandedProjects: string[] }) => {
    if (!isClosing) return
    try {
      const sessions: Array<{ id: string; claudeSessionId?: string; projectPath: string; name: string; createdAt: number; lastActiveAt: number }> = []
      for (const projPath of projectManager.getRecentPaths()) {
        const terms = terminalManager.list(projPath)
        for (const t of terms) {
          const claudeSessionId = terminalManager.getClaudeSessionId(t.id)
          if (claudeSessionId) {
            const createdAt = terminalManager.getCreatedAt(t.id)
            sessionPersistence.addToHistory({
              id: t.id,
              claudeSessionId,
              projectPath: t.projectPath,
              name: terminalManager.getTerminalName(t.id) || 'Claude Code',
              createdAt,
              endedAt: Date.now()
            })
            sessions.push({
              id: t.id,
              claudeSessionId,
              projectPath: t.projectPath,
              name: terminalManager.getTerminalName(t.id) || 'Claude Code',
              createdAt,
              lastActiveAt: Date.now()
            })
          }
        }
      }
      sessionPersistence.saveState({
        version: 1,
        activeProjectPath: snapshot.activeProjectPath,
        expandedProjects: snapshot.expandedProjects,
        sessions,
        theme: snapshot.theme || 'dark',
        sidebarWidth: snapshot.sidebarWidth || 240
      })
    } catch (err) {
      console.error('[Main] Failed to save session state:', err)
    }
    agentManager.stopAgent()
    terminalManager.destroy()
    browserManager.destroy()
    mainWindow?.destroy()
  })

  mainWindow.on('close', (e) => {
    if (isClosing) return
    e.preventDefault()
    isClosing = true

    // Ask renderer for UI snapshot
    try {
      mainWindow?.webContents.send('app:before-close')
    } catch {
      // If send fails, just destroy
    }

    // Timeout fallback: if renderer doesn't respond in 300ms, save defaults and destroy
    setTimeout(() => {
      if (!mainWindow) return
      try {
        const sessions: Array<{ id: string; claudeSessionId?: string; projectPath: string; name: string; createdAt: number; lastActiveAt: number }> = []
        for (const projPath of projectManager.getRecentPaths()) {
          const terms = terminalManager.list(projPath)
          for (const t of terms) {
            const claudeSessionId = terminalManager.getClaudeSessionId(t.id)
            if (claudeSessionId) {
              const createdAt = terminalManager.getCreatedAt(t.id)
              sessionPersistence.addToHistory({
                id: t.id,
                claudeSessionId,
                projectPath: t.projectPath,
                name: terminalManager.getTerminalName(t.id) || 'Claude Code',
                createdAt,
                endedAt: Date.now()
              })
              sessions.push({
                id: t.id,
                claudeSessionId,
                projectPath: t.projectPath,
                name: terminalManager.getTerminalName(t.id) || 'Claude Code',
                createdAt,
                lastActiveAt: Date.now()
              })
            }
          }
        }
        sessionPersistence.saveState({
          version: 1,
          activeProjectPath: null,
          expandedProjects: [],
          sessions,
          theme: 'dark',
          sidebarWidth: 240
        })
      } catch (err) {
        console.error('[Main] Failed to save session state on timeout:', err)
      }
      agentManager.stopAgent()
      terminalManager.destroy()
      browserManager.destroy()
      mainWindow?.destroy()
    }, 300)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  // Permission handling: only grant what's needed
  const ALLOWED_PERMISSIONS = new Set(['media', 'clipboard-read', 'clipboard-sanitized-write'])
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission))
  })
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return ALLOWED_PERMISSIONS.has(permission)
  })

  await projectManager.init()
  await settingsManager.init()
  await bridgeServer.start()
  agentManager.setBridgeInfo(bridgeServer.port, bridgeServer.token)
  registerAllHandlers(agentManager, projectManager, browserManager, terminalManager, settingsManager, voiceManager, {
    bridgePort: bridgeServer.port,
    bridgeToken: bridgeServer.token
  }, sessionPersistence, projectConfigManager, sessionFileWatcher)
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  agentManager.stopAgent()
  terminalManager.destroy()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  agentManager.stopAgent()
  terminalManager.destroy()
  voiceManager.destroy()
  bridgeServer.stop()
})
