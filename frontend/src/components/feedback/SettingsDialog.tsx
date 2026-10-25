import { useState } from 'react'
import { usePrefs, DENSITIES, FONT_FAMS, FONT_SIZES, type Density, type FontFam, type FontSize } from '../../prefs'
import { Button, Modal, Segmented, SwitchRow, Tabs, type Tone } from '../ui'
import { AccountSettings } from '../patterns/AccountSettings'
import { PageHead } from '../patterns/Topbar'
import { notify } from './Toast'

/* Appearance and accessibility. Density, type size and contrast are reading
   preferences a person has for a whole term, so they belong in one place and
   apply everywhere immediately — no "apply" button, no reload. */

const DENSITY_LABEL: Record<Density, string> = {
  minimal: 'Minimal',
  classic: 'Classic',
  maximal: 'Maximal',
}

/* The app reads density off `--row-py`, so the three settings map onto the
   three token sets that already exist rather than a second styling path. */
function densityToken(d: Density): string {
  return d === 'minimal' ? 'compact' : d === 'maximal' ? 'spacious' : 'comfortable'
}

export type SettingsTab = 'read' | 'motion' | 'account'

export function SettingsDialog({
  open,
  onClose,
  startTab = 'read',
  fullScreen = false,
}: {
  open: boolean
  onClose: () => void
  fullScreen?: boolean
  /** Lets a caller deep-link a section, e.g. the "Sign out" menu item. */
  startTab?: SettingsTab
}) {
  const { prefs, update, reset } = usePrefs()
  const [tab, setTab] = useState<SettingsTab>(startTab)

  const setDensity = (d: Density) => update({ density: d })
  const setFontSize = (s: FontSize) => update({ fontSize: s })

  const content = (
    <>
      <Tabs
        value={tab}
        onChange={setTab}
        ariaLabel="Settings sections"
        options={[
          { value: 'read', label: 'Reading' },
          { value: 'motion', label: 'Motion' },
          { value: 'account', label: 'Account' },
        ]}
      />

      <p className="settings-scope">
        {tab === 'account'
          ? 'Your name, username, password and the way out.'
          : tab === 'motion'
            ? 'How much the app moves.'
            : 'How the app looks and how large the type is. Applies everywhere at once.'}
      </p>

      {tab === 'read' ? (
        <div className="stack">
          <div className="field">
            <span className="field-label">Row density</span>
            <Segmented
              grow
              value={prefs.density}
              onChange={setDensity}
              options={DENSITIES.map((d) => ({ value: d, label: DENSITY_LABEL[d] }))}
              ariaLabel="Row density"
            />
            <p className="field-hint">
              Applies to every table in the app. Compact fits roughly twice the questions on screen.
            </p>
          </div>

          <div className="field">
            <span className="field-label">Text size</span>
            <Segmented
              grow
              value={prefs.fontSize}
              onChange={setFontSize}
              options={FONT_SIZES.map((s) => ({ value: s, label: s.toUpperCase() }))}
              ariaLabel="Text size"
            />
          </div>

          <div className="field">
            <span className="field-label">Typeface</span>
            <Segmented
              grow
              value={prefs.fontFam}
              onChange={(f: FontFam) => update({ fontFam: f })}
              options={FONT_FAMS.map((f) => ({ value: f, label: f === 'inter' ? 'Inter' : f === 'serif' ? 'Serif' : 'Readable' }))}
              ariaLabel="Typeface"
            />
          </div>

          <div className="stack stack-sm">
            <SwitchRow
              icon="contrast"
              label="High contrast"
              description="Thicker rules, brighter text, no translucency. Use in a bright hall or on a projector."
              checked={prefs.contrast === 'high'}
              onChange={(v) => update({ contrast: v ? 'high' : 'normal' })}
            />
            <SwitchRow
              icon="panel"
              label="Flat surfaces"
              description="Removes the depth and glow effects. Nothing moves, nothing lifts."
              checked={prefs.surface === 'solid'}
              onChange={(v) => update({ surface: v ? 'solid' : 'glass' })}
            />
          </div>

          <p className="hint">
            Numbers are always set in a tabular monospace face so columns line up — that is not affected by
            the typeface choice above.
          </p>
        </div>
      ) : tab === 'motion' ? (
        <div className="stack">
          <div className="stack stack-sm">
            <SwitchRow
              icon="gauge"
              label="Reduce motion"
              description="Turns off every transition, reveal and ambient animation in the app."
              checked={prefs.motion === 'reduce'}
              onChange={(v) => update({ motion: v ? 'reduce' : 'full' })}
            />
            <SwitchRow
              icon="clock"
              label="Critical clock warning"
              description="Keep the 5-minute warning on the exam timer even when motion is reduced."
              checked
              onChange={() => {}}
            />
          </div>
          <p className="hint">
            Your system setting for reduced motion is respected automatically, whichever this switch says.
          </p>
        </div>
      ) : (
        <AccountSettings embedded onSignedOut={onClose} />
      )}
    </>
  )

  if (fullScreen) {
    return (
      <div className="stack loose">
        <PageHead
          title="Account & access"
          tagline="Manage your account, reading preferences and accessibility settings."
          actions={tab === 'read' ? (
            <Button variant="quiet" onClick={() => { reset(); notify('info', 'Settings reset to defaults') }}>Reset</Button>
          ) : undefined}
        />
        {content}
      </div>
    )
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Settings"
      kicker="Account & access"
      width={tab === 'account' ? 620 : 540}
      actions={
        <>
          {tab === 'read' ? (
            <Button
              variant="quiet"
              onClick={() => {
                reset()
                notify('info', 'Settings reset to defaults')
              }}
            >
              Reset
            </Button>
          ) : null}
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </>
      }
    >
      {content}
    </Modal>
  )
}

export function SettingsPage({ onClose }: { onClose: () => void }) {
  return <SettingsDialog open onClose={onClose} fullScreen />
}

export function SettingsButton({ onClick }: { onClick: () => void; className?: string }) {
  return (
    <Button variant="ghost" size="sm" icon="settings" onClick={onClick} data-tip="Reading settings" aria-label="Reading and accessibility settings" />
  )
}

export { densityToken }
export type { Tone }
