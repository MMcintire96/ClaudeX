import { BrowserWindow, WebContentsView } from 'electron'

export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

interface ProjectBrowser {
  view: WebContentsView
  currentUrl: string
}

/**
 * Manages per-project embedded browser views (WebContentsView).
 * Each project gets its own browser instance that persists across tab switches.
 * Only the active project's browser is shown at a time.
 */
export class BrowserManager {
  private browsers: Map<string, ProjectBrowser> = new Map()
  private mainWindow: BrowserWindow | null = null
  private activeProject: string | null = null
  private pendingBounds: BrowserBounds | null = null
  private visible = false

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
  }

  private getOrCreateView(projectPath: string): ProjectBrowser {
    let browser = this.browsers.get(projectPath)
    if (browser) return browser

    if (!this.mainWindow) throw new Error('No main window set')

    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true
      }
    })

    view.webContents.on('did-navigate', (_event, url) => {
      const b = this.browsers.get(projectPath)
      if (b) b.currentUrl = url
      if (this.activeProject === projectPath) {
        this.mainWindow?.webContents.send('browser:url-changed', url)
      }
    })

    view.webContents.on('did-navigate-in-page', (_event, url) => {
      const b = this.browsers.get(projectPath)
      if (b) b.currentUrl = url
      if (this.activeProject === projectPath) {
        this.mainWindow?.webContents.send('browser:url-changed', url)
      }
    })

    view.webContents.on('page-title-updated', (_event, title) => {
      if (this.activeProject === projectPath) {
        this.mainWindow?.webContents.send('browser:title-changed', title)
      }
    })

    browser = { view, currentUrl: '' }
    this.browsers.set(projectPath, browser)
    return browser
  }

  private getActiveView(): WebContentsView | null {
    if (!this.activeProject) return null
    return this.browsers.get(this.activeProject)?.view ?? null
  }

  /**
   * Switch to a different project's browser.
   * Hides the old project's view, shows the new one (if visible).
   * Returns the current URL for that project's browser.
   */
  switchProject(projectPath: string): string {
    // Hide current project's view
    if (this.activeProject && this.activeProject !== projectPath) {
      const oldBrowser = this.browsers.get(this.activeProject)
      if (oldBrowser && this.mainWindow) {
        this.mainWindow.contentView.removeChildView(oldBrowser.view)
      }
    }

    this.activeProject = projectPath
    const browser = this.browsers.get(projectPath)

    // If this project has a browser and we're visible, show it
    if (browser && this.visible && this.mainWindow) {
      this.mainWindow.contentView.addChildView(browser.view)
      if (this.pendingBounds) {
        browser.view.setBounds(this.pendingBounds)
      }
    }

    return browser?.currentUrl ?? ''
  }

  /**
   * Store bounds and apply to active view if it exists.
   */
  setBounds(bounds: BrowserBounds): void {
    this.pendingBounds = bounds
    const view = this.getActiveView()
    if (view) {
      view.setBounds(bounds)
    }
  }

  /**
   * Show the active project's browser view.
   */
  show(): void {
    this.visible = true
    if (!this.activeProject || !this.mainWindow) return

    const browser = this.browsers.get(this.activeProject)
    if (browser) {
      this.mainWindow.contentView.addChildView(browser.view)
      if (this.pendingBounds) {
        browser.view.setBounds(this.pendingBounds)
      }
    }
  }

  /**
   * Hide the active project's browser view without destroying it.
   */
  hide(): void {
    this.visible = false
    if (!this.mainWindow) return

    const view = this.getActiveView()
    if (view) {
      this.mainWindow.contentView.removeChildView(view)
    }
  }

  async navigate(url: string): Promise<void> {
    if (!this.activeProject) return
    const browser = this.getOrCreateView(this.activeProject)

    if (!/^https?:\/\//i.test(url)) {
      url = 'https://' + url
    }
    browser.currentUrl = url

    // Ensure view is added if visible
    if (this.visible && this.mainWindow) {
      // Check if already added by trying to add (addChildView is idempotent in newer Electron)
      this.mainWindow.contentView.addChildView(browser.view)
      if (this.pendingBounds) {
        browser.view.setBounds(this.pendingBounds)
      }
    }

    await browser.view.webContents.loadURL(url)
  }

  goBack(): void {
    this.getActiveView()?.webContents.navigationHistory.goBack()
  }

  goForward(): void {
    this.getActiveView()?.webContents.navigationHistory.goForward()
  }

  reload(): void {
    this.getActiveView()?.webContents.reload()
  }

  getCurrentUrl(): string {
    if (!this.activeProject) return ''
    return this.browsers.get(this.activeProject)?.currentUrl ?? ''
  }

  isActive(): boolean {
    return this.getActiveView() !== null && this.visible
  }

  /**
   * Destroy a specific project's browser.
   */
  destroyProject(projectPath: string): void {
    const browser = this.browsers.get(projectPath)
    if (browser && this.mainWindow) {
      this.mainWindow.contentView.removeChildView(browser.view)
      ;(browser.view.webContents as any)?.close?.()
      this.browsers.delete(projectPath)
    }
    if (this.activeProject === projectPath) {
      this.activeProject = null
    }
  }

  /**
   * Destroy all browser views.
   */
  destroy(): void {
    for (const [path] of this.browsers) {
      this.destroyProject(path)
    }
    this.visible = false
    this.pendingBounds = null
  }
}
