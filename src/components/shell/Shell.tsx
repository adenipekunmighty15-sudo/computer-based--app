import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, navigate, useIsActive } from '../../lib/router'
import { useHotkeys, useLocalState } from '../../lib/hooks'
import { Avatar, Icon, Seal, ThemeToggle, type IconName } from '../ui'

/* The hall.

   Everything a teacher or a student sees around the work: the rail they move
   through, the bar that says where they are, the command palette, and the
   bottom bar on a phone. It is built once here and given to both portals, so a
   new screen never has to think about chrome.

   Two decisions worth stating, because they are the reason this file exists
   rather than living inside each portal:

   · Navigation is a URL. Every destination in the rail is a real link, so a
     teacher can send a colleague straight to a filtered question bank and a
     browser Back button behaves. The rail never owns a piece of state that
     the address bar does not.

   · The scope chip is always visible. "Which portal, whose account" is the
     single most load-bearing piece of context in a multi-role app, so it is
     never a menu and never hidden behind a hamburger. */

export interface NavEntry {
  to: string
  label: string
  icon: IconName
  /** A count or short state shown at the end of the row. */
  badge?: number | string
  /** Draws the badge in the "needs you" colour. */
  badgeHot?: boolean
  /** A non-navigating row: Settings, Sign out. Rendered as a button, and it is
      not part of the router's URL space because there is nowhere to go. */
  action?: 'settings'
}

export interface NavGroup {
  label?: string
  items: NavEntry[]
}

export interface ShellProps {
  groups: NavGroup[]
  /** Subtitle under the school name — the portal and its scope. */
  scope: string
  user: { name: string; role: string }
  /** Breadcrumb, left to right; the last item is the current page. */
  trail?: { label: string; to?: string }[]
  /** Extra non-navigating commands, offered in the palette. */
  commands?: PaletteCommand[]
  onSettings: () => void
  /** Ends the session. Optional so a locked-down kiosk shell can omit it. */
  onLogout?: () => void
  /** Marks the topbar search as unusable — an exam has no business searching. */
  searchless?: boolean
  children: ReactNode
}

export interface PaletteCommand {
  id: string
  label: string
  icon?: IconName
  hint?: string
  run: () => void
}

export function Shell({
  groups,
  scope,
  user,
  trail,
  commands = [],
  onSettings,
  onLogout,
  searchless,
  children,
}: ShellProps) {
  const [rail, setRail] = useLocalState<'full' | 'collapsed'>('tgb-rail', 'full')
  const [drawer, setDrawer] = useState(false)
  const [palette, setPalette] = useState(false)

  const extra = useMemo<PaletteCommand[]>(
    () => [
      ...commands,
      {
        id: 'rail',
        label: rail === 'full' ? 'Collapse the rail' : 'Expand the rail',
        icon: 'panel',
        run: () => setRail(rail === 'full' ? 'collapsed' : 'full'),
      },
      { id: 'settings', label: 'Settings', icon: 'settings', run: onSettings },
      ...(onLogout
        ? [{ id: 'logout', label: 'Sign out', icon: 'logout' as IconName, hint: 'end this session', run: onLogout }]
        : []),
    ],
    [commands, onSettings, onLogout, rail, setRail],
  )

  useHotkeys([{ keys: 'mod+k', handler: () => setPalette((p) => !p) }])

  return (
    <div
      className="app-shell"
      data-rail={rail}
      data-drawer={drawer ? 'open' : undefined}
      data-role={user.role}
    >
      <div className="rail-scrim" onClick={() => setDrawer(false)} />
      <Rail
        groups={groups}
        scope={scope}
        user={user}
        onNavigate={() => setDrawer(false)}
        onSettings={onSettings}
        onLogout={onLogout}
      />

      <div className="main">
        <header className="topbar">
          <button
            className="btn ghost sm icon rail-toggle"
            onClick={() => setDrawer((d) => !d)}
            aria-label="Open navigation"
          >
            <Icon name="menu" size={16} />
          </button>

          {trail?.length ? (
            <nav className="topbar-trail" aria-label="Breadcrumb">
              {trail.map((t, i) => (
                <Fragment key={`${t.label}${i}`}>
                  {i > 0 ? <span className="sep">/</span> : null}
                  {t.to && i < trail.length - 1 ? (
                    <Link to={t.to}>{t.label}</Link>
                  ) : (
                    <span className="here" aria-current="page">
                      {t.label}
                    </span>
                  )}
                </Fragment>
              ))}
            </nav>
          ) : (
            <div className="topbar-trail" />
          )}

          <div className="topbar-actions">
            {searchless ? null : (
              <button className="topbar-search" onClick={() => setPalette(true)}>
                <Icon name="search" size={14} />
                <span className="grow">Search or jump to…</span>
                <kbd>⌘K</kbd>
              </button>
            )}
            <ScopeChip scope={scope} role={user.role} />
            <ThemeToggle />
          </div>
        </header>

        <main className="page">{children}</main>
      </div>

      <TabBar groups={groups} />

      {palette ? (
        <CommandPalette
          groups={groups}
          commands={extra}
          onClose={() => setPalette(false)}
        />
      ) : null}
    </div>
  )
}

