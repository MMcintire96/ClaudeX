import { create } from 'zustand'

interface AppSettings {
  claude: {
    dangerouslySkipPermissions: boolean
  }
  modKey: string
  vimMode: boolean
  autoExpandEdits: boolean
  notificationSounds: boolean
  preventSleep: boolean
  suggestNextMessage: boolean
  sideBySideDiffs: boolean
  defaultModel: string
  defaultEffort: string
  fontSize: number
  fontFamily: string
  lineHeight: number
  showTimestamps: boolean
  compactMessages: boolean
  defaultMainTab: 'chat' | 'cc'
}

interface SettingsState extends AppSettings {
  loaded: boolean
  loadSettings: () => Promise<void>
  updateSettings: (partial: Partial<AppSettings>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set) => ({
  claude: {
    dangerouslySkipPermissions: false
  },
  modKey: 'Alt',
  vimMode: false,
  autoExpandEdits: false,
  notificationSounds: true,
  preventSleep: true,
  suggestNextMessage: true,
  sideBySideDiffs: false,
  defaultModel: 'claude-opus-4-6',
  defaultEffort: 'high',
  fontSize: 14.5,
  fontFamily: 'system',
  lineHeight: 1.65,
  showTimestamps: false,
  compactMessages: false,
  defaultMainTab: 'chat',
  loaded: false,

  loadSettings: async (): Promise<void> => {
    const settings = await window.api.settings.get()
    set({ ...settings, loaded: true })
    // Apply defaultMainTab to editorStore on initial load
    if (settings.defaultMainTab) {
      const { useEditorStore } = await import('./editorStore')
      useEditorStore.getState().setMainPanelTab(settings.defaultMainTab)
    }
  },

  updateSettings: async (partial: Partial<AppSettings>): Promise<void> => {
    const updated = await window.api.settings.update(partial)
    set({ ...updated })
  }
}))
