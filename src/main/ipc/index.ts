import { AgentManager } from '../agent/AgentManager'
import { ProjectManager } from '../project/ProjectManager'
import { BrowserManager } from '../browser/BrowserManager'
import { TerminalManager } from '../terminal/TerminalManager'
import { SettingsManager } from '../settings/SettingsManager'
import { VoiceManager } from '../voice/VoiceManager'
import { SessionPersistence } from '../session/SessionPersistence'
import { ProjectConfigManager } from '../project/ProjectConfigManager'
import { registerAgentHandlers } from './agentHandlers'
import { registerProjectHandlers } from './projectHandlers'
import { registerBrowserHandlers } from './browserHandlers'
import { registerTerminalHandlers, BridgeInfo } from './terminalHandlers'
import { registerSettingsHandlers } from './settingsHandlers'
import { registerVoiceHandlers } from './voiceHandlers'
import { WorktreeManager } from '../worktree/WorktreeManager'
import { registerWorktreeHandlers } from './worktreeHandlers'
import { registerScreenshotHandlers } from './screenshotHandlers'
import { NeovimManager } from '../neovim/NeovimManager'
import { registerNeovimHandlers } from './neovimHandlers'

export function registerAllHandlers(
  agentManager: AgentManager,
  projectManager: ProjectManager,
  browserManager: BrowserManager,
  terminalManager: TerminalManager,
  settingsManager: SettingsManager,
  voiceManager: VoiceManager,
  bridgeInfo?: BridgeInfo,
  sessionPersistence?: SessionPersistence,
  projectConfigManager?: ProjectConfigManager,
  _sessionFileWatcher?: unknown,
  worktreeManager?: WorktreeManager,
  neovimManager?: NeovimManager
): void {
  registerAgentHandlers(agentManager, worktreeManager, sessionPersistence)
  registerProjectHandlers(projectManager, projectConfigManager, terminalManager)
  registerBrowserHandlers(browserManager)
  registerTerminalHandlers(terminalManager, settingsManager, bridgeInfo, sessionPersistence)
  registerSettingsHandlers(settingsManager)
  registerVoiceHandlers(voiceManager)
  if (worktreeManager) {
    registerWorktreeHandlers(worktreeManager)
  }
  registerScreenshotHandlers()
  if (neovimManager) {
    registerNeovimHandlers(neovimManager)
  }
}
