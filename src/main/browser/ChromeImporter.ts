import { existsSync, readdirSync, readFileSync, writeFileSync, cpSync, rmSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFileSync, spawn } from 'child_process'
import { session, app } from 'electron'
import { get as httpGet } from 'http'
import { pbkdf2Sync, createDecipheriv } from 'crypto'

const log = (...args: unknown[]) => console.log('[ChromeImporter]', ...args)
const logError = (...args: unknown[]) => console.error('[ChromeImporter]', ...args)

export interface ChromeProfile {
  name: string
  path: string
  displayName: string
  basePath: string // The chrome config dir (parent of profile dir)
}

export interface ImportProgress {
  phase: 'detecting' | 'reading' | 'decrypting' | 'importing' | 'done' | 'error'
  total: number
  current: number
  message: string
}

export interface ImportResult {
  success: boolean
  imported: number
  failed: number
  skipped: number
  historyImported: number
  passwordsImported: number
  errors: string[]
}

interface CDPCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  secure: boolean
  httpOnly: boolean
  session: boolean
  priority: string
  sourceScheme: string
  sourcePort: number
}

interface HistoryEntry {
  url: string
  title: string
  visitCount: number
  lastVisitTime: number
}

interface SavedPassword {
  url: string
  username: string
  password: string
}

const CHROME_DIR = join(process.env.HOME ?? '~', '.config', 'google-chrome')
const CHROMIUM_DIR = join(process.env.HOME ?? '~', '.config', 'chromium')

function findChromeBinary(): string | null {
  const candidates = [
    'google-chrome-stable',
    'google-chrome',
    'chromium-browser',
    'chromium'
  ]
  for (const bin of candidates) {
    try {
      const path = execFileSync('which', [bin], { encoding: 'utf-8', timeout: 3000 }).trim()
      if (path) return path
    } catch { /* not found */ }
  }
  // Check common paths
  const paths = ['/opt/google/chrome/chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium']
  for (const p of paths) {
    if (existsSync(p)) return p
  }
  return null
}

export function detectChromeProfiles(): ChromeProfile[] {
  log('Detecting Chrome profiles...')
  const profiles: ChromeProfile[] = []

  for (const baseDir of [CHROME_DIR, CHROMIUM_DIR]) {
    log('Checking:', baseDir, 'exists:', existsSync(baseDir))
    if (!existsSync(baseDir)) continue

    const entries = readdirSync(baseDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name !== 'Default' && !entry.name.startsWith('Profile ')) continue

      const profilePath = join(baseDir, entry.name)
      const cookiesPath = join(profilePath, 'Cookies')
      if (!existsSync(cookiesPath)) {
        log('No Cookies file in:', profilePath)
        continue
      }

      let displayName = entry.name
      try {
        const prefsPath = join(profilePath, 'Preferences')
        if (existsSync(prefsPath)) {
          const prefs = JSON.parse(readFileSync(prefsPath, 'utf-8'))
          if (prefs?.profile?.name) {
            displayName = prefs.profile.name
          }
        }
      } catch {
        // ignore prefs parse errors
      }

      const browserLabel = baseDir === CHROME_DIR ? 'Chrome' : 'Chromium'
      profiles.push({
        name: entry.name,
        path: profilePath,
        displayName: `${displayName} (${browserLabel})`,
        basePath: baseDir
      })
      log('Found profile:', displayName, 'at', profilePath)
    }
  }

  log('Total profiles found:', profiles.length)
  return profiles
}

function httpGetJSON(url: string): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = httpGet(url, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        try { resolve(JSON.parse(data)) }
        catch (e) { reject(new Error(`Failed to parse JSON from ${url}`)) }
      })
    })
    req.on('error', reject)
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('HTTP timeout')) })
  })
}

function sendCDP(wsUrl: string, method: string, params?: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    // Use Node.js built-in WebSocket (available in Node 22+/Electron)
    const ws = new (globalThis as any).WebSocket(wsUrl)
    const timeout = setTimeout(() => { ws.close(); reject(new Error('CDP timeout')) }, 15000)

    ws.onopen = () => {
      ws.send(JSON.stringify({ id: 1, method, params }))
    }
    ws.onmessage = (event: any) => {
      clearTimeout(timeout)
      try {
        const data = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString())
        ws.close()
        if (data.error) {
          reject(new Error(`CDP error: ${data.error.message}`))
        } else {
          resolve(data.result)
        }
      } catch (e) {
        ws.close()
        reject(e)
      }
    }
    ws.onerror = (err: any) => {
      clearTimeout(timeout)
      reject(new Error(`WebSocket error: ${err.message ?? err}`))
    }
  })
}

