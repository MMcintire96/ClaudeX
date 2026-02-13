import { app, BrowserWindow, shell, globalShortcut } from 'electron'
import { join } from 'path'
import { AgentManager } from './agent/AgentManager'
import { ProjectManager } from './project/ProjectManager'
import { BrowserManager } from './browser/BrowserManager'
import { TerminalManager } from './terminal/TerminalManager'
import { registerAllHandlers } from './ipc'

const agentManager = new AgentManager()
const projectManager = new ProjectManager()
const browserManager = new BrowserManager()
const terminalManager = new TerminalManager()

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
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
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 }
  })

  agentManager.setMainWindow(mainWindow)
  browserManager.setMainWindow(mainWindow)
  terminalManager.setMainWindow(mainWindow)

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // Load the renderer
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    agentManager.stopAgent()
    browserManager.destroy()
    terminalManager.destroy()
  })
}

app.whenReady().then(async () => {
  await projectManager.init()
  registerAllHandlers(agentManager, projectManager, browserManager, terminalManager)
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
})
