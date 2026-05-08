/**
 * Lucide-style SVG icon set, mirroring the inline icons used across the
 * desktop renderer (AppHeader, Sidebar, etc.) so the mobile UI feels native
 * to the same app. All icons are 24x24 viewBox, stroke=currentColor.
 */
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function base({ size = 18, ...rest }: IconProps): SVGProps<SVGSVGElement> & { width: number; height: number } {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...rest
  }
}

export const SidebarLeftIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="9" y1="3" x2="9" y2="21" />
  </svg>
)

export const SidebarRightIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <line x1="15" y1="3" x2="15" y2="21" />
  </svg>
)

export const SettingsIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
)

export const RefreshIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
    <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
  </svg>
)

export const BellIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
)

export const LogOutIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
)

export const SendIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
)

export const StopIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <rect x="6" y="6" width="12" height="12" rx="1" />
  </svg>
)

export const ChevronLeftIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <polyline points="15 18 9 12 15 6" />
  </svg>
)

export const ChevronRightIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <polyline points="9 18 15 12 9 6" />
  </svg>
)

export const FolderIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
)

export const ZapIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
  </svg>
)

export const ArrowDownIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <polyline points="19 12 12 19 5 12" />
  </svg>
)

export const ArrowUpIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
)

export const GitCommitIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <line x1="1.05" y1="12" x2="7" y2="12" />
    <line x1="17.01" y1="12" x2="22.96" y2="12" />
  </svg>
)

export const PlayIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
)

export const ChatBubbleIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

export const CheckIcon = (p: IconProps): JSX.Element => (
  <svg {...base(p)}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
)
