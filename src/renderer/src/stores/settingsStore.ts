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
  loaded: false,

  loadSettings: async (): Promise<void> => {
    const settings = await window.api.settings.get()
    set({ ...settings, loaded: true })
  },

  updateSettings: async (partial: Partial<AppSettings>): Promise<void> => {
    const updated = await window.api.settings.update(partial)
    set({ ...updated })
  }
}))
