import { AgentManager } from '../agent/AgentManager'
import { ProjectManager } from '../project/ProjectManager'
import { TerminalManager } from '../terminal/TerminalManager'
import { SettingsManager } from '../settings/SettingsManager'
import { VoiceManager } from '../voice/VoiceManager'
import { SessionPersistence } from '../session/SessionPersistence'
import { ProjectConfigManager } from '../project/ProjectConfigManager'
import { ClaudexBridgeServer } from '../bridge/ClaudexBridgeServer'
import { registerAgentHandlers } from './agentHandlers'
import { registerProjectHandlers } from './projectHandlers'
import { registerTerminalHandlers } from './terminalHandlers'
import { registerSettingsHandlers } from './settingsHandlers'
import { registerVoiceHandlers } from './voiceHandlers'
import { WorktreeManager } from '../worktree/WorktreeManager'
import { registerWorktreeHandlers } from './worktreeHandlers'
import { registerScreenshotHandlers } from './screenshotHandlers'
import { NeovimManager } from '../neovim/NeovimManager'
import { registerNeovimHandlers } from './neovimHandlers'
import { McpManager } from '../mcp/McpManager'
import { registerMcpHandlers } from './mcpHandlers'
import { CheckpointManager } from '../checkpoint/CheckpointManager'
import { registerCheckpointHandlers } from './checkpointHandlers'
import { registerCCHandlers, setCCMainWindow } from './ccHandlers'
import type { RemoteServer } from '../remote/RemoteServer'
import { registerRemoteHandlers } from './remoteHandlers'

export function registerAllHandlers(
  agentManager: AgentManager,
  projectManager: ProjectManager,
  terminalManager: TerminalManager,
  settingsManager: SettingsManager,
  voiceManager: VoiceManager,
  sessionPersistence?: SessionPersistence,
  projectConfigManager?: ProjectConfigManager,
  worktreeManager?: WorktreeManager,
  neovimManager?: NeovimManager,
  mcpManager?: McpManager,
  bridgeServer?: ClaudexBridgeServer,
  checkpointManager?: CheckpointManager,
  remoteServer?: RemoteServer
): void {
  registerAgentHandlers(agentManager, worktreeManager, sessionPersistence, bridgeServer)
  registerProjectHandlers(projectManager, projectConfigManager, terminalManager)
  registerTerminalHandlers(terminalManager, sessionPersistence)
  registerSettingsHandlers(settingsManager)
  registerVoiceHandlers(voiceManager)
  if (worktreeManager) {
    registerWorktreeHandlers(worktreeManager)
  }
  registerScreenshotHandlers()
  if (neovimManager) {
    registerNeovimHandlers(neovimManager)
  }
  if (mcpManager) {
    registerMcpHandlers(mcpManager, settingsManager)
  }
  if (checkpointManager) {
    registerCheckpointHandlers(checkpointManager)
  }
  if (remoteServer) {
    registerRemoteHandlers(remoteServer)
  }
  registerCCHandlers()
}
