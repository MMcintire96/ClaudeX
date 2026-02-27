import { app, BrowserWindow, shell, globalShortcut, session, Menu, MenuItem, ipcMain } from 'electron'
import { join } from 'path'
import { AgentManager } from './agent/AgentManager'
import { ProjectManager } from './project/ProjectManager'
import { BrowserManager } from './browser/BrowserManager'
import { TerminalManager } from './terminal/TerminalManager'
import { SettingsManager } from './settings/SettingsManager'
import { VoiceManager } from './voice/VoiceManager'
import { SessionPersistence } from './session/SessionPersistence'
import { ProjectConfigManager } from './project/ProjectConfigManager'
import { ClaudexBridgeServer } from './bridge/ClaudexBridgeServer'
import { registerAllHandlers } from './ipc'
import { WorktreeManager } from './worktree/WorktreeManager'
import { NeovimManager } from './neovim/NeovimManager'
import { addBroadcastWindow, removeBroadcastWindow, markWindowReady } from './broadcast'

// Auto-grant media permissions (Electron has no native permission dialog)
app.commandLine.appendSwitch('use-fake-ui-for-media-stream')

// Enable audio capture on Linux (PulseAudio/PipeWire support for AppImage/sandboxed envs)
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-features', 'PulseAudioInput,WebRTCPipeWireCapturer')
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
}

