import { app, BrowserWindow, shell, globalShortcut, session, Menu, ipcMain, powerSaveBlocker } from 'electron'
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
import { ClaudexBridgeServer } from './bridge/ClaudexBridgeServer'
import { registerAllHandlers } from './ipc'
import { WorktreeManager } from './worktree/WorktreeManager'
import { addBroadcastWindow, removeBroadcastWindow } from './broadcast'

// Auto-grant media permissions (Electron has no native permission dialog)
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')

// Enable audio capture on Linux (PulseAudio/PipeWire support for AppImage/sandboxed envs)
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'PulseAudioInput,WebRTCPipeWireCapturer')
  // Explicitly allow autoplay for audio contexts
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
}

// In dev mode, use a separate config directory so a dev instance
// can run alongside the installed AppImage without conflicts.
// Must run before any constructor that calls app.getPath('userData').
if (!app.isPackaged) {
  app.setName('claudex-dev')
  app.setPath('userData', join(app.getPath('appData'), 'claudex-dev'))
}

const agentManager = new AgentManager()
const projectManager = new ProjectManager()
const browserManager = new BrowserManager()
const terminalManager = new TerminalManager()
const settingsManager = new SettingsManager()
const voiceManager = new VoiceManager()
const sessionPersistence = new SessionPersistence()
const sessionFileWatcher = new SessionFileWatcher()
const projectConfigManager = new ProjectConfigManager()
const worktreeManager = new WorktreeManager()
const bridgeServer = new ClaudexBridgeServer(terminalManager, browserManager)

let mainWindow: BrowserWindow | null = null
let sleepBlockerId: number | null = null

/** Start blocking sleep if not already blocking */
function startSleepBlock(): void {
  if (sleepBlockerId !== null && powerSaveBlocker.isStarted(sleepBlockerId)) return
  sleepBlockerId = powerSaveBlocker.start('prevent-app-suspension')
  console.log('[Main] Sleep prevention started')
}

/** Stop blocking sleep */
function stopSleepBlock(): void {
  if (sleepBlockerId !== null && powerSaveBlocker.isStarted(sleepBlockerId)) {
    powerSaveBlocker.stop(sleepBlockerId)
    console.log('[Main] Sleep prevention stopped')
  }
  sleepBlockerId = null
}

