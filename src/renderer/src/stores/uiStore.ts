import { create } from 'zustand'
import { ThemeName, THEME_LIST, DEFAULT_THEME } from '../lib/themes'

interface SidePanelView {
  type: 'browser' | 'diff'
  projectPath: string
}

interface UIState {
  sidebarVisible: boolean
  sidePanelView: SidePanelView | null
  theme: ThemeName
  sidebarWidth: number
  sidePanelWidth: number

  // Per-project memory: remembers last side panel per project
  projectSidePanelMemory: Record<string, 'browser' | 'diff'>

  // Pending URL for browser panel to navigate to after mount
  pendingBrowserUrl: string | null

  // Chat popped out to separate window
  chatDetached: boolean

  toggleSidebar: () => void
  setSidePanelView: (view: SidePanelView | null) => void
  setPendingBrowserUrl: (url: string | null) => void
  cycleTheme: () => void
  setTheme: (theme: ThemeName) => void
  setSidebarWidth: (w: number) => void
  setSidePanelWidth: (w: number) => void
  toggleChatDetached: () => void
}

export const useUIStore = create<UIState>((set) => ({
  sidebarVisible: true,
  sidePanelView: null,
  theme: DEFAULT_THEME,
  sidebarWidth: 240,
  sidePanelWidth: 480,
  projectSidePanelMemory: {},
  pendingBrowserUrl: null,
  chatDetached: false,

  setPendingBrowserUrl: (url: string | null): void => {
    set({ pendingBrowserUrl: url })
  },

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

  cycleTheme: (): void => {
    set(state => {
      const idx = THEME_LIST.indexOf(state.theme)
      const next = THEME_LIST[(idx + 1) % THEME_LIST.length]
      return { theme: next }
    })
  },

  setTheme: (theme: ThemeName): void => {
    set({ theme })
  },

  setSidebarWidth: (w: number): void => {
    set({ sidebarWidth: Math.max(180, Math.min(400, w)) })
  },

  setSidePanelWidth: (w: number): void => {
    const maxW = Math.max(300, window.innerWidth - 300)
    set({ sidePanelWidth: Math.max(300, Math.min(maxW, w)) })
  },

  toggleChatDetached: (): void => {
    set(state => ({ chatDetached: !state.chatDetached }))
  }
}))
