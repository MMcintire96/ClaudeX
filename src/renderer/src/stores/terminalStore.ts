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
}

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
  claudeViewMode: Record<string, 'terminal' | 'chat'>

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
  setClaudeViewMode: (id: string, mode: 'terminal' | 'chat') => void
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
  claudeViewMode: {},

  addTerminal: (tab: TerminalTab): void => {
    set(state => {
      const isClaude = tab.type === 'claude'
      return {
        terminals: [...state.terminals, tab],
        // Don't steal focus or show bottom panel for claude terminals
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
        // Fall back to last shell terminal, not a claude one
        activeId = shellTerminals.length > 0 ? shellTerminals[shellTerminals.length - 1].id : null
      }
      // Clean up claude status tracking
      const statuses = { ...state.claudeStatuses }
      delete statuses[id]
      const renamed = { ...state.manuallyRenamed }
      delete renamed[id]
      // Clean up active claude id tracking
      const activeClaudeIds = { ...state.activeClaudeId }
      for (const [proj, tid] of Object.entries(activeClaudeIds)) {
        if (tid === id) {
          // Find another claude terminal for this project
          const otherClaude = next.find(t => t.type === 'claude' && t.projectPath === proj && t.id !== id)
          if (otherClaude) {
            activeClaudeIds[proj] = otherClaude.id
          } else {
            delete activeClaudeIds[proj]
          }
        }
      }
      return {
        terminals: next,
        activeTerminalId: activeId,
        panelVisible: shellTerminals.length > 0 ? state.panelVisible : false,
        claudeStatuses: statuses,
        activeClaudeId: activeClaudeIds,
        manuallyRenamed: renamed
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
      // Complete the most recent running agent
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

  setClaudeViewMode: (id: string, mode: 'terminal' | 'chat'): void => {
    set(state => ({
      claudeViewMode: { ...state.claudeViewMode, [id]: mode }
    }))
  }
}))
