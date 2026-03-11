import { describe, it, expect } from 'vitest'
import { validateTheme, THEME_LIST, DEFAULT_THEME, THEME_META } from '../themes'
import { XTERM_THEMES } from '../xtermThemes'

describe('validateTheme', () => {
  it('returns the theme when valid', () => {
    expect(validateTheme('dark')).toBe('dark')
    expect(validateTheme('monokai')).toBe('monokai')
    expect(validateTheme('nord')).toBe('nord')
  })

  it('returns default for invalid string', () => {
    expect(validateTheme('nonexistent')).toBe(DEFAULT_THEME)
    expect(validateTheme('')).toBe(DEFAULT_THEME)
  })

  it('returns default for non-string values', () => {
    expect(validateTheme(null)).toBe(DEFAULT_THEME)
    expect(validateTheme(undefined)).toBe(DEFAULT_THEME)
    expect(validateTheme(42)).toBe(DEFAULT_THEME)
    expect(validateTheme({})).toBe(DEFAULT_THEME)
  })
})

describe('THEME_META', () => {
  it('has an entry for every theme in THEME_LIST', () => {
    const metaIds = THEME_META.map(m => m.id)
    for (const theme of THEME_LIST) {
      expect(metaIds).toContain(theme)
    }
  })

  it('each entry has required fields', () => {
    for (const meta of THEME_META) {
      expect(meta.label).toBeTruthy()
      expect(typeof meta.isDark).toBe('boolean')
      expect(meta.previewColors.bg).toBeTruthy()
      expect(meta.previewColors.fg).toBeTruthy()
      expect(meta.previewColors.accent).toBeTruthy()
    }
  })
})

describe('XTERM_THEMES', () => {
  const requiredKeys = [
    'background', 'foreground', 'cursor', 'selectionBackground',
    'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
    'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'
  ]

  it('has an entry for every theme in THEME_LIST', () => {
    for (const theme of THEME_LIST) {
      expect(XTERM_THEMES[theme]).toBeDefined()
    }
  })

  it('each theme has all required color keys', () => {
    for (const theme of THEME_LIST) {
      for (const key of requiredKeys) {
        expect(XTERM_THEMES[theme][key], `${theme} missing ${key}`).toBeTruthy()
      }
    }
  })

  it('all color values are valid hex strings', () => {
    const hexPattern = /^#[0-9a-fA-F]{6}$/
    for (const theme of THEME_LIST) {
      for (const [key, value] of Object.entries(XTERM_THEMES[theme])) {
        expect(value, `${theme}.${key} = "${value}"`).toMatch(hexPattern)
      }
    }
  })
})
