import { useState, type ReactNode } from 'react'
import { api } from '../../api'
import { useAuth } from '../../auth-context'
import { Button, Input, Panel, Tag } from '../ui'
import { ConfirmDialog, notify } from '../feedback'
import { useSubjectStatus } from '../../lib/hooks'
import { subjectKey, type TeacherSubject } from '../../lib/school'
import { SubjectPicker } from './SubjectPicker'
import type { SubjectRow } from '../../api'

/* Who you are, and the door out.

   One pattern rather than a page per portal, because there is nothing
   role-specific to draw: a teacher and a pupil both want to fix a typo in their
   name, change a password, and sign out. The only difference is that a student
   also has a student ID and a class, so those two fields appear for them.

   The identity itself — username and role — is shown, never edited. The
   username is the name the school's register knows you by and the role is the
   security boundary; letting either be typed here would let a pupil promote
   themselves by editing a field. */

function Section({
  kicker,
  title,
  embedded,
  children,
}: {
  kicker: string
  title: string
  embedded?: boolean
  children: ReactNode
}) {
  /* Inside a dialog a Panel would be a box inside a box, so the same section is
     drawn with a heading rule instead. The wording and behaviour do not change. */
  if (!embedded) {
    return (
      <Panel kicker={kicker} title={title}>
        {children}
      </Panel>
    )
  }
  return (
    <section className="stack">
      <div className="settings-section-head">
        <p className="kicker">{kicker}</p>
        <h3>{title}</h3>
      </div>
      {children}
    </section>
  )
}

export function AccountSettings({
  onSignedOut,
  embedded = false,
}: {
  onSignedOut?: () => void
  /** Drops the panel chrome when it sits inside a dialog rather than a page. */
  embedded?: boolean
}) {
  const { user } = useAuth()

  /* Keyed on the values the fields are seeded from, so a saved edit — from
     here or from the dialog — re-seeds the form instead of leaving it holding
     a stale draft that would happily save the old value straight back. */
  const seed = [user?.id, user?.name, user?.student_id, user?.class].join('\u0000')

  return <AccountForm key={seed} onSignedOut={onSignedOut} embedded={embedded} />
}

function AccountForm({
  onSignedOut,
  embedded,
}: {
  onSignedOut?: () => void
  embedded: boolean
}) {
  const { user, setUser, logout } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [studentId, setStudentId] = useState(user?.student_id ?? '')
  const [cls, setCls] = useState(user?.class ?? '')
  const [savingProfile, setSavingProfile] = useState(false)

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [savingPassword, setSavingPassword] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [confirmSignOut, setConfirmSignOut] = useState(false)

  const isStudent = user?.role === 'student'

  const saveProfile = async () => {
    if (!name.trim()) {
      notify('error', 'Your name cannot be empty')
      return
    }
    setSavingProfile(true)
    try {
      const patch: { name?: string; studentId?: string; cls?: string } = { name: name.trim() }
      if (isStudent) {
        patch.studentId = studentId.trim()
        patch.cls = cls.trim()
      }
      const r = await api.updateProfile(patch)
      setUser(r.user)
      notify('success', 'Your details are saved')
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Could not save your details')
    } finally {
      setSavingProfile(false)
    }
  }

  const savePassword = async () => {
    if (next.length < 6) {
      setPasswordError('New password must be at least 6 characters')
      return
    }
    if (next !== confirm) {
      setPasswordError('The two new passwords do not match')
      return
    }
    setPasswordError(null)
    setSavingPassword(true)
    try {
      await api.changePassword(current, next)
      /* A typed password is never kept in state once it has been used. */
      setCurrent('')
      setNext('')
      setConfirm('')
      notify('success', 'Password changed. Other devices have been signed out.')
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Could not change your password')
    } finally {
      setSavingPassword(false)
    }
  }

  const signOut = async () => {
    setSigningOut(true)
    setConfirmSignOut(false)
    try {
      await logout()
      onSignedOut?.()
    } finally {
      setSigningOut(false)
    }
  }

  const profileDirty =
    name !== (user?.name ?? '') ||
    (isStudent && (studentId !== (user?.student_id ?? '') || cls !== (user?.class ?? '')))

  return (
    <div className="stack loose">
      <Section kicker="Your details" title="Profile" embedded={embedded}>
        <div className="stack">
          <Input
            label="Full name"
            required
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            hint="This is the name printed on exam papers and result sheets."
          />

          {isStudent ? (
            <div className="grid-2">
              <Input
                label="Student ID"
                value={studentId}
                maxLength={40}
                onChange={(e) => setStudentId(e.target.value)}
                hint="Leave blank if your school does not use one."
              />
              <Input
                label="Class"
                value={cls}
                maxLength={80}
                onChange={(e) => setCls(e.target.value)}
                hint="For example SS3 or JSS1."
              />
            </div>
          ) : null}

          <dl className="detail-list">
            <div>
              <dt>Username</dt>
              <dd>{user?.username || '—'}</dd>
            </div>
            <div>
              <dt>Role</dt>
              <dd>{isStudent ? 'Student' : 'Teacher'}</dd>
            </div>
          </dl>

          <p className="hint">
            Your username and role are set by the school and cannot be changed here.
          </p>

          <div className="row-end">
            <Button
              variant="primary"
              icon="check"
              loading={savingProfile}
              disabled={!profileDirty}
              onClick={saveProfile}
            >
              Save details
            </Button>
          </div>
        </div>
      </Section>

      {!isStudent ? <SubjectsSection embedded={embedded} /> : null}

      <Section kicker="Security" title="Change password" embedded={embedded}>
        <div className="stack">
          <Input
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
          <div className="grid-2">
            <Input
              label="New password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              hint="At least 6 characters."
            />
            <Input
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              error={passwordError}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          <p className="hint">
            Changing your password signs out every other device, including a browser left open on a
            shared lab machine.
          </p>
          <div className="row-end">
            <Button
              variant="secondary"
              icon="lock"
              loading={savingPassword}
              disabled={!current || !next || !confirm}
              onClick={savePassword}
            >
              Change password
            </Button>
          </div>
        </div>
      </Section>

      <Section kicker="Session" title="Sign out" embedded={embedded}>
        <div className="row-between wrap">
          <p className="grow hint">
            Signs you out of this device. Reading and accessibility settings stay as they are.
          </p>
          <Button variant="danger" icon="logout" loading={signingOut} onClick={() => setConfirmSignOut(true)}>
            Sign out
          </Button>
        </div>
      </Section>

      {confirmSignOut ? (
        <ConfirmDialog
          title="Sign out?"
          body="You will be returned to the login screen. Any exam in progress stays saved."
          detail={<p className="hint">You can sign back in with the same username and password.</p>}
          confirmLabel="Sign out"
          busy={signingOut}
          onConfirm={signOut}
          onCancel={() => setConfirmSignOut(false)}
        />
      ) : null}
    </div>
  )
}

