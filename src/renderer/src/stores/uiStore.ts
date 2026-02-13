import { create } from 'zustand'

interface SidePanelView {
  type: 'browser' | 'diff'
  projectPath: string
}

interface UIState {
  sidebarVisible: boolean
  sidePanelView: SidePanelView | null
  theme: 'dark' | 'light'
  sidebarWidth: number
  sidePanelWidth: number

  // Per-project memory: remembers last side panel per project
  projectSidePanelMemory: Record<string, 'browser' | 'diff'>

  toggleSidebar: () => void
  setSidePanelView: (view: SidePanelView | null) => void
  toggleTheme: () => void
  setSidebarWidth: (w: number) => void
  setSidePanelWidth: (w: number) => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarVisible: true,
  sidePanelView: null,
  theme: 'dark',
  sidebarWidth: 240,
  sidePanelWidth: 480,
  projectSidePanelMemory: {},

  toggleSidebar: (): void => {
    set(state => ({ sidebarVisible: !state.sidebarVisible }))
  },

  setSidePanelView: (view: SidePanelView | null): void => {
    set(state => {
      // Toggle off if clicking the same view for the same project
      if (
        view &&
        state.sidePanelView &&
        state.sidePanelView.type === view.type &&
        state.sidePanelView.projectPath === view.projectPath
      ) {
        return { sidePanelView: null }
      }
      // Remember this choice for the project
      const memory = view
        ? { ...state.projectSidePanelMemory, [view.projectPath]: view.type }
        : state.projectSidePanelMemory
      return { sidePanelView: view, projectSidePanelMemory: memory }
    })
  },

  toggleTheme: (): void => {
    set(state => ({
      theme: state.theme === 'dark' ? 'light' : 'dark'
    }))
  },

  setSidebarWidth: (w: number): void => {
    set({ sidebarWidth: Math.max(180, Math.min(400, w)) })
  },

  setSidePanelWidth: (w: number): void => {
    set({ sidePanelWidth: Math.max(300, Math.min(900, w)) })
  }
}))
