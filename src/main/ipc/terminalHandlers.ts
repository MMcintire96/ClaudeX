import { app, ipcMain } from 'electron'
import { join } from 'path'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import { v4 as uuidv4 } from 'uuid'
import { TerminalManager } from '../terminal/TerminalManager'
import { SettingsManager } from '../settings/SettingsManager'
import { SessionPersistence } from '../session/SessionPersistence'
import { findClaudeBinary, getEnhancedEnv } from '../agent/AgentProcess'

export interface BridgeInfo {
  bridgePort: number
  bridgeToken: string
}

const CC_SYSTEM_PROMPT =
  'You are running inside Claude Codex, a desktop IDE. You have MCP tools for the IDE\'s terminal and browser panels. ' +
  'Terminal commands and browser navigation are visible to the user in real-time. ' +
  'Use terminal_execute to run commands and terminal_read to check output. ' +
  'Use browser_navigate, browser_content, and browser_screenshot to interact with web pages. ' +
  'You can communicate with other Claude sessions in the IDE using session_list, session_send, and session_read. ' +
  'Use these to coordinate work, share findings, or delegate tasks between sessions.'

function getMcpServerPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'codex-mcp-server.js')
  }
  return join(app.getAppPath(), 'resources', 'codex-mcp-server.js')
}

// Track temp files for cleanup
const claudeTempFiles = new Map<string, string>()

