import { usePrefs } from '../../prefs'
import { Button } from './Button'

/* Day and night.

   Built from the same Button and Icon as every other action in the app rather
   than its own bespoke control: a theme switch that looks different from the
   buttons around it reads as a different kind of thing to press. The label
   changes with the theme because the button sits next to a word, not a glyph. */

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { prefs, update } = usePrefs()
  const dark = prefs.theme === 'dark'
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={dark ? 'sun' : 'moon'}
      className={className}
      onClick={() => update({ theme: dark ? 'light' : 'dark' })}
      data-tip={dark ? 'Switch to day' : 'Switch to night'}
      aria-label={dark ? 'Switch to day mode' : 'Switch to night mode'}
    >
      {dark ? 'Day' : 'Night'}
    </Button>
  )
}
