export const THEME_LIST = [
  'dark',
  'light',
  'monokai',
  'solarized-dark',
  'solarized-light',
  'nord',
  'dracula',
  'catppuccin-mocha',
  'tokyo-night',
  'gruvbox-dark',
  'one-dark',
  'rose-pine'
] as const

export type ThemeName = (typeof THEME_LIST)[number]

export const DEFAULT_THEME: ThemeName = 'dark'

export interface ThemeMeta {
  id: ThemeName
  label: string
  isDark: boolean
  previewColors: { bg: string; fg: string; accent: string }
}

export const THEME_META: ThemeMeta[] = [
  { id: 'dark', label: 'Dark', isDark: true, previewColors: { bg: '#0d0d0d', fg: '#e5e5e5', accent: '#ffffff' } },
  { id: 'light', label: 'Light', isDark: false, previewColors: { bg: '#ffffff', fg: '#1a1a1a', accent: '#1a1a1a' } },
  { id: 'monokai', label: 'Monokai', isDark: true, previewColors: { bg: '#272822', fg: '#f8f8f2', accent: '#f92672' } },
  { id: 'solarized-dark', label: 'Solarized Dark', isDark: true, previewColors: { bg: '#002b36', fg: '#839496', accent: '#268bd2' } },
  { id: 'solarized-light', label: 'Solarized Light', isDark: false, previewColors: { bg: '#fdf6e3', fg: '#657b83', accent: '#268bd2' } },
  { id: 'nord', label: 'Nord', isDark: true, previewColors: { bg: '#2e3440', fg: '#d8dee9', accent: '#88c0d0' } },
  { id: 'dracula', label: 'Dracula', isDark: true, previewColors: { bg: '#282a36', fg: '#f8f8f2', accent: '#bd93f9' } },
  { id: 'catppuccin-mocha', label: 'Catppuccin Mocha', isDark: true, previewColors: { bg: '#1e1e2e', fg: '#cdd6f4', accent: '#cba6f7' } },
  { id: 'tokyo-night', label: 'Tokyo Night', isDark: true, previewColors: { bg: '#1a1b26', fg: '#a9b1d6', accent: '#7aa2f7' } },
  { id: 'gruvbox-dark', label: 'Gruvbox Dark', isDark: true, previewColors: { bg: '#282828', fg: '#ebdbb2', accent: '#fabd2f' } },
  { id: 'one-dark', label: 'One Dark', isDark: true, previewColors: { bg: '#282c34', fg: '#abb2bf', accent: '#61afef' } },
  { id: 'rose-pine', label: 'Rose Pine', isDark: true, previewColors: { bg: '#191724', fg: '#e0def4', accent: '#c4a7e7' } }
]

const THEME_SET = new Set<string>(THEME_LIST)

export function validateTheme(value: unknown): ThemeName {
  if (typeof value === 'string' && THEME_SET.has(value)) {
    return value as ThemeName
  }
  return DEFAULT_THEME
}

export function isThemeDark(theme: ThemeName): boolean {
  const meta = THEME_META.find(m => m.id === theme)
  return meta ? meta.isDark : true
}