export function registerTerminalHandlers(
  terminalManager: TerminalManager,
  settingsManager: SettingsManager,
  bridgeInfo?: BridgeInfo,
  sessionPersistence?: SessionPersistence
): void {
  ipcMain.handle('terminal:create', (_event, projectPath: string) => {
    try {
      const info = terminalManager.create(projectPath)
      return { success: true, ...info }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('terminal:create-claude', (_event, projectPath: string) => {
    try {
      const claudePath = findClaudeBinary()
      const terminalId = uuidv4()

      const args: string[] = []

      // Conditionally add --dangerously-skip-permissions based on settings
      const settings = settingsManager.get()
      if (settings.claude.dangerouslySkipPermissions) {
        args.push('--dangerously-skip-permissions')
      }

      let tmpPath: string | null = null

      // Build MCP config if bridge info is available
      if (bridgeInfo && bridgeInfo.bridgePort && bridgeInfo.bridgeToken) {
        const mcpServerPath = getMcpServerPath()
        if (existsSync(mcpServerPath)) {
          const config = {
            mcpServers: {
              'codex-bridge': {
                command: 'node',
                args: [mcpServerPath],
                env: {
                  CODEX_BRIDGE_PORT: String(bridgeInfo.bridgePort),
                  CODEX_BRIDGE_TOKEN: bridgeInfo.bridgeToken,
                  CODEX_PROJECT_PATH: projectPath,
                  CODEX_SESSION_ID: terminalId
                }
              }
            }
          }
          tmpPath = join(
            tmpdir(),
            `codex-cc-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
          )
          writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8')
          args.push('--mcp-config', tmpPath)
          args.push('--strict-mcp-config')
          args.push('--append-system-prompt', CC_SYSTEM_PROMPT)
          claudeTempFiles.set(terminalId, tmpPath)
        }
      }

      // Build enhanced env so claude can find tools
      const enhancedEnv = getEnhancedEnv() as Record<string, string>

      const info = terminalManager.createWithCommand(
        projectPath,
        claudePath,
        args,
        enhancedEnv,
        () => {
          // Cleanup temp file on terminal exit
          if (tmpPath) {
            try { unlinkSync(tmpPath) } catch { /* ignore */ }
            claudeTempFiles.delete(terminalId)
          }
        },
        terminalId
      )

      terminalManager.registerClaudeTerminal(info.id)
      return { success: true, ...info }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('terminal:create-claude-resume', (_event, projectPath: string, claudeSessionId: string, name?: string) => {
    try {
      const claudePath = findClaudeBinary()
      const terminalId = uuidv4()

      const args: string[] = ['--resume', claudeSessionId]

      const settings = settingsManager.get()
      if (settings.claude.dangerouslySkipPermissions) {
        args.push('--dangerously-skip-permissions')
      }

      let tmpPath: string | null = null

      if (bridgeInfo && bridgeInfo.bridgePort && bridgeInfo.bridgeToken) {
        const mcpServerPath = getMcpServerPath()
        if (existsSync(mcpServerPath)) {
          const config = {
            mcpServers: {
              'codex-bridge': {
                command: 'node',
                args: [mcpServerPath],
                env: {
                  CODEX_BRIDGE_PORT: String(bridgeInfo.bridgePort),
                  CODEX_BRIDGE_TOKEN: bridgeInfo.bridgeToken,
                  CODEX_PROJECT_PATH: projectPath,
                  CODEX_SESSION_ID: terminalId
                }
              }
            }
          }
          tmpPath = join(
            tmpdir(),
            `codex-cc-mcp-${Date.now()}-${Math.random().toString(36).slice(2)}.json`
          )
          writeFileSync(tmpPath, JSON.stringify(config, null, 2), 'utf-8')
          args.push('--mcp-config', tmpPath)
          args.push('--strict-mcp-config')
          args.push('--append-system-prompt', CC_SYSTEM_PROMPT)
          claudeTempFiles.set(terminalId, tmpPath)
        }
      }

      const enhancedEnv = getEnhancedEnv() as Record<string, string>

      const info = terminalManager.createWithCommand(
        projectPath,
        claudePath,
        args,
        enhancedEnv,
        () => {
          if (tmpPath) {
            try { unlinkSync(tmpPath) } catch { /* ignore */ }
            claudeTempFiles.delete(terminalId)
          }
        },
        terminalId
      )

      terminalManager.registerClaudeTerminal(info.id, claudeSessionId)
      if (name) {
        terminalManager.setTerminalName(info.id, name)
      }
      return { success: true, ...info }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('terminal:write', (_event, id: string, data: string) => {
    terminalManager.write(id, data)
    return { success: true }
  })

  ipcMain.handle('terminal:resize', (_event, id: string, cols: number, rows: number) => {
    terminalManager.resize(id, cols, rows)
    return { success: true }
  })

  ipcMain.handle('terminal:close', (_event, id: string) => {
    terminalManager.close(id)
    // Cleanup any associated temp file
    const tmpPath = claudeTempFiles.get(id)
    if (tmpPath) {
      try { unlinkSync(tmpPath) } catch { /* ignore */ }
      claudeTempFiles.delete(id)
    }
    return { success: true }
  })

  ipcMain.handle('terminal:list', (_event, projectPath: string) => {
    return terminalManager.list(projectPath)
  })

  // Session history handlers
  ipcMain.handle('session:history', (_event, projectPath: string) => {
    if (!sessionPersistence) return []
    return sessionPersistence.getHistory(projectPath)
  })

  ipcMain.handle('session:clear-history', (_event, projectPath?: string) => {
    if (!sessionPersistence) return { success: false }
    sessionPersistence.clearHistory(projectPath)
    return { success: true }
  })

  ipcMain.handle('session:get-claude-session-id', (_event, terminalId: string) => {
    return terminalManager.getClaudeSessionId(terminalId)
  })

  ipcMain.handle('terminal:open-external', (_event, terminalId: string, projectPath: string) => {
    try {
      const tmuxSessionName = terminalManager.getTmuxSessionName()
      if (tmuxSessionName) {
        // Tmux mode: attach to the full tmux session so the user sees all windows
        const child = spawn('alacritty', ['-e', 'tmux', 'attach-session', '-t', tmuxSessionName], {
          cwd: projectPath,
          detached: true,
          stdio: 'ignore'
        })
        child.unref()
        return { success: true }
      }

      // Fallback: original behavior — launch claude --resume in alacritty
      const claudeSessionId = terminalManager.getClaudeSessionId(terminalId)
      if (!claudeSessionId) {
        return { success: false, error: 'No Claude session ID found for this terminal' }
      }
      const claudePath = findClaudeBinary()
      const args = ['--resume', claudeSessionId]
      const settings = settingsManager.get()
      if (settings.claude.dangerouslySkipPermissions) {
        args.push('--dangerously-skip-permissions')
      }
      const child = spawn('alacritty', ['-e', claudePath, ...args], {
        cwd: projectPath,
        detached: true,
        stdio: 'ignore'
      })
      child.unref()
      return { success: true }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('terminal:get-tmux-info', () => {
    return {
      available: terminalManager.isTmuxEnabled(),
      sessionName: terminalManager.getTmuxSessionName()
    }
  })
}
