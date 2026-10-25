import type { SVGProps } from 'react'

/* A hand-picked 20-line icon set. Every glyph here was drawn for this product
   at a 1.6px stroke on a 24 grid so they sit at the same optical weight
   regardless of size. Stroke icons, no fills, no icon-font dependency. */

export type IconName =
  | 'dashboard' | 'bank' | 'builder' | 'exams' | 'ai' | 'students'
  | 'result' | 'profile' | 'settings' | 'search' | 'bell' | 'command'
  | 'plus' | 'chevron' | 'chevronLeft' | 'chevronRight' | 'arrowRight'
  | 'arrowLeft' | 'check' | 'checkCircle' | 'x' | 'xCircle' | 'warn'
  | 'info' | 'clock' | 'flag' | 'trash' | 'edit' | 'copy' | 'download'
  | 'upload' | 'filter' | 'columns' | 'density' | 'more' | 'external'
  | 'users' | 'chart' | 'sparkle' | 'image' | 'printer' | 'lock'
  | 'logout' | 'menu' | 'grid' | 'list' | 'calendar' | 'inbox' | 'play'
  | 'eye' | 'panel' | 'refresh' | 'book' | 'target' | 'sliders' | 'sun'
  | 'moon' | 'type' | 'contrast' | 'gauge' | 'award' | 'file' | 'send'
  | 'maximize'

