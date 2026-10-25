import React, { Suspense, lazy, useState } from 'react'
import { useSpring, animated, config } from '@react-spring/web'
import { useAuth } from '../auth-context'
import { Button, Icon, Input, Seal, Select, ThemeToggle } from '../components/ui'
import { SettingsDialog, SettingsButton } from '../components/feedback'

/* The 3D room is the only thing here that needs three.js, and three.js is
   large. Loading it on demand means the form is painted and usable from the
   first chunk, and a reader who has reduced motion on never causes the fetch
   at all. The gradient behind it is already in place, so nothing shifts when
   the scene arrives — or when it does not. */
const AuthScene = lazy(() => import('../components/canvas/AuthScene'))

// --- UI OVERLAY ---

const CLASS_LEVELS = ['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3']

const ROLE_COPY = {
  student: {
    label: 'Student',
    desc: 'Sit assigned papers and read the full answer review.',
    icon: 'students' as const,
  },
  teacher: {
    label: 'Teacher',
    desc: 'Build the bank, set the paper, mark the scripts.',
    icon: 'book' as const,
  },
}

/* The pipeline a paper actually travels, in the order it travels. The left
   column of this screen is a literal account of the product, not decoration. */
const FLOW = [
  { n: '01', t: 'Assigned', d: 'A teacher sets the paper and releases it to a class.' },
  { n: '02', t: 'Sat', d: 'One continuous paper, on the clock, answerable in any order.' },
  { n: '03', t: 'Handed in', d: 'Answers are saved as you go, so nothing is lost.' },
  { n: '04', t: 'Marked', d: 'Objective papers mark themselves; scripts are marked by hand.' },
  { n: '05', t: 'Explained', d: 'Every mark comes back with the reasoning behind it.' },
]

