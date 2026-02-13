import { AgentManager } from '../agent/AgentManager'
import { ProjectManager } from '../project/ProjectManager'
import { BrowserManager } from '../browser/BrowserManager'
import { TerminalManager } from '../terminal/TerminalManager'
import { registerAgentHandlers } from './agentHandlers'
import { registerProjectHandlers } from './projectHandlers'
import { registerBrowserHandlers } from './browserHandlers'
import { registerTerminalHandlers } from './terminalHandlers'

export function registerAllHandlers(
  agentManager: AgentManager,
  projectManager: ProjectManager,
  browserManager: BrowserManager,
  terminalManager: TerminalManager
): void {
  registerAgentHandlers(agentManager)
  registerProjectHandlers(projectManager)
  registerBrowserHandlers(browserManager)
  registerTerminalHandlers(terminalManager)
}