const P: Record<IconName, string> = {
  dashboard: 'M3 3h7v7H3zM14 3h7v4h-7zM14 10h7v11h-7zM3 13h7v8H3z',
  bank: 'M3 7h18M3 7l2-4h14l2 4M5 7v12M10 7v12M14 7v12M19 7v12M3 21h18',
  builder: 'M4 5h16M4 12h10M4 19h7M17.5 15.5l4 4M21.5 15.5l-4 4',
  exams: 'M6 3h9l5 5v13H6zM15 3v5h5M9 12h7M9 16h5',
  ai: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9zM18.5 16l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  students: 'M16 20v-1.5a4 4 0 00-4-4H6a4 4 0 00-4 4V20M9 10.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7M22 20v-1.5a4 4 0 00-3-3.87M16 3.6a4 4 0 010 7.75',
  result: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  profile: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8',
  settings: 'M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7M19.4 15a1.6 1.6 0 00.32 1.77l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.6 1.6 0 00-1.77-.32 1.6 1.6 0 00-1 1.47V21a2 2 0 11-4 0v-.1A1.6 1.6 0 008 19.4a1.6 1.6 0 00-1.77.32l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.6 1.6 0 004.6 15a1.6 1.6 0 00-1.47-1H3a2 2 0 110-4h.1A1.6 1.6 0 004.6 8a1.6 1.6 0 00-.32-1.77l-.06-.06a2 2 0 112.83-2.83l.06.06A1.6 1.6 0 009 4.6a1.6 1.6 0 001-1.47V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.47 1.6 1.6 0 001.77-.32l.06-.06a2 2 0 112.83 2.83l-.06.06A1.6 1.6 0 0019.4 9c.14.61.66 1.05 1.28 1.1H21a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14M20 20l-4-4',
  bell: 'M18 8a6 6 0 10-12 0c0 6-2 7-2 7h16s-2-1-2-7M13.7 20a2 2 0 01-3.4 0',
  command: 'M9 6a3 3 0 10-3 3h12a3 3 0 10-3-3v12a3 3 0 103-3H6a3 3 0 103 3z',
  plus: 'M12 5v14M5 12h14',
  chevron: 'M6 9l6 6 6-6',
  chevronLeft: 'M15 18l-6-6 6-6',
  chevronRight: 'M9 18l6-6-6-6',
  arrowRight: 'M4 12h16M14 6l6 6-6 6',
  arrowLeft: 'M20 12H4M10 6l-6 6 6 6',
  check: 'M20 6L9 17l-5-5',
  checkCircle: 'M22 11.1V12a10 10 0 11-5.9-9.1M22 4L12 14l-3-3',
  x: 'M18 6L6 18M6 6l12 12',
  xCircle: 'M12 22a10 10 0 100-20 10 10 0 000 20M15 9l-6 6M9 9l6 6',
  warn: 'M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0M12 9v4M12 17h.01',
  info: 'M12 22a10 10 0 100-20 10 10 0 000 20M12 16v-4M12 8h.01',
  clock: 'M12 22a10 10 0 100-20 10 10 0 000 20M12 6v6l4 2',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V4s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  trash: 'M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6',
  edit: 'M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4z',
  copy: 'M9 9h10a2 2 0 012 2v10a2 2 0 01-2 2H9a2 2 0 01-2-2V11a2 2 0 012-2M5 15H4a2 2 0 01-2-2V3a2 2 0 012-2h10a2 2 0 012 2v1',
  download: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12',
  filter: 'M22 3H2l8 9.5V19l4 2v-8.5z',
  columns: 'M4 4h16v16H4zM10 4v16M16 4v16',
  density: 'M3 5h18M3 12h18M3 19h18',
  more: 'M12 13a1 1 0 100-2 1 1 0 000 2M19 13a1 1 0 100-2 1 1 0 000 2M5 13a1 1 0 100-2 1 1 0 000 2',
  external: 'M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3',
  users: 'M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75',
  chart: 'M3 3v18h18M7 16v-5M12 16V8M17 16v-3',
  sparkle: 'M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z',
  image: 'M3 3h18v18H3zM8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3M21 15l-5-5L5 21',
  printer: 'M6 9V2h12v7M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2M6 14h12v8H6z',
  lock: 'M5 11h14a2 2 0 012 2v7a2 2 0 01-2 2H5a2 2 0 01-2-2v-7a2 2 0 012-2zM7 11V7a5 5 0 0110 0v4',
  logout: 'M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9',
  menu: 'M3 12h18M3 6h18M3 18h18',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  calendar: 'M3 4h18v18H3zM3 10h18M8 2v4M16 2v4',
  inbox: 'M22 12h-6l-2 3h-4l-2-3H2M5.5 5.1L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.5-6.9A2 2 0 0016.7 4H7.3a2 2 0 00-1.8 1.1z',
  play: 'M5 3l14 9-14 9z',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8M12 15a3 3 0 100-6 3 3 0 000 6',
  panel: 'M3 3h18v18H3zM9 3v18',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0114.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0020.5 15',
  book: 'M4 19.5A2.5 2.5 0 016.5 17H20M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z',
  target: 'M12 22a10 10 0 100-20 10 10 0 000 20M12 18a6 6 0 100-12 6 6 0 000 12M12 14a2 2 0 100-4 2 2 0 000 4',
  sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  sun: 'M12 17a5 5 0 100-10 5 5 0 000 10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
  moon: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  type: 'M4 7V4h16v3M9 20h6M12 4v16',
  contrast: 'M12 22a10 10 0 100-20 10 10 0 000 20M12 2v20',
  gauge: 'M12 21a9 9 0 118.5-4.5M12 12l4-4M20 15h2',
  award: 'M12 15a7 7 0 100-14 7 7 0 000 14M8.2 13.9L7 22l5-3 5 3-1.2-8.1',
  file: 'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8zM14 2v6h6',
  send: 'M22 2L11 13M22 2l-7 20-4-9-9-4z',
  maximize: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
}

const FILLED: Partial<Record<IconName, true>> = {
  play: true,
  flag: true,
  more: true,
}

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName
  size?: number
  strokeWidth?: number
}

export function Icon({ name, size = 16, strokeWidth = 1.6, className, ...rest }: IconProps) {
  const d = P[name] ?? P.info
  const filled = FILLED[name]
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={d} />
    </svg>
  )
}

export const ICON_NAMES = Object.keys(P) as IconName[]