/* ── Rail ───────────────────────────────────────────────────────────────── */

function Rail({
  groups,
  scope,
  user,
  onNavigate,
  onSettings,
  onLogout,
}: {
  groups: NavGroup[]
  scope: string
  user: { name: string; role: string }
  onNavigate: () => void
  onSettings: () => void
  onLogout?: () => void
}) {
  return (
    <aside className="rail">
      <div className="rail-brand">
        <Seal initials="T" />
        <div className="rail-brand-text">
          <span className="rail-brand-name">T. Gold Brighter</span>
          <span className="rail-brand-scope">{scope}</span>
        </div>
      </div>

      {groups.map((g, i) => (
        <div className="rail-group" key={g.label ?? i}>
          {g.label ? <p className="rail-group-label">{g.label}</p> : null}
          {g.items.map((item) => (
            <RailItem key={entryKey(item)} item={item} onNavigate={onNavigate} onSettings={onSettings} />
          ))}
        </div>
      ))}

      <div className="rail-foot">
        <button className="rail-account" onClick={onSettings} data-tip="Account and settings">
          <Avatar name={user.name} />
          <div className="rail-account-text">
            <span className="rail-account-name">{user.name}</span>
            <span className="rail-account-role">{user.role}</span>
          </div>
        </button>
        {onLogout ? (
          <button className="rail-signout" onClick={onLogout} data-tip="Sign out">
            <Icon name="logout" size={16} />
            <span>Sign out</span>
          </button>
        ) : null}
      </div>
    </aside>
  )
}

/* React needs a key that is unique among siblings, not unique per URL. Two rows
   may legitimately share a destination — the profile link and the settings
   button both point at /profile — so the action, when present, is part of the
   key. Keying on `to` alone produced "Encountered two children with the same
   key, /profile" on every render. */
function entryKey(item: NavEntry): string {
  return item.action ? `${item.to}:${item.action}` : item.to
}

/* A row that opens something rather than going somewhere renders as a button.
   Settings used to be reachable only by clicking the little avatar in the
   corner, which reads as a profile link and gives no hint that reading and
   motion preferences live behind it.

   The two cases are separate components rather than one component with an
   early return, because the link case calls useIsActive and the button case
   does not. An early return above the hook technically keeps hook order stable
   here, since the branch never changes for a given item — but that is the kind
   of stability a future edit can quietly break, and the rule is not worth the
   argument. */
function RailItem({ item, onNavigate, onSettings }: { item: NavEntry; onNavigate: () => void; onSettings: () => void }) {
  if (item.action === 'settings') {
    return (
      <button type="button" className="rail-item" onClick={onSettings} data-tip="Reading, motion and account">
        <Icon name={item.icon} size={16} />
        <span>{item.label}</span>
      </button>
    )
  }
  return <RailLink item={item} onNavigate={onNavigate} />
}

function RailLink({ item, onNavigate }: { item: NavEntry; onNavigate: () => void }) {
  const active = useIsActive(item.to)
  return (
    <Link
      to={item.to}
      className="rail-item"
      aria-current={active ? 'page' : undefined}
      data-tip={item.label}
      onClick={onNavigate}
    >
      <Icon name={item.icon} size={16} />
      <span>{item.label}</span>
      {item.badge !== undefined && item.badge !== '' ? (
        <span className={`rail-badge ${item.badgeHot ? 'hot' : ''}`}>{item.badge}</span>
      ) : null}
    </Link>
  )
}