export function AuthScreen() {
  const { login, register, backendDown } = useAuth()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [role, setRole] = useState<'teacher' | 'student'>('student')
  const [form, setForm] = useState({ name: '', username: '', password: '', studentId: '', cls: '', teacherCode: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [showSettings, setShowSettings] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showRecovery, setShowRecovery] = useState(false)
  // Light, not deep: the room is a lit space the words sit on, so the base tone
  // is a pale jade / pale periwinkle and the accent is the saturated version of
  // the same hue. The seal needs enough depth to separate from its own plate.
  const accent = role === 'student' ? '#0f9d6e' : '#4f46e5'
  const sceneColor = role === 'student' ? '#a7e9c8' : '#c7cdfb'

  // react-spring for the form entrance
  const formSpring = useSpring({
    from: { opacity: 0, transform: 'translateY(40px)' },
    to: { opacity: 1, transform: 'translateY(0px)' },
    config: config.gentle,
  })

  const validate = (f: typeof form, r: typeof role): Record<string, string> => {
    const errs: Record<string, string> = {}
    if (!f.name.trim()) errs.name = 'Full name is required'
    if (!/^[a-zA-Z0-9._-]{3,32}$/.test(f.username.trim())) {
      errs.username = 'Username must be 3–32 chars (letters, numbers, . _ -)'
    }
    if (f.password.length < 6) errs.password = 'Password must be at least 6 characters'
    if (r === 'student') {
      if (!f.studentId.trim()) errs.studentId = 'Student ID is required'
      if (!f.cls.trim()) errs.cls = 'Class is required'
    }
    return errs
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (mode === 'register') {
      const v = validate(form, role)
      setFieldErrors(v)
      if (Object.keys(v).length > 0) return
    } else {
      setFieldErrors({})
      const errs: Record<string, string> = {}
      if (!form.username.trim()) errs.username = 'Enter your username'
      if (!form.password) errs.password = 'Enter your password'
      setFieldErrors(errs)
      if (Object.keys(errs).length > 0) return
    }
    setBusy(true)
    try {
      if (mode === 'login') {
        await login(form.username.trim(), form.password, role)
      } else {
        await register({ ...form, role })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const set = (k: string) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }))
    setFieldErrors((fe) => {
      if (!fe[k]) return fe
      const copy = { ...fe }
      delete copy[k]
      return copy
    })
  }

  return (
    <main className="auth" data-role={role}>
      {/* The scene is the room the whole screen stands in. It lives in its own
          absolutely-placed layer rather than as a grid item: react-three-fiber
          writes an inline `position: relative` onto its wrapper, which would
          otherwise win against the stylesheet and squeeze the scene into one
          column — pushing the form onto a second row, off-screen. */}
      <div className="auth-scene" aria-hidden="true">
        <Suspense fallback={<div className="scene-fallback" />}>
          <AuthScene accent={accent} sceneColor={sceneColor} />
        </Suspense>
      </div>

      <section className="auth-story">
        <p className="auth-school">
          <Seal />
          T. Gold Brighter Tomorrow · Model School
        </p>

        <h1 className="auth-headline">
          Tomorrow starts with <em>what you learn today</em>.
        </h1>
        <p className="auth-lede">
          Every paper you are set, in one calm place — sat on the clock, handed in once, and
          handed back with the reasoning behind every mark.
        </p>

        <ol className="auth-flow">
          {FLOW.map((s) => (
            <li className="auth-flow-step" key={s.n}>
              <span className="auth-flow-n">{s.n}</span>
              <span>
                <span className="auth-flow-t">{s.t}</span>
                <span className="auth-flow-d">{s.d}</span>
              </span>
            </li>
          ))}
        </ol>

        <p className="auth-trust">
          <span>
            <Icon name="lock" size={13} /> School accounts only
          </span>
          <span>
            <Icon name="checkCircle" size={13} /> Answers saved as you go
          </span>
          <span>
            <Icon name="users" size={13} /> Full answer review, every time
          </span>
        </p>

        <div className="btn-row">
          <ThemeToggle />
          <SettingsButton onClick={() => setShowSettings(true)} />
        </div>
      </section>

      <animated.section
        className="auth-card"
        style={{ opacity: formSpring.opacity, transform: formSpring.transform }}
      >
        <div className="auth-role" role="group" aria-label="Choose your portal">
          {(['student', 'teacher'] as const).map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={role === r}
              onClick={() => {
                setRole(r)
                setError('')
                setFieldErrors({})
              }}
            >
              <span className="auth-role-name">
                <Icon name={ROLE_COPY[r].icon} size={15} />
                {ROLE_COPY[r].label}
              </span>
              <span className="auth-role-desc">{ROLE_COPY[r].desc}</span>
            </button>
          ))}
        </div>

        <form onSubmit={submit} noValidate className="stack">
          {/* Shown before anything is typed, because a dead backend otherwise
              only reveals itself after a careful, correctly filled submit. */}
          {backendDown ? (
            <p className="auth-err" role="status">
              <Icon name="warn" size={15} />
              Cannot reach the server. Start it with <code>npm run dev</code> or <code>npm start</code>.
            </p>
          ) : error ? (
            <p className="auth-err" role="alert">
              <Icon name="warn" size={15} />
              {error}
            </p>
          ) : null}

          {mode === 'register' ? (
            <Input
              label="Full name"
              required
              autoComplete="name"
              value={form.name}
              onChange={(e) => set('name')(e.target.value)}
              placeholder="e.g. Aisha Bello"
              error={fieldErrors.name}
            />
          ) : null}

          <Input
            label="Username"
            required
            affix="profile"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={form.username}
            onChange={(e) => set('username')(e.target.value)}
            placeholder="Your school username"
            hint={mode === 'register' ? '3–32 characters (letters, numbers, ., _, -)' : undefined}
            error={fieldErrors.username}
          />

          <Input
            label="Password"
            required
            affix="lock"
            type={showPassword ? 'text' : 'password'}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={form.password}
            onChange={(e) => set('password')(e.target.value)}
            placeholder={mode === 'login' ? 'Enter your password' : 'At least 6 characters'}
            hint={mode === 'register' ? 'Must be at least 6 characters' : undefined}
            error={fieldErrors.password}
            meter={
              <button
                type="button"
                className="auth-reveal"
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            }
          />

          {mode === 'register' && role === 'student' ? (
            <>
              <Input
                label="Student ID"
                value={form.studentId}
                onChange={(e) => set('studentId')(e.target.value)}
                placeholder="TGB-2026-XXXX"
                error={fieldErrors.studentId}
              />
              <Select
                label="Class"
                value={form.cls}
                onChange={(e) => set('cls')(e.target.value)}
                error={fieldErrors.cls}
              >
                <option value="">Select your class…</option>
                {CLASS_LEVELS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </>
          ) : null}

          {mode === 'register' && role === 'teacher' ? (
            <Input
              label="Teacher signup code"
              hint="Issued by the school office. Leave blank if you were not given one."
              type="password"
              autoComplete="off"
              value={form.teacherCode}
              onChange={(e) => set('teacherCode')(e.target.value)}
              placeholder="School-issued code"
            />
          ) : null}

          <Button variant="primary" size="lg" block type="submit" loading={busy}>
            {backendDown
              ? 'Server not running'
              : mode === 'login'
                ? `Sign in as ${role}`
                : `Create ${role} account`}
          </Button>
        </form>

        <p className="auth-alt">
          {mode === 'login' ? 'No account yet?' : 'Already registered?'}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login')
              setError('')
              setFieldErrors({})
              setShowRecovery(false)
            }}
          >
            {mode === 'login' ? 'Create one' : 'Sign in instead'}
          </button>
        </p>

        {showRecovery ? (
          <p className="auth-recovery" role="status">
            Password resets are handled by the school office. Contact your teacher or
            administrator for help.
          </p>
        ) : mode === 'login' ? (
          <p className="auth-recovery">
            <button type="button" onClick={() => setShowRecovery(true)}>
              Forgotten your password?
            </button>
          </p>
        ) : null}
      </animated.section>

      {showSettings && <SettingsDialog open onClose={() => setShowSettings(false)} />}
    </main>
  )
}
