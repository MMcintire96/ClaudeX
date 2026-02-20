import { create } from 'zustand'

interface AppSettings {
  claude: {
    dangerouslySkipPermissions: boolean
  }
  modKey: string
  vimMode: boolean
  autoExpandEdits: boolean
  notificationSounds: boolean
  vimChatMode: boolean
  preventSleep: boolean
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
  vimMode: true,
  autoExpandEdits: false,
  notificationSounds: true,
  vimChatMode: false,
  preventSleep: true,
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