// In dev mode, use a separate config directory
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
const projectConfigManager = new ProjectConfigManager()
const worktreeManager = new WorktreeManager()
const neovimManager = new NeovimManager()
const bridgeServer = new ClaudexBridgeServer(terminalManager, browserManager)

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
    title: 'ClaudeX',
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true
    },
    ...(isMac
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 15, y: 15 } }
      : { frame: false })
  })

  // Right-click context menu with spell check suggestions
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu()

    // Spell check suggestions
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions) {
        menu.append(new MenuItem({
          label: suggestion,
          click: () => mainWindow?.webContents.replaceMisspelling(suggestion)
        }))
      }
      if (params.dictionarySuggestions.length > 0) {
        menu.append(new MenuItem({ type: 'separator' }))
      }
      menu.append(new MenuItem({
        label: 'Add to Dictionary',
        click: () => mainWindow?.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      }))
      menu.append(new MenuItem({ type: 'separator' }))
    }

    // Standard editing actions for editable fields
    if (params.isEditable) {
      menu.append(new MenuItem({ role: 'cut' }))
      menu.append(new MenuItem({ role: 'copy' }))
      menu.append(new MenuItem({ role: 'paste' }))
      menu.append(new MenuItem({ role: 'selectAll' }))
    } else if (params.selectionText) {
      menu.append(new MenuItem({ role: 'copy' }))
    }

    if (menu.items.length > 0) {
      menu.popup()
    }
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized-changed', true)
    }
  })
  mainWindow.on('unmaximize', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('window:maximized-changed', false)
    }
  })

  agentManager.setMainWindow(mainWindow)
  browserManager.setMainWindow(mainWindow)
  terminalManager.setMainWindow(mainWindow)
  neovimManager.setMainWindow(mainWindow)

  // Prevent the window from navigating away
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
    if (mainWindow && !mainWindow.isDestroyed()) {
      markWindowReady(mainWindow)
      const savedState = sessionPersistence.loadState()
      mainWindow.webContents.send('session:restore', savedState)
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
  ipcMain.on('app:ui-snapshot', (_event, snapshot: { theme: string; sidebarWidth: number; activeProjectPath: string | null; expandedProjects: string[]; sessions?: unknown[] }) => {
    try {
      sessionPersistence.saveState({
        version: 1,
        activeProjectPath: snapshot.activeProjectPath,
        expandedProjects: snapshot.expandedProjects,
        sessions: (snapshot.sessions ?? []) as any[],
        theme: snapshot.theme || 'dark',
        sidebarWidth: snapshot.sidebarWidth || 240
      })
    } catch (err) {
      console.error('[Main] Failed to save session state:', err)
    }
    if (isClosing) {
      agentManager.stopAgent()
      terminalManager.destroy()
      neovimManager.destroy()
      browserManager.destroy()
      mainWindow?.destroy()
    }
  })

  mainWindow.on('close', (e) => {
    if (isClosing) return
    e.preventDefault()
    isClosing = true

    try {
      mainWindow?.webContents.send('app:before-close')
    } catch {
      // If send fails, just destroy
    }

    // Timeout fallback
    setTimeout(() => {
      if (!mainWindow) return
      try {
        sessionPersistence.saveState({
          version: 1,
          activeProjectPath: null,
          expandedProjects: [],
          sessions: [],
          theme: 'dark',
          sidebarWidth: 240
        })
      } catch (err) {
        console.error('[Main] Failed to save session state on timeout:', err)
      }
      agentManager.stopAgent()
      terminalManager.destroy()
      neovimManager.destroy()
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

function createPopoutWindow(terminalId: string, projectPath: string, theme?: string, sessionSnapshot?: unknown): BrowserWindow {
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
      nodeIntegration: false,
      spellcheck: true
    },
    frame: true,
    alwaysOnTop: false,
  })

  // Right-click context menu with spell check suggestions for popout
  popout.webContents.on('context-menu', (_event, params) => {
    const menu = new Menu()

    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions) {
        menu.append(new MenuItem({
          label: suggestion,
          click: () => popout.webContents.replaceMisspelling(suggestion)
        }))
      }
      if (params.dictionarySuggestions.length > 0) {
        menu.append(new MenuItem({ type: 'separator' }))
      }
      menu.append(new MenuItem({
        label: 'Add to Dictionary',
        click: () => popout.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      }))
      menu.append(new MenuItem({ type: 'separator' }))
    }

    if (params.isEditable) {
      menu.append(new MenuItem({ role: 'cut' }))
      menu.append(new MenuItem({ role: 'copy' }))
      menu.append(new MenuItem({ role: 'paste' }))
      menu.append(new MenuItem({ role: 'selectAll' }))
    } else if (params.selectionText) {
      menu.append(new MenuItem({ role: 'copy' }))
    }

    if (menu.items.length > 0) {
      menu.popup()
    }
  })

  popout.webContents.on('will-navigate', (e) => e.preventDefault())
  popout.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  addBroadcastWindow(popout)

  // Send session snapshot to popout once it finishes loading
  popout.webContents.on('did-finish-load', () => {
    if (sessionSnapshot && !popout.isDestroyed()) {
      popout.webContents.send('popout:init', { session: sessionSnapshot })
    }
  })

  popout.on('closed', () => {
    removeBroadcastWindow(popout)
    if (popoutWindow === popout) popoutWindow = null
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('popout:closed')
    }
  })

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

ipcMain.handle('popout:create', (_event, terminalId: string, projectPath: string, theme?: string, sessionSnapshot?: unknown) => {
  createPopoutWindow(terminalId, projectPath, theme, sessionSnapshot)
  return { success: true }
})

ipcMain.handle('popout:close', () => {
  if (popoutWindow && !popoutWindow.isDestroyed()) {
    popoutWindow.close()
  }
  return { success: true }
})

app.whenReady().then(async () => {
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
  agentManager.setSettingsManager(settingsManager)
  agentManager.setNeovimManager(neovimManager)
  registerAllHandlers(agentManager, projectManager, browserManager, terminalManager, settingsManager, voiceManager, {
    bridgePort: bridgeServer.port,
    bridgeToken: bridgeServer.token
  }, sessionPersistence, projectConfigManager, worktreeManager, neovimManager)

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
  neovimManager.destroy()
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  agentManager.stopAgent()
  terminalManager.destroy()
  neovimManager.destroy()
  voiceManager.destroy()
  bridgeServer.stop()
  worktreeManager.cleanupAll().catch(() => {})
})