function mapCDPSameSite(priority: string): 'unspecified' | 'no_restriction' | 'lax' | 'strict' {
  switch (priority?.toLowerCase()) {
    case 'lax': return 'lax'
    case 'strict': return 'strict'
    case 'none': return 'no_restriction'
    default: return 'unspecified'
  }
}

function readHistoryFromProfile(profileDir: string, originalProfileDir?: string): HistoryEntry[] {
  const historyPath = join(profileDir, 'History')
  const originalHistoryPath = originalProfileDir ? join(originalProfileDir, 'History') : null

  log('readHistoryFromProfile profileDir:', profileDir)
  log('History file exists:', existsSync(historyPath))
  if (originalHistoryPath) log('Original History exists:', existsSync(originalHistoryPath))

  // Prefer the copied file (unlocked); fall back to original via .backup
  let queryPath: string | null = null

  if (existsSync(historyPath)) {
    queryPath = historyPath
  } else if (originalHistoryPath && existsSync(originalHistoryPath)) {
    // Original may be locked by running Chrome — use .backup to get a clean copy
    const backupPath = join(profileDir, 'History-backup')
    try {
      execFileSync('sqlite3', [
        originalHistoryPath,
        `.backup '${backupPath}'`
      ], { encoding: 'utf-8', timeout: 10000 })
      queryPath = backupPath
      log('Created History backup from locked original')
    } catch (err) {
      logError('Cannot access History:', (err as Error).message)
      return []
    }
  } else {
    log('No History file found')
    return []
  }

  log('Querying History DB at:', queryPath)

  try {
    const output = execFileSync('sqlite3', [
      '-json',
      queryPath,
      'SELECT url, title, visit_count, last_visit_time FROM urls ORDER BY last_visit_time DESC LIMIT 5000'
    ], { encoding: 'utf-8', timeout: 10000, maxBuffer: 50 * 1024 * 1024 })

    log('sqlite3 output length:', output.length, 'first 200 chars:', output.slice(0, 200))

    if (!output.trim()) {
      log('sqlite3 returned empty output')
      return []
    }

    const rows = JSON.parse(output) as Array<{
      url: string
      title: string
      visit_count: number
      last_visit_time: number
    }>

    const chromeEpochOffsetMs = 11644473600000
    const entries: HistoryEntry[] = rows.map((row) => ({
      url: row.url,
      title: row.title || '',
      visitCount: row.visit_count || 0,
      lastVisitTime: Math.floor((row.last_visit_time || 0) / 1000) - chromeEpochOffsetMs
    }))

    log(`Read ${entries.length} history entries`)
    return entries
  } catch (err) {
    logError('Failed to read history:', (err as Error).message)
    if (err instanceof Error && err.stack) logError('Stack:', err.stack)
    // Log stderr if available from execFileSync
    const execErr = err as { stderr?: string; stdout?: string; status?: number }
    if (execErr.stderr) logError('sqlite3 stderr:', execErr.stderr)
    if (execErr.stdout) log('sqlite3 stdout:', execErr.stdout)
    if (execErr.status !== undefined) log('sqlite3 exit code:', execErr.status)
    return []
  }
}

