import { useState } from 'react'
import { api, type SubjectRow } from '../../api'
import { Button, Icon, Seal, Tag } from '../../components/ui'
import { SubjectPicker } from '../../components/patterns'
import { useSubjectStatus } from '../../lib/hooks'
import { subjectKey, type TeacherSubject } from '../../lib/school'

/* First-run gate for every teacher: choose what you teach, once.

   The teacher portal needs subjects before the dashboard numbers mean anything
   — a bank with no author is an empty bank, and an untagged bank prepares
   questions nobody asked for. So this screen replaces the whole shell until at
   least one (subject, level) is saved. It does NOT wait for the AI: save
   answers instantly, the pills start filling in, and "Go to dashboard" is
   available the same moment. */

const STATUS_META: Record<SubjectRow['status'], { tone: 'neutral' | 'chalk' | 'brass' | 'jade'; label: (r: SubjectRow) => string }> = {
  pending: { tone: 'neutral', label: () => 'Queued' },
  generating: { tone: 'chalk', label: () => 'Preparing bank…' },
  partial: { tone: 'brass', label: (r) => `${r.count} of ${r.target} ready` },
  ready: { tone: 'jade', label: (r) => `${r.count} ready` },
}

function BankStatusRow({ row }: { row: SubjectRow }) {
  const meta = STATUS_META[row.status]
  return (
    <li className="bank-status-row">
      <span className="bank-status-name">
        <span className="bank-status-level">{row.level}</span>
        <span>{row.subject}</span>
      </span>
      <Tag tone={meta.tone} dot>
        {meta.label(row)}
      </Tag>
    </li>
  )
}

export function SubjectOnboarding({ onDone }: { onDone: () => void }) {
  const [sel, setSel] = useState<TeacherSubject[]>([])
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { subjects, loading, error, refresh } = useSubjectStatus()

  const save = async () => {
    if (sel.length === 0) {
      setSaveError('Choose at least one subject to continue.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      await api.saveMySubjects(sel)
      setSaved(true)
      refresh()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save your subjects')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="onboarding" data-role="teacher">
      <section className="onboarding-card">
        <div className="onboarding-head">
          <p className="onboarding-school">
            <Seal />
            <span>T. Gold Brighter Tomorrow · Model School</span>
          </p>
          <h1>What do you teach?</h1>
          <p className="hint">
            This is how your question banks are prepared, one phase at a time. You can change these
            anytime in <strong>Profile &amp; settings</strong>.
          </p>
        </div>

        <div className="onboarding-body">
          <section className="panel onboarding-pick" aria-label="Your subjects">
            <p className="kicker">Your subjects</p>
            <SubjectPicker value={sel} onChange={setSel} max={12} />
            {saveError ? (
              <p className="notice bad" role="alert">
                <Icon name="warn" size={15} />
                <span>{saveError}</span>
              </p>
            ) : null}
            {!saved ? (
              <div className="row-end">
                <Button
                  variant="primary"
                  icon="check"
                  loading={saving}
                  disabled={sel.length === 0}
                  onClick={() => void save()}
                >
                  Save my subjects
                </Button>
              </div>
            ) : null}
          </section>

          <aside className="panel onboarding-status" aria-label="Question bank progress">
            <p className="kicker">Your question banks</p>
            {!saved ? (
              <p className="hint">Banks appear here the moment you save your subjects.</p>
            ) : loading && subjects.length === 0 ? (
              <p className="hint">Checking…</p>
            ) : error ? (
              <p className="notice bad">
                <Icon name="warn" size={15} />
                <span>{error}</span>
              </p>
            ) : (
              <ul className="bank-status-list">
                {subjects.map((s) => (
                  <BankStatusRow key={subjectKey(s)} row={s} />
                ))}
              </ul>
            )}
            <div className="row-end">
              <Button
                variant="primary"
                iconRight="arrowRight"
                disabled={!saved}
                onClick={onDone}
              >
                Go to dashboard
              </Button>
            </div>
            {saved ? (
              <p className="hint">Banks keep preparing in the background while you work.</p>
            ) : null}
          </aside>
        </div>
      </section>
    </main>
  )
}