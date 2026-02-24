import { create } from 'zustand'

export interface TerminalTab {
  id: string
  projectPath: string
  pid: number
  name?: string
  type?: 'shell'
  worktreePath?: string
}

interface TerminalState {
  terminals: TerminalTab[]
  activeTerminalId: string | null
  panelVisible: boolean
  panelHeight: number
  projectTerminalMemory: Record<string, string>
  manuallyRenamed: Record<string, boolean>
  shellSplitIds: string[]
  splitRatio: number

  addTerminal: (tab: TerminalTab) => void
  removeTerminal: (id: string) => void
  setActiveTerminal: (id: string | null) => void
  switchToProjectTerminals: (projectPath: string) => void
  renameTerminal: (id: string, name: string) => void
  manualRenameTerminal: (id: string, name: string) => void
  autoRenameTerminal: (id: string, name: string) => void
  togglePanel: () => void
  setPanelHeight: (h: number) => void
  splitShell: (newId: string) => void
  unsplitShell: () => void
  setSplitRatio: (ratio: number) => void
}

export const useTerminalStore = create<TerminalState>((set) => ({
  terminals: [],
  activeTerminalId: null,
  panelVisible: false,
  panelHeight: 300,
  projectTerminalMemory: {},
  manuallyRenamed: {},
  shellSplitIds: [],
  splitRatio: 0.5,

  addTerminal: (tab: TerminalTab): void => {
    set(state => ({
      terminals: [...state.terminals, tab],
      activeTerminalId: tab.id,
      panelVisible: true
    }))
  },

  removeTerminal: (id: string): void => {
    set(state => {
      const next = state.terminals.filter(t => t.id !== id)
      let activeId = state.activeTerminalId
      if (activeId === id) {
        activeId = next.length > 0 ? next[next.length - 1].id : null
      }
      const renamed = { ...state.manuallyRenamed }
      delete renamed[id]
      // Clean up shell split state
      let shellSplits = state.shellSplitIds
      if (shellSplits.includes(id)) {
        const remaining = shellSplits.filter(sid => sid !== id)
        shellSplits = remaining.length <= 1 ? [] : remaining
      }
      return {
        terminals: next,
        activeTerminalId: activeId,
        panelVisible: next.length > 0 ? state.panelVisible : false,
        manuallyRenamed: renamed,
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
        splitRatio: 0.5,
        activeTerminalId: first || state.activeTerminalId
      }
    })
  },

  setSplitRatio: (ratio: number): void => {
    set({ splitRatio: Math.max(0.15, Math.min(0.85, ratio)) })
  }
}))