function getChromeEncryptionKeys(): Buffer[] {
  // Build a list of all possible decryption keys to try
  // Passwords may be encrypted with different keys depending on when they were saved
  const keys: Buffer[] = []
  const keyNames: string[] = []

  // Always include the "peanuts" fallback — Chrome uses this when no keyring was available
  keys.push(pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1'))
  keyNames.push('peanuts')

  // Try keyring keys
  const lookups: Array<{ schema: string; app: string; label: string }> = [
    { schema: 'chrome_libsecret_os_crypt_password_v2', app: 'chrome', label: 'Chrome v2' },
    { schema: 'chrome_libsecret_os_crypt_password_v1', app: 'chrome', label: 'Chrome v1' },
    { schema: 'chrome_libsecret_os_crypt_password_v2', app: 'chromium', label: 'Chromium v2' },
    { schema: 'chrome_libsecret_os_crypt_password_v1', app: 'chromium', label: 'Chromium v1' },
  ]

  for (const { schema, app, label } of lookups) {
    try {
      const keyStr = execFileSync('secret-tool', [
        'lookup', 'xdg:schema', schema, 'application', app
      ], { encoding: 'utf-8', timeout: 5000 }).trim()
      if (keyStr) {
        keys.push(pbkdf2Sync(keyStr, 'saltysalt', 1, 16, 'sha1'))
        keyNames.push(label)
      }
    } catch { /* not found */ }
  }

  log(`Loaded ${keys.length} encryption keys: ${keyNames.join(', ')}`)
  return keys
}

function decryptChromePassword(encryptedBuf: Buffer, keys: Buffer[]): string {
  // Chrome on Linux: v10/v11 prefix (3 bytes) + AES-128-CBC encrypted data
  // IV is 16 bytes of 0x20 (space character)
  if (encryptedBuf.length < 4) return ''

  const prefix = encryptedBuf.subarray(0, 3).toString('utf-8')
  if (prefix !== 'v10' && prefix !== 'v11') {
    // Unencrypted or unknown format
    return encryptedBuf.toString('utf-8')
  }

  const encrypted = encryptedBuf.subarray(3)
  const iv = Buffer.alloc(16, 0x20) // 16 spaces

  // Try each key until one works
  for (const key of keys) {
    try {
      const decipher = createDecipheriv('aes-128-cbc', key, iv)
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
      return decrypted.toString('utf-8')
    } catch {
      // Wrong key, try next
    }
  }
  return ''
}

function readPasswordsFromProfile(profileDir: string): SavedPassword[] {
  const loginDataPath = join(profileDir, 'Login Data')
  if (!existsSync(loginDataPath)) {
    log('No Login Data file found in', profileDir)
    return []
  }

  log('Reading passwords from Login Data...')
  const keys = getChromeEncryptionKeys()

  try {
    // Query Login Data for saved credentials (get password as hex blob)
    const output = execFileSync('sqlite3', [
      '-json',
      loginDataPath,
      "SELECT origin_url, username_value, hex(password_value) as password_hex FROM logins WHERE username_value != '' AND password_value != ''"
    ], { encoding: 'utf-8', timeout: 10000, maxBuffer: 50 * 1024 * 1024 })

    if (!output.trim()) {
      log('No saved passwords found')
      return []
    }

    const rows = JSON.parse(output) as Array<{
      origin_url: string
      username_value: string
      password_hex: string
    }>

    const passwords: SavedPassword[] = []
    let decrypted = 0
    let failed = 0

    for (const row of rows) {
      const encryptedBuf = Buffer.from(row.password_hex, 'hex')
      const password = decryptChromePassword(encryptedBuf, keys)

      if (password) {
        passwords.push({
          url: row.origin_url,
          username: row.username_value,
          password
        })
        decrypted++
      } else {
        // Still store without password for username autofill
        passwords.push({
          url: row.origin_url,
          username: row.username_value,
          password: ''
        })
        failed++
      }
    }

    log(`Extracted ${passwords.length} passwords (${decrypted} decrypted, ${failed} failed)`)
    return passwords
  } catch (err) {
    logError('Failed to read passwords:', (err as Error).message)
    return []
  }
}

class CDPSession {
  private ws: any
  private msgId = 0
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
  private ready: Promise<void>

  constructor(wsUrl: string) {
    this.ws = new (globalThis as any).WebSocket(wsUrl)
    this.ready = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CDP session connect timeout')), 10000)
      this.ws.onopen = () => { clearTimeout(timeout); resolve() }
      this.ws.onerror = (err: any) => { clearTimeout(timeout); reject(new Error(`WS error: ${err.message ?? err}`)) }
    })
    this.ws.onmessage = (event: any) => {
      try {
        const data = JSON.parse(typeof event.data === 'string' ? event.data : event.data.toString())
        if (data.id !== undefined && this.pending.has(data.id)) {
          const p = this.pending.get(data.id)!
          this.pending.delete(data.id)
          if (data.error) p.reject(new Error(`CDP: ${data.error.message}`))
          else p.resolve(data.result)
        }
      } catch { /* ignore */ }
    }
  }

  async send(method: string, params?: Record<string, unknown>): Promise<any> {
    await this.ready
    const id = ++this.msgId
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 15000)
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timeout); resolve(v) },
        reject: (e) => { clearTimeout(timeout); reject(e) }
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  close(): void {
    try { this.ws.close() } catch { /* ignore */ }
  }
}

