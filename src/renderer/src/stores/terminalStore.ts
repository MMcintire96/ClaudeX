import { create } from 'zustand'

export interface TerminalTab {
  id: string
  projectPath: string
  pid: number
}

interface TerminalState {
  terminals: TerminalTab[]
  activeTerminalId: string | null
  panelVisible: boolean
  panelHeight: number

  addTerminal: (tab: TerminalTab) => void
  removeTerminal: (id: string) => void
  setActiveTerminal: (id: string | null) => void
  togglePanel: () => void
  setPanelHeight: (h: number) => void
}

export const useTerminalStore = create<TerminalState>((set) => ({
  terminals: [],
  activeTerminalId: null,
  panelVisible: false,
  panelHeight: 300,

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
      return {
        terminals: next,
        activeTerminalId: activeId,
        panelVisible: next.length > 0 ? state.panelVisible : false
      }
    })
  },

  setActiveTerminal: (id: string | null): void => {
    set({ activeTerminalId: id })
  },

  togglePanel: (): void => {
    set(state => ({ panelVisible: !state.panelVisible }))
  },

  setPanelHeight: (h: number): void => {
    set({ panelHeight: Math.max(150, Math.min(600, h)) })
  }
}))
