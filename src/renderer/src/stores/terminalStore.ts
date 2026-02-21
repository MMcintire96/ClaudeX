import { create } from 'zustand'

export type ClaudeTerminalStatus = 'running' | 'idle' | 'attention' | 'done'

export interface SubAgentInfo {
  id: string
  name: string
  status: 'running' | 'completed'
  startedAt: number
}

export interface TerminalTab {
  id: string
  projectPath: string
  pid: number
  name?: string
  type?: 'shell' | 'claude'
  worktreePath?: string
}

export type ClaudeMode = 'plan' | 'execute' | 'accept-edits' | 'dangerously-skip'

interface TerminalState {
  terminals: TerminalTab[]
  activeTerminalId: string | null
  panelVisible: boolean
  panelHeight: number
  projectTerminalMemory: Record<string, string>
  claudeStatuses: Record<string, ClaudeTerminalStatus>
  activeClaudeId: Record<string, string>
  manuallyRenamed: Record<string, boolean>
  subAgents: Record<string, SubAgentInfo[]>
  shellSplitIds: string[]
  claudeModes: Record<string, ClaudeMode>
  claudeModels: Record<string, string>
  contextUsage: Record<string, number>
  claudeSessionIds: Record<string, string>
  worktreeNextThread: Record<string, { enabled: boolean; includeChanges: boolean }>
  pendingPermissions: Record<string, { text: string; promptType: 'yn' | 'enter' }>

  addTerminal: (tab: TerminalTab) => void
  removeTerminal: (id: string) => void
  setActiveTerminal: (id: string | null) => void
  switchToProjectTerminals: (projectPath: string) => void
  renameTerminal: (id: string, name: string) => void
  manualRenameTerminal: (id: string, name: string) => void
  autoRenameTerminal: (id: string, name: string) => void
  togglePanel: () => void
  setPanelHeight: (h: number) => void
  setClaudeStatus: (id: string, status: ClaudeTerminalStatus) => void
  setActiveClaudeId: (projectPath: string, id: string) => void
  addSubAgent: (parentId: string, agent: SubAgentInfo) => void
  completeSubAgent: (parentId: string) => void
  splitShell: (newId: string) => void
  unsplitShell: () => void
  setClaudeMode: (id: string, mode: ClaudeMode) => void
  toggleClaudeMode: (id: string, skipPermissions?: boolean) => void
  setClaudeModel: (id: string, model: string) => void
  setContextUsage: (id: string, percent: number) => void
  setClaudeSessionId: (terminalId: string, sessionId: string) => void
  setWorktreeNextThread: (projectPath: string, enabled: boolean, includeChanges: boolean) => void
  setTerminalWorktree: (terminalId: string, worktreePath: string) => void
  setPermissionRequest: (terminalId: string, text: string, promptType: 'yn' | 'enter') => void
  clearPermissionRequest: (terminalId: string) => void
}

