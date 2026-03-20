import { BrowserWindow, WebContentsView, Menu, MenuItem, shell, app } from 'electron'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

export interface BrowserBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface TabInfo {
  id: string
  url: string
  title: string
}

interface BrowserTab {
  id: string
  view: WebContentsView
  url: string
  title: string
}

interface ProjectBrowser {
  tabs: BrowserTab[]
  activeTabId: string | null
}

let tabIdCounter = 0
function nextTabId(): string {
  return `tab-${++tabIdCounter}`
}

/**
 * Manages per-project embedded browser views with tab support.
 * Each project gets its own set of tabs. Only the active tab's
 * WebContentsView is shown at a time.
 */
interface SavedPassword {
  url: string
  username: string
  password: string
}

export class BrowserManager {
  private browsers: Map<string, ProjectBrowser> = new Map()
  private mainWindow: BrowserWindow | null = null
  private activeProject: string | null = null
  private pendingBounds: BrowserBounds | null = null
  private visible = false
  private savedPasswords: SavedPassword[] = []

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
    this.loadSavedPasswords()
  }

  loadSavedPasswords(): void {
    try {
      const passwordsFile = join(app.getPath('userData'), 'imported-browser-passwords.json')
      if (existsSync(passwordsFile)) {
        this.savedPasswords = JSON.parse(readFileSync(passwordsFile, 'utf-8'))
        console.log(`[BrowserManager] Loaded ${this.savedPasswords.length} saved passwords`)
      }
    } catch (err) {
      console.error('[BrowserManager] Failed to load passwords:', err)
    }
  }

  private getPasswordsForUrl(pageUrl: string): SavedPassword[] {
    if (!this.savedPasswords.length) return []
    try {
      const pageOrigin = new URL(pageUrl).origin
      return this.savedPasswords.filter(p => {
        try {
          return p.password && new URL(p.url).origin === pageOrigin
        } catch { return false }
      })
    } catch { return [] }
  }

  private injectAutofill(view: WebContentsView, pageUrl: string): void {
    const matches = this.getPasswordsForUrl(pageUrl)
    console.log(`[Autofill] Page: ${pageUrl}, matches: ${matches.length}`)
    if (!matches.length) return

    // Dedupe by username and pass credentials (without logging passwords)
    const uniqueMatches = matches.filter((m, i, arr) =>
      arr.findIndex(a => a.username === m.username) === i
    )
    console.log(`[Autofill] ${uniqueMatches.length} unique credentials for this origin`)

    // Serialize credentials for injection (usernames visible, passwords hidden in closure)
    const credsJson = JSON.stringify(uniqueMatches.map(m => ({
      username: m.username,
      password: m.password,
      url: m.url
    })))

    view.webContents.executeJavaScript(`
      (function() {
        if (window.__claudexAutofillInjected) return;
        window.__claudexAutofillInjected = true;

        const creds = ${credsJson};

        function findFields() {
          const inputs = document.querySelectorAll('input');
          let userField = null;
          let passField = null;
          for (const input of inputs) {
            const type = (input.type || '').toLowerCase();
            if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'checkbox' || type === 'radio') continue;
            const name = ((input.name || '') + ' ' + (input.id || '') + ' ' + (input.autocomplete || '')).toLowerCase();
            if (type === 'password') {
              passField = input;
            } else if (!userField && (type === 'email' || type === 'text' || type === 'tel' ||
              name.includes('user') || name.includes('email') || name.includes('login') ||
              name.includes('account') || input.autocomplete === 'username')) {
              userField = input;
            }
          }
          return { userField, passField };
        }

        function fillCredential(cred) {
          const { userField, passField } = findFields();
          const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          if (!nativeSet) return;
          if (userField) {
            nativeSet.call(userField, cred.username);
            userField.dispatchEvent(new Event('input', {bubbles: true}));
            userField.dispatchEvent(new Event('change', {bubbles: true}));
          }
          if (passField) {
            nativeSet.call(passField, cred.password);
            passField.dispatchEvent(new Event('input', {bubbles: true}));
            passField.dispatchEvent(new Event('change', {bubbles: true}));
          }
        }

        function removePopup() {
          const existing = document.getElementById('__claudex-autofill-popup');
          if (existing) existing.remove();
        }

        function showPopup(anchorField) {
          removePopup();
          const rect = anchorField.getBoundingClientRect();

          const popup = document.createElement('div');
          popup.id = '__claudex-autofill-popup';
          popup.style.cssText = 'position:fixed;z-index:2147483647;background:#1e1e2e;border:1px solid #555;border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,0.4);max-height:200px;overflow-y:auto;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:13px;min-width:' + Math.max(rect.width, 240) + 'px;';
          popup.style.left = rect.left + 'px';
          popup.style.top = (rect.bottom + 4) + 'px';

          // Header
          const header = document.createElement('div');
          header.style.cssText = 'padding:6px 10px;font-size:11px;color:#888;border-bottom:1px solid #333;';
          header.textContent = 'Saved passwords';
          popup.appendChild(header);

          creds.forEach((cred, i) => {
            const item = document.createElement('div');
            item.style.cssText = 'padding:8px 10px;cursor:pointer;display:flex;align-items:center;gap:8px;color:#e0e0e0;';
            item.onmouseenter = () => item.style.background = '#333';
            item.onmouseleave = () => item.style.background = 'none';
            item.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              fillCredential(cred);
              removePopup();
            };

            const icon = document.createElement('div');
            icon.style.cssText = 'width:24px;height:24px;border-radius:50%;background:#444;display:flex;align-items:center;justify-content:center;font-size:12px;color:#aaa;flex-shrink:0;';
            icon.textContent = cred.username.charAt(0).toUpperCase();

            const text = document.createElement('div');
            text.style.cssText = 'overflow:hidden;';
            const user = document.createElement('div');
            user.style.cssText = 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500;';
            user.textContent = cred.username;
            const pw = document.createElement('div');
            pw.style.cssText = 'font-size:11px;color:#888;letter-spacing:2px;';
            pw.textContent = '••••••••';
            text.appendChild(user);
            text.appendChild(pw);

            item.appendChild(icon);
            item.appendChild(text);
            popup.appendChild(item);
          });

          document.body.appendChild(popup);

          // Close on outside click
          setTimeout(() => {
            function closeHandler(e) {
              if (!popup.contains(e.target)) {
                removePopup();
                document.removeEventListener('mousedown', closeHandler, true);
              }
            }
            document.addEventListener('mousedown', closeHandler, true);
          }, 50);
        }

        function attachListeners() {
          const { userField, passField } = findFields();
          if (!userField && !passField) return false;

          const targets = [userField, passField].filter(Boolean);
          targets.forEach(field => {
            if (field.__claudexAutofillBound) return;
            field.__claudexAutofillBound = true;
            field.addEventListener('focus', () => showPopup(field));
            field.addEventListener('click', () => showPopup(field));
          });

          // Auto-show popup on first load if field is empty
          const primary = userField || passField;
          if (primary && !primary.value) {
            setTimeout(() => showPopup(primary), 300);
          }
          return true;
        }

        // Try attaching immediately and with retries for SPAs
        if (!attachListeners()) {
          let retries = 0;
          const interval = setInterval(() => {
            retries++;
            if (attachListeners() || retries > 20) clearInterval(interval);
          }, 500);
        }
      })();
    `).catch((err) => console.error('[Autofill] injection failed:', err))
  }

  /** Send IPC to mainWindow only if it exists and hasn't been destroyed. */
  safeSend(channel: string, ...args: unknown[]): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(channel, ...args)
    }
  }

  private getProjectBrowser(projectPath: string): ProjectBrowser {
    let pb = this.browsers.get(projectPath)
    if (!pb) {
      pb = { tabs: [], activeTabId: null }
      this.browsers.set(projectPath, pb)
    }
    return pb
  }

  private createTab(projectPath: string, url?: string): BrowserTab {
    if (!this.mainWindow) throw new Error('No main window set')

    const pb = this.getProjectBrowser(projectPath)
    const id = nextTabId()

    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        partition: 'persist:browser'
      }
    })

    const tab: BrowserTab = { id, view, url: url ?? '', title: 'New Tab' }

    // Intercept new window requests (target="_blank", window.open) -> open as tab
    view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
      this.createTabAndActivate(projectPath, openUrl)
      return { action: 'deny' }
    })

    view.webContents.on('did-navigate', (_event, navUrl) => {
      tab.url = navUrl
      if (this.activeProject === projectPath && pb.activeTabId === id) {
        this.safeSend('browser:url-changed', navUrl)
      }
      this.sendTabsUpdate(projectPath)
    })

    view.webContents.on('did-finish-load', () => {
      const pageUrl = view.webContents.getURL()
      this.injectAutofill(view, pageUrl)
    })

    view.webContents.on('did-navigate-in-page', (_event, navUrl) => {
      tab.url = navUrl
      if (this.activeProject === projectPath && pb.activeTabId === id) {
        this.safeSend('browser:url-changed', navUrl)
      }
      this.sendTabsUpdate(projectPath)
    })

    view.webContents.on('page-title-updated', (_event, title) => {
      tab.title = title
      if (this.activeProject === projectPath) {
        if (pb.activeTabId === id) {
          this.safeSend('browser:title-changed', title)
        }
        this.sendTabsUpdate(projectPath)
      }
    })

    // Right-click context menu
    view.webContents.on('context-menu', (_event, params) => {
      const menu = new Menu()

      if (params.linkURL) {
        menu.append(new MenuItem({
          label: 'Open Link in New Tab',
          click: () => {
            this.createTabAndActivate(projectPath, params.linkURL)
          }
        }))
        menu.append(new MenuItem({
          label: 'Open Link in Browser',
          click: () => {
            shell.openExternal(params.linkURL)
          }
        }))
        menu.append(new MenuItem({ type: 'separator' }))
      }

      menu.append(new MenuItem({
        label: 'Back',
        enabled: view.webContents.navigationHistory.canGoBack(),
        click: () => view.webContents.navigationHistory.goBack()
      }))
      menu.append(new MenuItem({
        label: 'Forward',
        enabled: view.webContents.navigationHistory.canGoForward(),
        click: () => view.webContents.navigationHistory.goForward()
      }))
      menu.append(new MenuItem({
        label: 'Reload',
        click: () => view.webContents.reload()
      }))
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({ label: 'Copy', role: 'copy' }))
      menu.append(new MenuItem({ label: 'Paste', role: 'paste' }))
      menu.append(new MenuItem({ type: 'separator' }))
      menu.append(new MenuItem({
        label: 'Inspect Element',
        click: () => {
          view.webContents.inspectElement(params.x, params.y)
        }
      }))

      menu.popup()
    })

    pb.tabs.push(tab)
    return tab
  }

  private createTabAndActivate(projectPath: string, url: string): void {
    const tab = this.createTab(projectPath, url)
    const pb = this.getProjectBrowser(projectPath)

    // Hide current tab's view
    this.hideActiveTabView(projectPath)

    pb.activeTabId = tab.id

    // Show new tab
    if (this.visible && this.mainWindow && this.activeProject === projectPath) {
      this.mainWindow.contentView.addChildView(tab.view)
      if (this.pendingBounds) tab.view.setBounds(this.pendingBounds)
    }

    // Navigate
    const normalizedUrl = this.normalizeUrl(url)
    tab.url = normalizedUrl
    tab.view.webContents.loadURL(normalizedUrl).catch(() => {})

    this.sendTabsUpdate(projectPath)
  }

  private hideActiveTabView(projectPath: string): void {
    if (!this.mainWindow) return
    const pb = this.browsers.get(projectPath)
    if (!pb?.activeTabId) return
    const activeTab = pb.tabs.find(t => t.id === pb.activeTabId)
    if (activeTab) {
      try {
        this.mainWindow.contentView.removeChildView(activeTab.view)
      } catch {
        // already removed
      }
    }
  }

  private getActiveTab(): BrowserTab | null {
    if (!this.activeProject) return null
    const pb = this.browsers.get(this.activeProject)
    if (!pb?.activeTabId) return null
    return pb.tabs.find(t => t.id === pb.activeTabId) ?? null
  }

  private sendTabsUpdate(projectPath: string): void {
    if (this.activeProject !== projectPath || !this.mainWindow) return
    const pb = this.browsers.get(projectPath)
    if (!pb) return
    const tabs: TabInfo[] = pb.tabs.map(t => ({ id: t.id, url: t.url, title: t.title }))
    this.safeSend('browser:tabs-updated', tabs, pb.activeTabId)
  }

  private normalizeUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) {
      return url
    } else if (/^localhost(:\d+)?(\/|$)/.test(url)) {
      return 'http://' + url
    } else if (/\.\w{2,}/.test(url) && !/\s/.test(url)) {
      return 'https://' + url
    } else {
      return 'https://www.google.com/search?q=' + encodeURIComponent(url)
    }
  }

  // --- Public API ---

  switchProject(projectPath: string): { url: string; tabs: TabInfo[]; activeTabId: string | null } {
    // Hide current project's active tab
    if (this.activeProject && this.activeProject !== projectPath) {
      this.hideActiveTabView(this.activeProject)
    }

    this.activeProject = projectPath
    const pb = this.getProjectBrowser(projectPath)
    const activeTab = pb.tabs.find(t => t.id === pb.activeTabId)

    if (activeTab && this.visible && this.mainWindow) {
      this.mainWindow.contentView.addChildView(activeTab.view)
      if (this.pendingBounds) activeTab.view.setBounds(this.pendingBounds)
    }

    const tabs: TabInfo[] = pb.tabs.map(t => ({ id: t.id, url: t.url, title: t.title }))
    return { url: activeTab?.url ?? '', tabs, activeTabId: pb.activeTabId }
  }

  setBounds(bounds: BrowserBounds): void {
    this.pendingBounds = bounds
    const tab = this.getActiveTab()
    if (tab) tab.view.setBounds(bounds)
  }

  show(): void {
    this.visible = true
    if (!this.activeProject || !this.mainWindow) return
    const tab = this.getActiveTab()
    if (tab) {
      this.mainWindow.contentView.addChildView(tab.view)
      if (this.pendingBounds) tab.view.setBounds(this.pendingBounds)
    }
  }

  hide(): void {
    this.visible = false
    if (!this.mainWindow || !this.activeProject) return
    this.hideActiveTabView(this.activeProject)
  }

  async navigate(url: string): Promise<void> {
    if (!this.activeProject) return
    const pb = this.getProjectBrowser(this.activeProject)

    // If no tabs exist yet, create one
    if (pb.tabs.length === 0) {
      const tab = this.createTab(this.activeProject)
      pb.activeTabId = tab.id
    }

    const tab = this.getActiveTab()
    if (!tab) return

    const normalizedUrl = this.normalizeUrl(url)
    tab.url = normalizedUrl

    if (this.visible && this.mainWindow) {
      this.mainWindow.contentView.addChildView(tab.view)
      if (this.pendingBounds) tab.view.setBounds(this.pendingBounds)
    }

    await tab.view.webContents.loadURL(normalizedUrl)
    this.sendTabsUpdate(this.activeProject)
  }

  newTab(url?: string): TabInfo | null {
    if (!this.activeProject) return null
    const projectPath = this.activeProject
    if (url) {
      this.createTabAndActivate(projectPath, url)
    } else {
      const tab = this.createTab(projectPath)
      const pb = this.getProjectBrowser(projectPath)
      this.hideActiveTabView(projectPath)
      pb.activeTabId = tab.id
      if (this.visible && this.mainWindow) {
        this.mainWindow.contentView.addChildView(tab.view)
        if (this.pendingBounds) tab.view.setBounds(this.pendingBounds)
      }
      this.sendTabsUpdate(projectPath)
    }
    const pb = this.getProjectBrowser(projectPath)
    const activeTab = pb.tabs.find(t => t.id === pb.activeTabId)
    return activeTab ? { id: activeTab.id, url: activeTab.url, title: activeTab.title } : null
  }

  switchTab(tabId: string): void {
    if (!this.activeProject || !this.mainWindow) return
    const pb = this.getProjectBrowser(this.activeProject)
    const tab = pb.tabs.find(t => t.id === tabId)
    if (!tab || pb.activeTabId === tabId) return

    this.hideActiveTabView(this.activeProject)
    pb.activeTabId = tabId

    if (this.visible) {
      this.mainWindow.contentView.addChildView(tab.view)
      if (this.pendingBounds) tab.view.setBounds(this.pendingBounds)
    }

    this.safeSend('browser:url-changed', tab.url)
    this.safeSend('browser:title-changed', tab.title)
    this.sendTabsUpdate(this.activeProject)
  }

  closeTab(tabId: string): void {
    if (!this.activeProject || !this.mainWindow) return
    const projectPath = this.activeProject
    const pb = this.getProjectBrowser(projectPath)
    const idx = pb.tabs.findIndex(t => t.id === tabId)
    if (idx === -1) return

    const tab = pb.tabs[idx]

    // Remove view if it's the active one
    if (pb.activeTabId === tabId) {
      try {
        this.mainWindow.contentView.removeChildView(tab.view)
      } catch { /* already removed */ }
    }

    // Destroy
    try {
      ;(tab.view.webContents as any)?.close?.()
    } catch { /* ignore */ }
    pb.tabs.splice(idx, 1)

    // Activate adjacent tab
    if (pb.activeTabId === tabId) {
      if (pb.tabs.length > 0) {
        const nextIdx = Math.min(idx, pb.tabs.length - 1)
        pb.activeTabId = pb.tabs[nextIdx].id
        const nextTab = pb.tabs[nextIdx]
        if (this.visible) {
          this.mainWindow.contentView.addChildView(nextTab.view)
          if (this.pendingBounds) nextTab.view.setBounds(this.pendingBounds)
        }
        this.safeSend('browser:url-changed', nextTab.url)
        this.safeSend('browser:title-changed', nextTab.title)
      } else {
        pb.activeTabId = null
        this.safeSend('browser:url-changed', '')
        this.safeSend('browser:title-changed', '')
      }
    }

    this.sendTabsUpdate(projectPath)
  }

  getTabs(): { tabs: TabInfo[]; activeTabId: string | null } {
    if (!this.activeProject) return { tabs: [], activeTabId: null }
    const pb = this.getProjectBrowser(this.activeProject)
    return {
      tabs: pb.tabs.map(t => ({ id: t.id, url: t.url, title: t.title })),
      activeTabId: pb.activeTabId
    }
  }

  goBack(): void {
    this.getActiveTab()?.view.webContents.navigationHistory.goBack()
  }

  goForward(): void {
    this.getActiveTab()?.view.webContents.navigationHistory.goForward()
  }

  reload(): void {
    this.getActiveTab()?.view.webContents.reload()
  }

  openDevTools(): void {
    const tab = this.getActiveTab()
    if (!tab) return
    if (tab.view.webContents.isDevToolsOpened()) {
      tab.view.webContents.closeDevTools()
    } else {
      tab.view.webContents.openDevTools({ mode: 'bottom' })
    }
  }

  getCurrentUrl(): string {
    return this.getActiveTab()?.url ?? ''
  }

  async captureScreenshot(projectPath?: string): Promise<string> {
    const project = projectPath ?? this.activeProject
    if (!project) return ''
    const pb = this.browsers.get(project)
    if (!pb?.activeTabId) return ''
    const tab = pb.tabs.find(t => t.id === pb.activeTabId)
    if (!tab) return ''
    try {
      const image = await tab.view.webContents.capturePage()
      return image.toJPEG(80).toString('base64')
    } catch (err) {
      console.error('[BrowserManager] captureScreenshot failed:', err)
      return ''
    }
  }

  async click(x: number, y: number): Promise<void> {
    const tab = this.getActiveTab()
    if (!tab) throw new Error('No active browser tab')
    tab.view.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
    tab.view.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
  }

  async clickSelector(selector: string): Promise<void> {
    const tab = this.getActiveTab()
    if (!tab) throw new Error('No active browser tab')
    await tab.view.webContents.executeJavaScript(`
      (() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) throw new Error('Element not found: ' + ${JSON.stringify(selector)});
        el.click();
      })()
    `)
  }

  async type(text: string): Promise<void> {
    const tab = this.getActiveTab()
    if (!tab) throw new Error('No active browser tab')
    await tab.view.webContents.insertText(text)
  }

  async getPageContent(projectPath?: string): Promise<string> {
    const project = projectPath ?? this.activeProject
    if (!project) return 'Error: no active browser'
    const pb = this.browsers.get(project)
    if (!pb?.activeTabId) return 'Error: no active tab'
    const tab = pb.tabs.find(t => t.id === pb.activeTabId)
    if (!tab) return 'Error: no active tab'
    try {
      const text: string = await tab.view.webContents.executeJavaScript(
        'document.body.innerText'
      )
      return text.length > 100_000 ? text.slice(0, 100_000) : text
    } catch (err) {
      console.error('[BrowserManager] getPageContent failed:', err)
      return 'Error: could not read page content'
    }
  }

  destroyProject(projectPath: string): void {
    const pb = this.browsers.get(projectPath)
    if (pb) {
      for (const tab of pb.tabs) {
        try {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.contentView.removeChildView(tab.view)
          }
          ;(tab.view.webContents as any)?.close?.()
        } catch { /* ignore */ }
      }
      this.browsers.delete(projectPath)
    }
    if (this.activeProject === projectPath) {
      this.activeProject = null
    }
  }

  destroy(): void {
    for (const [path] of this.browsers) {
      this.destroyProject(path)
    }
    this.visible = false
    this.pendingBounds = null
  }
}