async function extractPasswordsViaCDP(port: number): Promise<SavedPassword[]> {
  log('Attempting password extraction via CDP...')

  try {
    // Create a new tab navigating to the password manager page
    const pwUrl = encodeURIComponent('chrome://password-manager/passwords')
    const newTab = await httpGetJSON(`http://localhost:${port}/json/new?${pwUrl}`)

    if (!newTab?.webSocketDebuggerUrl) {
      log('Failed to create password manager tab')
      return []
    }

    const cdp = new CDPSession(newTab.webSocketDebuggerUrl)

    try {
      await cdp.send('Page.enable')
      await cdp.send('Runtime.enable')

      // Wait for password manager page to load
      await new Promise(r => setTimeout(r, 3000))

      // Check if chrome.passwordsPrivate is available
      const check = await cdp.send('Runtime.evaluate', {
        expression: 'typeof chrome !== "undefined" && typeof chrome.passwordsPrivate !== "undefined"',
        returnByValue: true
      })

      if (!check?.result?.value) {
        log('chrome.passwordsPrivate not available — cannot extract passwords')
        return []
      }

      log('chrome.passwordsPrivate available, getting password list...')

      // Get saved password list
      const listResult = await cdp.send('Runtime.evaluate', {
        expression: `
          (async () => {
            try {
              const list = await chrome.passwordsPrivate.getSavedPasswordList();
              return JSON.stringify(list.map(e => ({
                id: e.id,
                origin: e.urls?.origin || e.urls?.shown || '',
                username: e.username || ''
              })));
            } catch (e) {
              return JSON.stringify({ error: e.message });
            }
          })()
        `,
        awaitPromise: true,
        returnByValue: true
      })

      const listStr = listResult?.result?.value
      if (!listStr) { log('No result from getSavedPasswordList'); return [] }

      const parsed = JSON.parse(listStr)
      if (parsed.error) { logError('getSavedPasswordList error:', parsed.error); return [] }

      log(`Found ${parsed.length} saved password entries, attempting plaintext extraction...`)

      const passwords: SavedPassword[] = []
      let plaintextFailed = 0

      for (const entry of parsed) {
        try {
          const pwResult = await cdp.send('Runtime.evaluate', {
            expression: `
              (async () => {
                try {
                  return await chrome.passwordsPrivate.requestPlaintextPassword(
                    ${entry.id},
                    chrome.passwordsPrivate.PlaintextReason.VIEW
                  );
                } catch { return null; }
              })()
            `,
            awaitPromise: true,
            returnByValue: true
          })

          const plaintext = pwResult?.result?.value
          if (plaintext) {
            passwords.push({ url: entry.origin, username: entry.username, password: plaintext })
          } else {
            plaintextFailed++
            // Save without password for autofill username hint
            if (entry.username) {
              passwords.push({ url: entry.origin, username: entry.username, password: '' })
            }
          }
        } catch {
          plaintextFailed++
        }

        // If first few all fail, plaintext isn't available in headless — save rest as username-only
        if (plaintextFailed >= 3 && passwords.filter(p => p.password).length === 0) {
          log('Plaintext extraction unavailable in headless mode, saving URLs + usernames only')
          for (const remaining of parsed.slice(parsed.indexOf(entry) + 1)) {
            if (remaining.username) {
              passwords.push({ url: remaining.origin, username: remaining.username, password: '' })
            }
          }
          break
        }
      }

      const withPw = passwords.filter(p => p.password).length
      log(`Extracted ${passwords.length} passwords (${withPw} with plaintext, ${passwords.length - withPw} username-only)`)
      return passwords
    } finally {
      cdp.close()
    }
  } catch (err) {
    logError('Password extraction failed:', (err as Error).message)
    return []
  }
}