export const useTerminalStore = create<TerminalState>((set) => ({
  terminals: [],
  activeTerminalId: null,
  panelVisible: false,
  panelHeight: 300,
  projectTerminalMemory: {},
  claudeStatuses: {},
  activeClaudeId: {},
  manuallyRenamed: {},
  subAgents: {},
  shellSplitIds: [],
  claudeModes: {},
  claudeModels: {},
  contextUsage: {},
  claudeSessionIds: {},
  worktreeNextThread: {},
  pendingPermissions: {},

  addTerminal: (tab: TerminalTab): void => {
    set(state => {
      const isClaude = tab.type === 'claude'
      return {
        terminals: [...state.terminals, tab],
        activeTerminalId: isClaude ? state.activeTerminalId : tab.id,
        panelVisible: isClaude ? state.panelVisible : true
      }
    })
  },

  removeTerminal: (id: string): void => {
    set(state => {
      const next = state.terminals.filter(t => t.id !== id)
      const shellTerminals = next.filter(t => t.type !== 'claude')
      let activeId = state.activeTerminalId
      if (activeId === id) {
        activeId = shellTerminals.length > 0 ? shellTerminals[shellTerminals.length - 1].id : null
      }
      const statuses = { ...state.claudeStatuses }
      delete statuses[id]
      const renamed = { ...state.manuallyRenamed }
      delete renamed[id]
      const sessionIds = { ...state.claudeSessionIds }
      delete sessionIds[id]
      const activeClaudeIds = { ...state.activeClaudeId }
      for (const [proj, tid] of Object.entries(activeClaudeIds)) {
        if (tid === id) {
          const otherClaude = next.find(t => t.type === 'claude' && t.projectPath === proj && t.id !== id)
          if (otherClaude) {
            activeClaudeIds[proj] = otherClaude.id
          } else {
            delete activeClaudeIds[proj]
          }
        }
      }
      // Clean up shell split state
      let shellSplits = state.shellSplitIds
      if (shellSplits.includes(id)) {
        const remaining = shellSplits.filter(sid => sid !== id)
        shellSplits = remaining.length <= 1 ? [] : remaining
      }
      return {
        terminals: next,
        activeTerminalId: activeId,
        panelVisible: shellTerminals.length > 0 ? state.panelVisible : false,
        claudeStatuses: statuses,
        activeClaudeId: activeClaudeIds,
        manuallyRenamed: renamed,
        claudeSessionIds: sessionIds,
        shellSplitIds: shellSplits
      }
    })
  },

  setActiveTerminal: (id: string | null): void => {
    set(state => {
      if (!id) return { activeTerminalId: id }
      const tab = state.terminals.find(t => t.id === id)
      const memory = tab
        ? { ...state.projectTerminalMemory, [tab.projectPath]: id }
        : state.projectTerminalMemory
      return { activeTerminalId: id, projectTerminalMemory: memory }
    })
  },

  switchToProjectTerminals: (projectPath: string): void => {
    set(state => {
      const remembered = state.projectTerminalMemory[projectPath]
      const projectTerminals = state.terminals.filter(t => t.projectPath === projectPath)
      if (remembered && projectTerminals.some(t => t.id === remembered)) {
        return { activeTerminalId: remembered }
      }
      if (projectTerminals.length > 0) {
        return { activeTerminalId: projectTerminals[0].id }
      }
      return {}
    })
  },

  renameTerminal: (id: string, name: string): void => {
    set(state => ({
      terminals: state.terminals.map(t => t.id === id ? { ...t, name } : t)
    }))
  },

  manualRenameTerminal: (id: string, name: string): void => {
    set(state => ({
      terminals: state.terminals.map(t => t.id === id ? { ...t, name } : t),
      manuallyRenamed: { ...state.manuallyRenamed, [id]: true }
    }))
    // Sync to main process so the name persists on save
    window.api.terminal.rename(id, name)
  },

  autoRenameTerminal: (id: string, name: string): void => {
    set(state => {
      if (state.manuallyRenamed[id]) return {}
      return {
        terminals: state.terminals.map(t => t.id === id ? { ...t, name } : t)
      }
    })
  },

  togglePanel: (): void => {
    set(state => ({ panelVisible: !state.panelVisible }))
  },

  setPanelHeight: (h: number): void => {
    set({ panelHeight: Math.max(150, Math.min(600, h)) })
  },

  setClaudeStatus: (id: string, status: ClaudeTerminalStatus): void => {
    set(state => ({
      claudeStatuses: { ...state.claudeStatuses, [id]: status }
    }))
  },

  setActiveClaudeId: (projectPath: string, id: string): void => {
    set(state => ({
      activeClaudeId: { ...state.activeClaudeId, [projectPath]: id }
    }))
  },

  addSubAgent: (parentId: string, agent: SubAgentInfo): void => {
    set(state => ({
      subAgents: {
        ...state.subAgents,
        [parentId]: [...(state.subAgents[parentId] || []), agent]
      }
    }))
  },

  completeSubAgent: (parentId: string): void => {
    set(state => {
      const agents = state.subAgents[parentId]
      if (!agents || agents.length === 0) return {}
      const updated = [...agents]
      for (let i = updated.length - 1; i >= 0; i--) {
        if (updated[i].status === 'running') {
          updated[i] = { ...updated[i], status: 'completed' }
          break
        }
      }
      return {
        subAgents: { ...state.subAgents, [parentId]: updated }
      }
    })
  },

  splitShell: (newId: string): void => {
    set(state => {
      const activeId = state.activeTerminalId
      if (!activeId) return {}
      return {
        shellSplitIds: [activeId, newId]
      }
    })
  },

  unsplitShell: (): void => {
    set(state => {
      const first = state.shellSplitIds[0]
      return {
        shellSplitIds: [],
        activeTerminalId: first || state.activeTerminalId
      }
    })
  },

  setClaudeMode: (id: string, mode: ClaudeMode): void => {
    set(state => ({
      claudeModes: { ...state.claudeModes, [id]: mode }
    }))
  },

  toggleClaudeMode: (id: string, skipPermissions?: boolean): void => {
    set(state => {
      const current = state.claudeModes[id] || (skipPermissions ? 'dangerously-skip' : 'execute')
      const order: ClaudeMode[] = skipPermissions
        ? ['dangerously-skip', 'execute', 'accept-edits', 'plan']
        : ['execute', 'accept-edits', 'plan']
      const next = order[(order.indexOf(current) + 1) % order.length]
      return {
        claudeModes: { ...state.claudeModes, [id]: next }
      }
    })
  },

  setClaudeModel: (id: string, model: string): void => {
    set(state => ({
      claudeModels: { ...state.claudeModels, [id]: model }
    }))
  },

  setContextUsage: (id: string, percent: number): void => {
    set(state => ({
      contextUsage: { ...state.contextUsage, [id]: percent }
    }))
  },

  setClaudeSessionId: (terminalId: string, sessionId: string): void => {
    set(state => ({
      claudeSessionIds: { ...state.claudeSessionIds, [terminalId]: sessionId }
    }))
  },

  setWorktreeNextThread: (projectPath: string, enabled: boolean, includeChanges: boolean): void => {
    set(state => ({
      worktreeNextThread: { ...state.worktreeNextThread, [projectPath]: { enabled, includeChanges } }
    }))
  },

  setTerminalWorktree: (terminalId: string, worktreePath: string): void => {
    set(state => ({
      terminals: state.terminals.map(t =>
        t.id === terminalId ? { ...t, worktreePath } : t
      )
    }))
  },

  setPermissionRequest: (terminalId: string, text: string, promptType: 'yn' | 'enter'): void => {
    set(state => ({
      pendingPermissions: { ...state.pendingPermissions, [terminalId]: { text, promptType } }
    }))
  },

  clearPermissionRequest: (terminalId: string): void => {
    set(state => {
      const next = { ...state.pendingPermissions }
      delete next[terminalId]
      return { pendingPermissions: next }
    })
  }
}))
