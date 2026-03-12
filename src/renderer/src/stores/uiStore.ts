import { create } from 'zustand'
import { ThemeName, THEME_LIST, DEFAULT_THEME } from '../lib/themes'

interface SidePanelView {
  type: 'browser' | 'diff'
  projectPath: string
  file?: string
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

  // Split-view: two ChatViews side-by-side
  splitView: boolean
  splitSessionId: string | null
  splitRatio: number
  focusedSplitPane: 'left' | 'right'

  // Per-project memory of paired split sessions (persists across project switches)
  projectPairMemory: Record<string, { writerId: string; reviewerId: string }>

  toggleSidebar: () => void
  setSidePanelView: (view: SidePanelView | null) => void
  setPendingBrowserUrl: (url: string | null) => void
  cycleTheme: () => void
  setTheme: (theme: ThemeName) => void
  setSidebarWidth: (w: number) => void
  setSidePanelWidth: (w: number) => void
  toggleChatDetached: () => void
  toggleSplitView: () => void
  setSplitSessionId: (id: string | null) => void
  setSplitRatio: (ratio: number) => void
  setFocusedSplitPane: (pane: 'left' | 'right') => void
  setProjectPair: (projectPath: string, writerId: string, reviewerId: string) => void
  clearProjectPair: (projectPath: string) => void
  chatZoom: number
  setChatZoom: (zoom: number) => void

  settingsOpen: boolean
  setSettingsOpen: (open: boolean) => void

  automationsOpen: boolean
  setAutomationsOpen: (open: boolean) => void

  suspendSplitView: () => void
  restoreSplitView: (splitSessionId: string) => void
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
  splitView: false,
  splitSessionId: null,
  splitRatio: 0.5,
  focusedSplitPane: 'left',
  projectPairMemory: {},
  chatZoom: 1,
  settingsOpen: false,
  automationsOpen: false,

  setChatZoom: (zoom: number): void => {
    set({ chatZoom: Math.max(0.5, Math.min(2, zoom)) })
  },

  setSettingsOpen: (open: boolean): void => {
    set({ settingsOpen: open, ...(open ? { automationsOpen: false } : {}) })
  },

  setAutomationsOpen: (open: boolean): void => {
    set({ automationsOpen: open, ...(open ? { settingsOpen: false, sidePanelView: null, chatDetached: false } : {}) })
  },

  setPendingBrowserUrl: (url: string | null): void => {
    set({ pendingBrowserUrl: url })
  },

  toggleSidebar: (): void => {
    set(state => ({ sidebarVisible: !state.sidebarVisible }))
  },

  setSidePanelView: (view: SidePanelView | null): void => {
    set(state => {
      // Toggle off if clicking the same view for the same project (but not when navigating to a specific file)
      if (
        view &&
        state.sidePanelView &&
        state.sidePanelView.type === view.type &&
        state.sidePanelView.projectPath === view.projectPath &&
        !view.file
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
    set(state => ({
      chatDetached: !state.chatDetached,
      // Mutual exclusion: disable split when popping out
      ...(!state.chatDetached ? { splitView: false, splitSessionId: null, splitRatio: 0.5, focusedSplitPane: 'left' as const } : {})
    }))
  },

  toggleSplitView: (): void => {
    set(state => {
      // When closing split view, unpair the sessions
      if (state.splitView && state.splitSessionId) {
        window.api.agent.unpairSessions(state.splitSessionId)
      }
      return {
        splitView: !state.splitView,
        // Reset split state when toggling off
        ...(!state.splitView
          ? { splitSessionId: null, focusedSplitPane: 'left' as const }
          : { splitSessionId: null, splitRatio: 0.5, focusedSplitPane: 'left' as const }),
        // Mutual exclusion: disable pop-out when splitting
        ...(state.splitView ? {} : { chatDetached: false })
      }
    })
  },

  setSplitSessionId: (id: string | null): void => {
    set({ splitSessionId: id })
  },

  setSplitRatio: (ratio: number): void => {
    set({ splitRatio: Math.max(0.20, Math.min(0.80, ratio)) })
  },

  setFocusedSplitPane: (pane: 'left' | 'right'): void => {
    set({ focusedSplitPane: pane })
  },

  setProjectPair: (projectPath: string, writerId: string, reviewerId: string): void => {
    set(state => ({
      projectPairMemory: { ...state.projectPairMemory, [projectPath]: { writerId, reviewerId } }
    }))
  },

  clearProjectPair: (projectPath: string): void => {
    set(state => {
      const { [projectPath]: _, ...rest } = state.projectPairMemory
      return { projectPairMemory: rest }
    })
  },

  suspendSplitView: (): void => {
    set(state => {
      if (state.splitView && state.splitSessionId) {
        window.api.agent.unpairSessions(state.splitSessionId)
      }
      return {
        splitView: false,
        splitSessionId: null,
        focusedSplitPane: 'left' as const
      }
    })
  },

  restoreSplitView: (splitSessionId: string): void => {
    set({
      splitView: true,
      splitSessionId,
      focusedSplitPane: 'left' as const,
      chatDetached: false
    })
  }
}))
