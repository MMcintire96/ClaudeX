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

  // CC ↔ Chat handoff state
  ccSessionIds: Record<string, string> // renderer sessionId → CC CLI UUID
  setCCSessionId: (sessionId: string, ccId: string) => void
  clearCCSessionId: (sessionId: string) => void
  ccResumeId: string | null // set when Chat→CC handoff needs --resume
  setCCResumeId: (id: string | null) => void

  // Editor lifecycle
  setEditorActive: (projectPath: string, pid: number) => void
  removeEditor: (projectPath: string) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  activeEditors: {},
  mainPanelTab: 'chat',
  ccSessionIds: {},
  ccResumeId: null,

  setMainPanelTab: (tab: 'chat' | 'editor' | 'cc'): void => {
    set({ mainPanelTab: tab })
  },

  setCCSessionId: (sessionId: string, ccId: string): void => {
    set(state => ({ ccSessionIds: { ...state.ccSessionIds, [sessionId]: ccId } }))
  },

  clearCCSessionId: (sessionId: string): void => {
    set(state => {
      const next = { ...state.ccSessionIds }
      delete next[sessionId]
      return { ccSessionIds: next }
    })
  },

  setCCResumeId: (id: string | null): void => {
    set({ ccResumeId: id })
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