/* ── Scope chip ──────────────────────────────────────────────────────────────
   Where you are and as whom. Deliberately not interactive: it is a claim about
   the session, not a control, and a control here would suggest it can be
   changed mid-task. */

export function ScopeChip({ scope, role, tone }: { scope: string; role: string; tone?: 'brass' }) {
  return (
    <span className={`scope-chip ${tone ?? ''}`}>
      <i className="dot" />
      {role} · {scope}
    </span>
  )
}

/* ── Command palette (⌘K) ────────────────────────────────────────────────────
   Navigation as a search box. It exists because "which of the eight places can
   do this" is a question people answer by typing, not by reading a rail. */

function CommandPalette({
  groups,
  commands,
  onClose,
}: {
  groups: NavGroup[]
  commands: PaletteCommand[]
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const entries = useMemo(() => {
    const nav: PaletteCommand[] = groups.flatMap((g) =>
      g.items.map((i) => ({ id: i.to, label: i.label, icon: i.icon, run: () => navigate(i.to) })),
    )
    return [...nav, ...commands]
  }, [groups, commands])

  const hits = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return entries
    return entries.filter((e) => e.label.toLowerCase().includes(t))
  }, [entries, q])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    setSel(0)
  }, [q])

  /* Arrow keys move the highlight, Enter runs it, and the highlighted row is
     scrolled into view so a long list stays usable from the keyboard alone. */
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = hits[sel]
      if (hit) {
        hit.run()
        onClose()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const grouped = useMemo(() => {
    const navCount = groups.reduce((n, g) => n + g.items.length, 0)
    return { navCount, isNav: (i: number) => i < navCount }
  }, [groups])

  return (
    <div
      className="palette-wrap"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input-row">
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            className="palette-input"
            value={q}
            placeholder="Jump to a screen or run a command…"
            aria-label="Search screens and commands"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
          />
          <kbd>esc</kbd>
        </div>

        <div className="palette-list" ref={listRef} role="listbox" aria-label="Results">
          {hits.length === 0 ? (
            <p className="palette-foot" style={{ borderTop: 'none' }}>
              Nothing matches “{q.trim()}”.
            </p>
          ) : (
            hits.map((hit, i) => {
              const isNav = grouped.isNav(i)
              const showLabel = isNav && (i === 0 || !grouped.isNav(i - 1))
              return (
                <div key={hit.id}>
                  {showLabel ? (
                    <p className="palette-group-label">{i === 0 ? 'Go to' : 'Commands'}</p>
                  ) : null}
                  <button
                    role="option"
                    aria-selected={i === sel}
                    className="palette-item"
                    onMouseMove={() => setSel(i)}
                    onClick={() => {
                      hit.run()
                      onClose()
                    }}
                  >
                    {hit.icon ? <Icon name={hit.icon} size={15} /> : null}
                    <span className="grow truncate">{hit.label}</span>
                    {hit.hint ? <span className="palette-hint">{hit.hint}</span> : null}
                  </button>
                </div>
              )
            })
          )}
        </div>

        <div className="palette-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> move
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            <kbd>esc</kbd> close
          </span>
        </div>
      </div>
    </div>
  )
}

/* ── Phone navigation ──────────────────────────────────────────────────────
   The four things a person does most, thumb-reachable. Built from the same
   entries as the rail so the two can never disagree about what exists. */

function TabBar({ groups }: { groups: NavGroup[] }) {
  /* A settings row is a button with no destination, so it has no business in a
     bar of links. It lives in the rail and the command palette. */
  const items = useMemo(
    () => groups.flatMap((g) => g.items).filter((i) => !i.action).slice(0, 4),
    [groups],
  )
  return (
    <nav className="tabbar" aria-label="Sections">
      {items.map((item) => (
        <TabItem key={entryKey(item)} item={item} />
      ))}
    </nav>
  )
}

function TabItem({ item }: { item: NavEntry }) {
  const active = useIsActive(item.to)
  return (
    <Link to={item.to} aria-current={active ? 'page' : undefined}>
      <Icon name={item.icon} size={18} />
      {item.label.split(' ')[0]}
    </Link>
  )
}
