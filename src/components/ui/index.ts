/* The kit.

   Every screen imports from here and nowhere else. The rule that makes this
   file worth having: a component lives in `ui/` if more than one screen needs
   it, and nowhere else. A page that needs something new asks whether it is
   really a pattern (two screens) or a detail (one screen) before adding a file.

   Naming inside the kit is by role, not by appearance. `Tag` is not
   `PillBadge`, `Panel` is not `WhiteBox`. A component named after how it looks
   cannot be restyled; one named after what it is can. */

export * from './Icon'
export * from './Button'
export * from './Field'
export * from './Badge'
export * from './Surface'
export * from './Bubble'
export * from './Overlay'
export * from './State'
export * from './Segmented'
export * from './Kpi'
export * from './Figure'
export * from './MathText'
export * from './RadioOption'
export * from './Reveal'
export * from './ThemeToggle'