function createWindow(): void {
  // Remove GTK/native menu bar
  Menu.setApplicationMenu(null)

  const isMac = process.platform === 'darwin'

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'ClaudeX',
    icon: join(__dirname, '../../resources/icon.png'),
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
  terminalManager.setSettingsManager(settingsManager)
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
      const sessions: Array<{ id: string; claudeSessionId?: string; projectPath: string; name: string; createdAt: number; lastActiveAt: number; worktreePath?: string | null; isWorktree?: boolean; worktreeSessionId?: string | null }> = []
      const allTerms = terminalManager.listAll()
      for (const t of allTerms) {
        const claudeSessionId = terminalManager.getClaudeSessionId(t.id)
        if (claudeSessionId) {
          // Only persist sessions that had user interaction
          const entries = sessionFileWatcher.readAll(claudeSessionId, t.projectPath)
          const hasUserMessage = entries.some(e => e.type === 'user')
          if (!hasUserMessage) continue

          const createdAt = terminalManager.getCreatedAt(t.id)
          const wtInfo = worktreeManager.getByWorktreePath(t.projectPath)
          const originalProjectPath = wtInfo ? wtInfo.projectPath : t.projectPath
          sessionPersistence.addToHistory({
            id: t.id,
            claudeSessionId,
            projectPath: originalProjectPath,
            name: terminalManager.getTerminalName(t.id) || 'Claude Code',
            createdAt,
            endedAt: Date.now(),
            worktreePath: wtInfo ? t.projectPath : null,
            isWorktree: !!wtInfo
          })
          sessions.push({
            id: t.id,
            claudeSessionId,
            projectPath: originalProjectPath,
            name: terminalManager.getTerminalName(t.id) || 'Claude Code',
            createdAt,
            lastActiveAt: Date.now(),
            worktreePath: wtInfo ? t.projectPath : null,
            isWorktree: !!wtInfo,
            worktreeSessionId: wtInfo ? wtInfo.sessionId : null
          })
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
        const sessions: Array<{ id: string; claudeSessionId?: string; projectPath: string; name: string; createdAt: number; lastActiveAt: number; worktreePath?: string | null; isWorktree?: boolean; worktreeSessionId?: string | null }> = []
        const allTerms = terminalManager.listAll()
        for (const t of allTerms) {
          const claudeSessionId = terminalManager.getClaudeSessionId(t.id)
          if (claudeSessionId) {
            const entries = sessionFileWatcher.readAll(claudeSessionId, t.projectPath)
            const hasUserMessage = entries.some(e => e.type === 'user')
            if (!hasUserMessage) continue

            const createdAt = terminalManager.getCreatedAt(t.id)
            const wtInfo = worktreeManager.getByWorktreePath(t.projectPath)
            const originalProjectPath = wtInfo ? wtInfo.projectPath : t.projectPath
            sessionPersistence.addToHistory({
              id: t.id,
              claudeSessionId,
              projectPath: originalProjectPath,
              name: terminalManager.getTerminalName(t.id) || 'Claude Code',
              createdAt,
              endedAt: Date.now(),
              worktreePath: wtInfo ? t.projectPath : null,
              isWorktree: !!wtInfo
            })
            sessions.push({
              id: t.id,
              claudeSessionId,
              projectPath: originalProjectPath,
              name: terminalManager.getTerminalName(t.id) || 'Claude Code',
              createdAt,
              lastActiveAt: Date.now(),
              worktreePath: wtInfo ? t.projectPath : null,
              isWorktree: !!wtInfo,
              worktreeSessionId: wtInfo ? wtInfo.sessionId : null
            })
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

// Popout chat window management
let popoutWindow: BrowserWindow | null = null

function createPopoutWindow(terminalId: string, projectPath: string, theme?: string): BrowserWindow {
  // Close existing popout if any
  if (popoutWindow && !popoutWindow.isDestroyed()) {
    popoutWindow.close()
  }

  const popout = new BrowserWindow({
    width: 480,
    height: 650,
    minWidth: 360,
    minHeight: 300,
    title: 'Chat',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    },
    frame: true,
    alwaysOnTop: false,
  })

  // Prevent navigation away
  popout.webContents.on('will-navigate', (e) => e.preventDefault())
  popout.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Register for broadcast
  addBroadcastWindow(popout)

  popout.on('closed', () => {
    removeBroadcastWindow(popout)
    if (popoutWindow === popout) popoutWindow = null
    // Notify main window that popout was closed
    mainWindow?.webContents.send('popout:closed')
  })

  // Load renderer with popout query params
  const params = `?popout=true&terminalId=${encodeURIComponent(terminalId)}&projectPath=${encodeURIComponent(projectPath)}${theme ? `&theme=${encodeURIComponent(theme)}` : ''}`
  if (process.env['ELECTRON_RENDERER_URL']) {
    popout.loadURL(process.env['ELECTRON_RENDERER_URL'] + params)
  } else {
    popout.loadFile(join(__dirname, '../renderer/index.html'), {
      search: params
    })
  }

  popoutWindow = popout
  return popout
}

ipcMain.handle('popout:create', (_event, terminalId: string, projectPath: string, theme?: string) => {
  createPopoutWindow(terminalId, projectPath, theme)
  return { success: true }
})

ipcMain.handle('popout:close', () => {
  if (popoutWindow && !popoutWindow.isDestroyed()) {
    popoutWindow.close()
  }
  return { success: true }
})

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
  await terminalManager.init()
  await bridgeServer.start()
  agentManager.setBridgeInfo(bridgeServer.port, bridgeServer.token)
  registerAllHandlers(agentManager, projectManager, browserManager, terminalManager, settingsManager, voiceManager, {
    bridgePort: bridgeServer.port,
    bridgeToken: bridgeServer.token
  }, sessionPersistence, projectConfigManager, sessionFileWatcher, worktreeManager)

  // Sleep prevention: listen for Claude terminal status changes
  // Track which terminals are actively running Claude
  const runningClaudeTerminals = new Set<string>()
  ipcMain.on('__claude-status-internal', (_event, id: string, status: string) => {
    if (status === 'running') {
      runningClaudeTerminals.add(id)
    } else {
      runningClaudeTerminals.delete(id)
    }
    const settings = settingsManager.get()
    if (settings.preventSleep && runningClaudeTerminals.size > 0) {
      startSleepBlock()
    } else {
      stopSleepBlock()
    }
  })
  // Hook into the terminal manager's status emissions
  terminalManager.onClaudeStatusChange((id: string, status: string) => {
    ipcMain.emit('__claude-status-internal', {}, id, status)
  })

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
  stopSleepBlock()
  agentManager.stopAgent()
  terminalManager.destroy()
  voiceManager.destroy()
  bridgeServer.stop()
  worktreeManager.cleanupAll().catch(() => {})
})