export async function importChromeProfile(
  profilePath: string,
  onProgress?: (progress: ImportProgress) => void
): Promise<ImportResult> {
  log('=== Starting Chrome import from:', profilePath, '===')

  const chromeBin = findChromeBinary()
  if (!chromeBin) {
    logError('Chrome binary not found')
    return { success: false, imported: 0, failed: 0, skipped: 0, historyImported: 0, passwordsImported: 0, errors: ['Chrome binary not found'] }
  }
  log('Using Chrome binary:', chromeBin)

  // Determine the base config dir from the profile path
  const profileName = profilePath.split('/').pop() ?? 'Default'
  const basePath = join(profilePath, '..')

  // Copy profile to temp dir so we don't conflict with the running Chrome
  const tempDir = mkdtempSync(join(tmpdir(), 'claudex-chrome-import-'))
  log('Temp dir:', tempDir)

  try {
    onProgress?.({ phase: 'reading', total: 0, current: 0, message: 'Copying Chrome profile...' })

    // Copy the specific profile directory and Local State
    cpSync(profilePath, join(tempDir, profileName), { recursive: true })
    const localStatePath = join(basePath, 'Local State')
    if (existsSync(localStatePath)) {
      cpSync(localStatePath, join(tempDir, 'Local State'))
    }
    // Remove lock files
    for (const lockFile of ['lock', 'LOCK', 'SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      try { rmSync(join(tempDir, lockFile), { force: true }) } catch { /* ignore */ }
      try { rmSync(join(tempDir, profileName, lockFile), { force: true }) } catch { /* ignore */ }
    }
    log('Profile copied')

    // Read history and passwords NOW, before headless Chrome locks the copied DBs
    onProgress?.({ phase: 'reading', total: 0, current: 0, message: 'Reading browsing history...' })
    const profileCopyDir = join(tempDir, profileName)
    const historyEntries = readHistoryFromProfile(profileCopyDir, profilePath)

    onProgress?.({ phase: 'reading', total: 0, current: 0, message: 'Extracting saved passwords...' })
    const savedPasswords = readPasswordsFromProfile(profileCopyDir)

    // Launch headless Chrome with the copied profile
    const port = 9300 + Math.floor(Math.random() * 100)
    onProgress?.({ phase: 'reading', total: 0, current: 0, message: 'Starting headless Chrome...' })

    const chromeArgs = [
      '--headless=new',
      `--remote-debugging-port=${port}`,
      '--remote-allow-origins=*',
      '--no-first-run',
      '--disable-gpu',
      '--disable-software-rasterizer',
      `--user-data-dir=${tempDir}`,
      `--profile-directory=${profileName}`
    ]
    log('Launching:', chromeBin, chromeArgs.join(' '))

    const chrome = spawn(chromeBin, chromeArgs, {
      stdio: 'ignore',
      detached: true
    })
    chrome.unref()

    // Wait for Chrome to be ready
    let ready = false
    for (let attempt = 0; attempt < 20; attempt++) {
      await new Promise(r => setTimeout(r, 500))
      try {
        await httpGetJSON(`http://localhost:${port}/json/version`)
        ready = true
        break
      } catch { /* not ready yet */ }
    }

    if (!ready) {
      chrome.kill()
      throw new Error('Headless Chrome failed to start')
    }
    log('Headless Chrome ready on port', port)

    // Extract cookies via CDP
    onProgress?.({ phase: 'reading', total: 0, current: 0, message: 'Extracting cookies from Chrome...' })

    const version = await httpGetJSON(`http://localhost:${port}/json/version`)
    const wsUrl = version.webSocketDebuggerUrl
    log('CDP WebSocket:', wsUrl)

    const result = await sendCDP(wsUrl, 'Storage.getCookies')
    const cdpCookies: CDPCookie[] = result?.cookies ?? []
    log('Got', cdpCookies.length, 'cookies from CDP')

    if (cdpCookies.length === 0) {
      log('No cookies found in Chrome profile')
    }

    // Now kill headless Chrome
    chrome.kill()

    // Import cookies into Electron's persistent browser session
    onProgress?.({ phase: 'importing', total: cdpCookies.length, current: 0, message: 'Importing cookies...' })

    const browserSession = session.fromPartition('persist:browser')
    const now = Math.floor(Date.now() / 1000)
    let imported = 0
    let failed = 0
    let skipped = 0
    let loggedErrors = 0

    const BATCH_SIZE = 50
    for (let i = 0; i < cdpCookies.length; i += BATCH_SIZE) {
      const batch = cdpCookies.slice(i, i + BATCH_SIZE)
      const promises = batch.map(async (cookie) => {
        try {
          // Skip session cookies with no value
          if (!cookie.value) { skipped++; return }

          // Skip expired cookies
          if (cookie.expires > 0 && cookie.expires < now) { skipped++; return }

          const scheme = cookie.secure ? 'https' : 'http'
          const host = cookie.domain.startsWith('.') ? cookie.domain.slice(1) : cookie.domain
          const url = `${scheme}://${host}${cookie.path}`

          const cookieDetails: Electron.CookiesSetDetails = {
            url,
            name: cookie.name,
            value: cookie.value,
            path: cookie.path,
            secure: cookie.secure,
            httpOnly: cookie.httpOnly,
            sameSite: 'no_restriction',
            ...(cookie.expires > 0 ? { expirationDate: cookie.expires } : {})
          }

          if (cookie.domain.startsWith('.')) {
            cookieDetails.domain = cookie.domain
          }

          await browserSession.cookies.set(cookieDetails)
          imported++
        } catch (err) {
          if (loggedErrors < 5) {
            logError('Failed to set cookie:', cookie.domain, cookie.name, '-', (err as Error).message)
            loggedErrors++
          }
          failed++
        }
      })

      await Promise.all(promises)

      if (i % 500 === 0 || i + BATCH_SIZE >= cdpCookies.length) {
        log(`Progress: ${Math.min(i + BATCH_SIZE, cdpCookies.length)}/${cdpCookies.length} (imported: ${imported}, failed: ${failed}, skipped: ${skipped})`)
      }

      onProgress?.({
        phase: 'importing',
        total: cdpCookies.length,
        current: Math.min(i + BATCH_SIZE, cdpCookies.length),
        message: `Imported ${imported} cookies...`
      })
    }

    // Save browsing history (already read before headless Chrome launch)
    let historyImported = 0
    if (historyEntries.length > 0) {
      try {
        const historyFile = join(app.getPath('userData'), 'imported-browser-history.json')
        writeFileSync(historyFile, JSON.stringify(historyEntries))
        historyImported = historyEntries.length
        log(`Saved ${historyImported} history entries to ${historyFile}`)
      } catch (err) {
        logError('Failed to save history:', (err as Error).message)
      }
    }

    // Save passwords (already extracted before headless Chrome launch)
    let passwordsImported = 0
    if (savedPasswords.length > 0) {
      try {
        const passwordsFile = join(app.getPath('userData'), 'imported-browser-passwords.json')
        writeFileSync(passwordsFile, JSON.stringify(savedPasswords))
        passwordsImported = savedPasswords.filter(p => p.password).length
        log(`Saved ${savedPasswords.length} passwords (${passwordsImported} with credentials) to ${passwordsFile}`)
      } catch (err) {
        logError('Failed to save passwords:', (err as Error).message)
      }
    }

    log(`=== Import complete: cookies=${imported}, failed=${failed}, skipped=${skipped}, history=${historyImported}, passwords=${passwordsImported} ===`)

    onProgress?.({
      phase: 'done',
      total: cdpCookies.length,
      current: cdpCookies.length,
      message: `Done! Imported ${imported} cookies, ${historyImported} history entries, ${passwordsImported} passwords`
    })

    return { success: true, imported, failed, skipped, historyImported, passwordsImported, errors: [] }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    logError('Import failed:', msg)
    if (err instanceof Error && err.stack) logError('Stack:', err.stack)
    onProgress?.({ phase: 'error', total: 0, current: 0, message: `Error: ${msg}` })
    return { success: false, imported: 0, failed: 0, skipped: 0, historyImported: 0, passwordsImported: 0, errors: [msg] }
  } finally {
    // Clean up temp dir
    try { rmSync(tempDir, { recursive: true, force: true }) } catch { /* ignore */ }
    log('Temp dir cleaned up')
  }
}