const SUBJECT_STATUS_META: Record<SubjectRow['status'], { tone: 'neutral' | 'chalk' | 'brass' | 'jade'; label: (r: SubjectRow) => string }> = {
  pending: { tone: 'neutral', label: () => 'Queued' },
  generating: { tone: 'chalk', label: () => 'Preparing bank…' },
  partial: { tone: 'brass', label: (r) => `${r.count} of ${r.target} ready` },
  ready: { tone: 'jade', label: (r) => `${r.count} ready` },
}

/* What a teacher teaches, kept just here so it can be picked back up later.
   Editing is explicit — tap "Change subjects" to open the picker, save, and the
   list swaps to the live pills. While any bank is still preparing the status
   refreshes in the background on its own. */
function SubjectsSection({ embedded }: { embedded: boolean }) {
  const { subjects, loading, error, refresh } = useSubjectStatus()
  const [editing, setEditing] = useState(false)
  const [sel, setSel] = useState<TeacherSubject[]>([])
  const [saving, setSaving] = useState(false)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const startEdit = () => {
    setSel(subjects.map((s) => ({ subject: s.subject, level: s.level })))
    setErrMsg(null)
    setEditing(true)
  }

  const save = async () => {
    if (sel.length === 0) {
      setErrMsg('Choose at least one subject')
      return
    }
    setSaving(true)
    setErrMsg(null)
    try {
      await api.saveMySubjects(sel)
      setEditing(false)
      notify('success', 'Subjects saved. Your question banks are updating in the background.')
      refresh()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Could not save your subjects')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section kicker="Your subjects" title="Banks I teach" embedded={embedded}>
      {editing ? (
        <>
          <SubjectPicker value={sel} onChange={setSel} max={12} />
          {errMsg ? (
            <p className="notice bad" role="alert">
              {errMsg}
            </p>
          ) : null}
          <div className="row-end">
            <Button variant="quiet" onClick={() => setEditing(false)} disabled={saving}>
              Cancel
            </Button>
            <Button variant="primary" icon="check" loading={saving} disabled={sel.length === 0} onClick={() => void save()}>
              Save subjects
            </Button>
          </div>
        </>
      ) : loading && subjects.length === 0 ? (
        <p className="hint">Loading…</p>
      ) : error ? (
        <p className="notice bad" role="alert">
          {error}
        </p>
      ) : subjects.length === 0 ? (
        <div className="stack">
          <p className="hint">
            No subjects chosen yet. Choosing what you teach lets the app prepare starter question
            banks for you.
          </p>
          <div className="row-end">
            <Button variant="secondary" icon="plus" onClick={startEdit}>
              Choose subjects
            </Button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <ul className="bank-status-list">
            {subjects.map((s) => {
              const meta = SUBJECT_STATUS_META[s.status]
              return (
                <li className="bank-status-row" key={subjectKey(s)}>
                  <span className="bank-status-name">
                    <span className="bank-status-level">{s.level}</span>
                    <span>{s.subject}</span>
                  </span>
                  <Tag tone={meta.tone} dot>
                    {meta.label(s)}
                  </Tag>
                </li>
              )
            })}
          </ul>
          <div className="row-end">
            <Button variant="secondary" icon="plus" onClick={startEdit}>
              Change subjects
            </Button>
          </div>
        </div>
      )}
    </Section>
  )
}
