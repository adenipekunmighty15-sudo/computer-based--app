import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { readTheme, type Theme } from './lib/theme'

export const SURFACES = ['solid', 'glass'] as const
export type Surface = (typeof SURFACES)[number]

export const DENSITIES = ['minimal', 'classic', 'maximal'] as const
export type Density = (typeof DENSITIES)[number]

export const FONT_SIZES = ['s', 'm', 'l'] as const
export type FontSize = (typeof FONT_SIZES)[number]

export const FONT_FAMS = ['inter', 'serif', 'readable'] as const
export type FontFam = (typeof FONT_FAMS)[number]

export interface Prefs {
  theme: Theme
  onboarded: boolean
  surface: Surface
  density: Density
  fontSize: FontSize
  fontFam: FontFam
  motion: 'full' | 'reduce'
  contrast: 'normal' | 'high'
}

const DEFAULTS: Prefs = {
  theme: 'light',
  onboarded: true,
  surface: 'glass',
  density: 'minimal',
  fontSize: 'm',
  fontFam: 'inter',
  motion: 'full',
  contrast: 'normal',
}

const KEY = 'tgb-prefs'

function readPrefs(): Prefs {
  let p: Prefs = { ...DEFAULTS }
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) p = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) }
  } catch {
    /* ignore */
  }

  try {
    if (!localStorage.getItem(KEY)) p.theme = readTheme()
  } catch {
    /* ignore */
  }

  return p
}

function applyPrefs(p: Prefs) {
  const el = document.documentElement
  el.dataset.theme = p.theme
  el.dataset.surface = p.surface
  el.dataset.density = p.density
  el.dataset.fontsize = p.fontSize
  el.dataset.fontfam = p.fontFam
  el.dataset.motion = p.motion
  el.dataset.contrast = p.contrast

  try {
    localStorage.setItem(KEY, JSON.stringify(p))
    localStorage.setItem('tgb-theme', p.theme)
  } catch {
    /* ignore */
  }
}

interface PrefsValue {
  prefs: Prefs
  update: (patch: Partial<Prefs>) => void
  reset: () => void
}

const Ctx = createContext<PrefsValue | null>(null)

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(readPrefs)

  useEffect(() => {
    applyPrefs(prefs)
  }, [prefs])

  const value: PrefsValue = {
    prefs,
    update: (patch) => setPrefs((p) => ({ ...p, ...patch })),
    reset: () => setPrefs({ ...DEFAULTS, theme: readTheme() }),
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function usePrefs() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('usePrefs must be used inside <PrefsProvider>')
  return ctx
}