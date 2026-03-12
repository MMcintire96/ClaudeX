import { create } from 'zustand'

interface EditorInfo {
  pid: number
  ready: boolean
}

interface EditorState {
  // Per-project neovim state
  activeEditors: Record<string, EditorInfo>

  // Which MainPanel tab is shown
  mainPanelTab: 'chat' | 'editor' | 'cc'
  setMainPanelTab: (tab: 'chat' | 'editor' | 'cc') => void

  // Editor lifecycle
  setEditorActive: (projectPath: string, pid: number) => void
  removeEditor: (projectPath: string) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  activeEditors: {},
  mainPanelTab: 'chat',

  setMainPanelTab: (tab: 'chat' | 'editor' | 'cc'): void => {
    set({ mainPanelTab: tab })
  },

  setEditorActive: (projectPath: string, pid: number): void => {
    set(state => ({
      activeEditors: {
        ...state.activeEditors,
        [projectPath]: { pid, ready: true }
      }
    }))
  },

  removeEditor: (projectPath: string): void => {
    set(state => {
      const next = { ...state.activeEditors }
      delete next[projectPath]
      return { activeEditors: next }
    })
  }
}))
