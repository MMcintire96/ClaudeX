import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSettingsStore } from '../settingsStore'

const store = useSettingsStore

const defaultSettings = {
  claude: { dangerouslySkipPermissions: false },
  modKey: 'Alt',
  vimMode: true,
  autoExpandEdits: false,
  notificationSounds: true,
  vimChatMode: false,
  preventSleep: true,
  suggestNextMessage: true,
  sideBySideDiffs: false,
  defaultModel: 'claude-opus-4-6',
  defaultEffort: 'high',
  fontSize: 14.5,
  fontFamily: 'system',
  lineHeight: 1.65,
  showTimestamps: false,
  compactMessages: false
}

function resetStore(): void {
  store.setState({
    ...defaultSettings,
    loaded: false
  })
}

function mockSettingsApi(overrides: Record<string, unknown> = {}): void {
  ;(window as Record<string, unknown>).api = {
    ...(window as Record<string, unknown>).api as object,
    settings: {
      get: vi.fn().mockResolvedValue({ ...defaultSettings, vimMode: false }),
      update: vi.fn().mockImplementation(async (partial: Record<string, unknown>) => ({
        ...defaultSettings,
        ...partial
      })),
      ...overrides
    }
  }
}

beforeEach(() => {
  resetStore()
  mockSettingsApi()
})

describe('defaults', () => {
  it('has sensible defaults', () => {
    const state = store.getState()
    expect(state.defaultModel).toBe('claude-opus-4-6')
    expect(state.defaultEffort).toBe('high')
    expect(state.fontSize).toBe(14.5)
    expect(state.loaded).toBe(false)
  })
})

describe('loadSettings', () => {
  it('loads settings from API and marks as loaded', async () => {
    await store.getState().loadSettings()
    expect(store.getState().vimMode).toBe(false)
    expect(store.getState().loaded).toBe(true)
  })
})

describe('updateSettings', () => {
  it('updates partial settings via API', async () => {
    await store.getState().updateSettings({ fontSize: 16 })
    expect(store.getState().fontSize).toBe(16)
  })

  it('preserves other settings', async () => {
    await store.getState().updateSettings({ fontSize: 16 })
    expect(store.getState().defaultModel).toBe('claude-opus-4-6')
  })
})
