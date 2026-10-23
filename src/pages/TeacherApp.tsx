import { useEffect, useMemo, useState } from 'react'
import { api, type ExamSummary } from '../api'
import { useAuth } from '../auth-context'
import { useScreenContext } from '../lib/context'
import { Kpi, KpiRow, Panel, Button, PageEnter, Icon, BootScreen } from '../components/ui'
import { DataTable, Pager, SearchBox, type Column, type RowAction } from '../components/data/DataTable'
import { SettingsPage } from '../components/feedback'
import { Shell, type NavGroup } from '../components/shell/Shell'
import { AccountSettings, PageHead } from '../components/patterns'
import { useAsync, useSubjectStatus, useTableState, sortRows, paginate } from '../lib/hooks'
import { match, navigate, useRoute } from '../lib/router'
import { downloadCsv } from '../lib/csv'
import { ago, dateShort, dur } from '../lib/format'

import { Bank } from './teacher/Bank'
import { Builder } from './teacher/Builder'
import { Exams } from './teacher/Exams'
import { Results } from './teacher/Results'
import { AILab } from './teacher/AILab'
import { ExamSheetTool } from './teacher/ExamSheet'
import { SubjectOnboarding } from './teacher/SubjectOnboarding'

/* The teacher portal.

   Four places, and the rail is the only way between them. Every destination is
   a real URL so a filtered bank or a single exam's results can be sent to a
   colleague, bookmarked, or reached with the Back button.

   The dashboard follows one rule — summary numbers first, then the things that
   need a decision, then the full record. You should never have to scroll to
   find out how big the problem is. */

const NAV: NavGroup[] = [
  {
    items: [
      { to: '/', label: 'Dashboard', icon: 'dashboard' },
      { to: '/bank', label: 'Question bank', icon: 'bank' },
      { to: '/builder', label: 'Exam builder', icon: 'builder' },
      { to: '/sheet', label: 'Exam sheet', icon: 'file' },
    ],
  },
  {
    label: 'Run',
    items: [
      { to: '/exams', label: 'Exams & results', icon: 'exams' },
      { to: '/ai', label: 'AI Lab', icon: 'ai' },
    ],
  },
  {
    label: 'You',
    items: [
      { to: '/profile', label: 'Profile & settings', icon: 'profile' },
      // Settings is a row of its own rather than something you find by
      // clicking your own avatar. Reading and motion preferences apply to every
      // screen; hiding them behind a profile picture meant most teachers never
      // found them.
      { to: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
]

export function TeacherApp() {
  const { user, logout } = useAuth()
  const { setContext } = useScreenContext()
  const route = useRoute()

  /* Gate: a teacher with no saved subjects lands on the onboarding picker, not
     the dashboard, because every dashboard number means something chosen first.
     Fails open — a network error must never trap a teacher inside the picker
     with no way to reach the app, so on error we let them through and the
     dashboard's own error banners take over. */
  const [hasSubjects, setHasSubjects] = useState<boolean | null>(null)
  useEffect(() => {
    let live = true
    api
      .mySubjects()
      .then((r) => live && setHasSubjects(r.subjects.length > 0))
      .catch(() => live && setHasSubjects(true))
    return () => {
      live = false
    }
  }, [])

  const results = match('/exams/:id/results', route.path)
  const screen = route.parts[0] ?? ''

  const title =
    screen === 'bank'
      ? 'Question bank'
      : screen === 'builder'
        ? 'Exam builder'
        : screen === 'sheet'
          ? 'Exam sheet'
          : screen === 'exams'
            ? 'Exams & results'
            : screen === 'ai'
              ? 'AI Lab'
              : screen === 'profile'
                ? 'Profile & settings'
                : screen === 'settings'
                  ? 'Account & access'
                : 'Dashboard'

  useEffect(() => {
    if (!user || hasSubjects === false) return
    if (results) {
      setContext({
        title: `Exam Results #${results.id}`,
        description: `Analyzing student performance for exam ${results.id}.`,
        suggestions: ['Summarize the class weak points', 'Compare this to the previous exam', 'Who are the top performers?']
      })
    } else {
      setContext({
        title: `Teacher Portal - ${title}`,
        description: `Managing the ${title.toLowerCase()} for your classes.`,
        suggestions: [
          'How do I build a more challenging exam?',
          'Suggest a topic for a JSS3 Physics quiz',
          'Explain the class insights'
        ]
      })
    }
    return () => setContext(null)
  }, [user, screen, results, title, setContext, hasSubjects])

  if (hasSubjects === null) return <BootScreen line="Opening your workspace" />
  if (!hasSubjects) return <SubjectOnboarding onDone={() => setHasSubjects(true)} />

  return (
    <Shell
      groups={NAV}
      scope="Teacher portal"
      user={{ name: user?.name ?? '—', role: 'Teacher' }}
      trail={
        results
          ? [{ label: 'Exams & results', to: '/exams' }, { label: `Results #${results.id}` }]
          : screen
            ? [{ label: title }]
            : undefined
      }
      commands={[
        { id: 'new-exam', label: 'Build a new exam', icon: 'plus', run: () => navigate('/builder') },
        { id: 'generate', label: 'Generate questions with AI', icon: 'sparkle', run: () => navigate('/ai') },
      ]}
      onSettings={() => navigate('/settings')}
      onLogout={() => void logout()}
    >
      <PageEnter key={route.path}>
        {results ? (
          <Results examId={Number(results.id)} onBack={() => navigate('/exams')} />
        ) : screen === 'bank' ? (
          <Bank />
        ) : screen === 'builder' ? (
          <Builder />
        ) : screen === 'sheet' ? (
          <ExamSheetTool />
        ) : screen === 'exams' ? (
          <Exams />
        ) : screen === 'ai' ? (
          <AILab />
        ) : screen === 'profile' ? (
          <TeacherProfile />
        ) : screen === 'settings' ? (
          <SettingsPage onClose={() => navigate('/')} />
        ) : (
          <Dashboard />
        )}
      </PageEnter>

    </Shell>
  )
}

/* ── Profile ───────────────────────────────────────────────────────────────
   The teacher's own account, reachable as a real URL so it can be linked to.
   The dialog is the quick path; this is the one that survives a reload. */

function TeacherProfile() {
  const { logout } = useAuth()

  return (
    <div className="stack loose">
      <PageHead title="Profile & settings" tagline="Your account, your password, and the way out." />
      <AccountSettings onSignedOut={() => void logout()} />
    </div>
  )
}

interface Stats {
  questions: number
  exams: number
  students: number
}

function Dashboard() {
  const t = useTableState('created')
  const banks = useSubjectStatus()
  const { data, error, loading } = useAsync<{ stats: Stats; exams: ExamSummary[] }>(async () => {
    const [q, e, s] = await Promise.all([api.listQuestions(), api.listExams(), api.listStudents()])
    return {
      stats: { questions: q.questions.length, exams: e.exams.length, students: s.students.length },
      exams: e.exams,
    }
  }, [])

  const stats = data?.stats
  const exams = useMemo(() => data?.exams ?? [], [data])

  /* Search and sort happen here, in the browser, because a school bank is a
     few hundred rows — a round trip to filter them would be slower and would
     make the input feel broken. */
  const filtered = useMemo(() => {
    const terms = t.q.trim().toLowerCase()
    const hit = terms
      ? exams.filter((e) => `${e.title} ${e.subject ?? ''} ${e.class_level ?? ''}`.toLowerCase().includes(terms))
      : exams
    return sortRows(hit, t.sort, t.dir, (e) => pick(e, t.sort))
  }, [exams, t.q, t.sort, t.dir])

  const page = paginate(filtered, t.page, t.per)

  const columns = useMemo<Column<ExamSummary>[]>(
    () => [
      {
        key: 'title',
        label: 'Exam',
        pin: 'left',
        width: 260,
        sort: (e) => e.title,
        cell: (e) => (
          <div className="min-w-0">
            <div className="cell-strong truncate">{e.title}</div>
            <div className="cell-sub truncate">{[e.subject, e.class_level].filter(Boolean).join(' · ') || 'Uncategorised'}</div>
          </div>
        ),
      },
      {
        key: 'questions',
        label: 'Questions',
        width: 100,
        align: 'right',
        sort: (e) => e.questions.length,
        cell: (e) => <span className="cell-num">{e.questions.length}</span>,
      },
      {
        key: 'duration',
        label: 'Duration',
        width: 110,
        align: 'right',
        sort: (e) => e.duration_minutes,
        cell: (e) => <span className="cell-num">{dur(e.duration_minutes * 60_000)}</span>,
      },
      {
        key: 'created',
        label: 'Built',
        width: 130,
        sort: (e) => e.created_at,
        cell: (e) => (
          <span className="cell-sub" title={dateShort(e.created_at)}>
            {ago(e.created_at)}
          </span>
        ),
      },
    ],
    [],
  )

  const actions = useMemo(
    () => () => [
      {
        label: 'Results',
        icon: 'chart',
        always: true,
        onRun: (e: ExamSummary) => navigate(`/exams/${e.id}/results`),
      },
    ] as RowAction<ExamSummary>[],
    [],
  )

  /* The middle band. It says nothing when there is nothing wrong, because a
     strip that is always present trains people to stop reading it. */
  const attention = useMemo(() => {
    const out: { tone: 'warn' | 'bad' | 'info'; title: string; body: string; go: string; cta: string }[] = []

    const preparing = banks.subjects.filter((s) => s.status !== 'ready')
    if (preparing.length > 0)
      out.push({
        tone: 'info',
        title: `${preparing.length} question bank${preparing.length === 1 ? '' : 's'} still preparing`,
        body: `${preparing
          .slice(0, 3)
          .map((s) => `${s.subject} · ${s.level}`)
          .join(', ')}${preparing.length > 3 ? ` and ${preparing.length - 3} more` : ''}. You can keep working — the banks finish in the background.`,
        go: '/profile',
        cta: 'Track progress',
      })

    if (stats && stats.questions === 0)
      out.push({
        tone: 'info',
        title: 'Your question bank is empty',
        body: 'Generate a starter set in the AI Lab, or add questions by hand.',
        go: '/ai',
        cta: 'Open AI Lab',
      })
    if (stats && stats.exams === 0)
      out.push({
        tone: 'info',
        title: 'No exams built yet',
        body: 'Pick questions from the bank and arrange them into a paper.',
        go: '/builder',
        cta: 'Build an exam',
      })
    if (stats && stats.exams > 0 && stats.students === 0)
      out.push({
        tone: 'warn',
        title: 'No students on the roll',
        body: 'Exams can be built, but nobody can be assigned one until a student account exists.',
        go: '/exams',
        cta: 'Go to exams',
      })
    return out
  }, [stats, banks.subjects])

  return (
    <div className="stack loose">
      <section className="workspace-pulse teacher-pulse">
        <div className="workspace-pulse-copy">
          <p className="kicker">Teacher workspace · live overview</p>
          <h1>Make the next paper count.</h1>
          <p>Shape a better question, then give it somewhere useful to go.</p>
        </div>
        <div className="workspace-pulse-orbit" aria-hidden="true">
          <span className="orbit-ring ring-one" />
          <span className="orbit-ring ring-two" />
          <span className="orbit-core"><Icon name="sparkle" size={20} /></span>
          <span className="orbit-note note-one">curiosity</span>
          <span className="orbit-note note-two">clarity</span>
        </div>
      </section>

      <PageHead
        title="Dashboard"
        tagline="Your question lab at a glance."
        actions={
          <>
            <Button variant="secondary" icon="bank" onClick={() => navigate('/bank')}>
              Question bank
            </Button>
            <Button variant="primary" icon="plus" onClick={() => navigate('/builder')}>
              New exam
            </Button>
          </>
        }
      />

      {error ? <Notice tone="bad">{error}</Notice> : null}

      <KpiRow>
        <Kpi label="Bank questions" icon="bank" value={loading ? '—' : stats?.questions ?? 0} href="/bank" />
        <Kpi label="Exams" icon="exams" value={loading ? '—' : stats?.exams ?? 0} href="/exams" />
        <Kpi label="Students" icon="students" value={loading ? '—' : stats?.students ?? 0} />
        <Kpi
          label="Needs a decision"
          icon="flag"
          tone={attention.length ? 'brass' : undefined}
          value={attention.length || '—'}
          foot={attention.length ? 'see below' : 'nothing outstanding'}
        />
      </KpiRow>

      {attention.length ? (
        <div className="attention">
          {attention.map((a) => (
            <button key={a.title} className={`attention-item ${a.tone}`} onClick={() => navigate(a.go)}>
              <span className="att-mark">
                <Icon name={a.tone === 'bad' ? 'warn' : a.tone === 'warn' ? 'flag' : 'info'} size={13} />
              </span>
              <span className="grow">
                <span className="att-title">{a.title}</span>
                <span className="att-body">{a.body}</span>
              </span>
              <span className="att-go">
                {a.cta} <Icon name="chevronRight" size={13} />
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid col2-gap gap-loose">
        <Panel title="AI Class Insights" kicker="Analysis">
          <AIInsightsCard />
        </Panel>

        <Panel
          kicker="The record"
          title="Recent exams"
        actions={
          <Button variant="ghost" size="sm" iconRight="arrowRight" onClick={() => navigate('/exams')}>
            All exams
          </Button>
        }
        flush
      >
        <DataTable<ExamSummary>
          rows={page}
          columns={columns}
          rowKey={(e) => e.id}
          sort={t.sort}
          dir={t.dir}
          onSort={t.setSort}
          onRowClick={(e) => navigate(`/exams/${e.id}/results`)}
          actions={actions}
          loading={loading}
          cols={t.cols}
          onCols={t.setCols}
          allKeys={filtered.map((e) => e.id)}
          maxHeight={420}
          toolbar={
            <SearchBox
              value={t.q}
              onChange={(v) => t.patch({ q: v || null, page: null })}
              placeholder="Search exams"
            />
          }
          onExport={() =>
            downloadCsv(
              'exams',
              ['Title', 'Subject', 'Class', 'Questions', 'Duration (min)', 'Built'],
              filtered.map((e) => [e.title, e.subject ?? '', e.class_level ?? '', e.questions.length, e.duration_minutes, dateShort(e.created_at)]),
            )
          }
          emptyTitle="No exams yet"
          emptyBody="An exam you build will appear here, with its results one click away."
          emptyAction={{ label: 'Build your first exam', icon: 'plus', onClick: () => navigate('/builder') }}
          footNote={
            filtered.length ? (
              <span>
                Showing {page.length} of {filtered.length}
              </span>
            ) : null
          }
        />
        <Pager page={t.page} per={t.per} total={filtered.length} onPage={t.setPage} onPer={t.setPer} />
      </Panel>
      </div>
    </div>
  )
}

/* Sort keys are named in the URL, so the pick has to be a lookup rather than a
   property path — `title` and `created` are not fields on the row. */
function pick(e: ExamSummary, key: string): string | number | null {
  switch (key) {
    case 'title':
      return e.title
    case 'questions':
      return e.questions.length
    case 'duration':
      return e.duration_minutes
    case 'created':
      return e.created_at
    default:
      return null
  }
}

function Notice({ tone, children }: { tone: 'bad'; children: string }) {
  return (
    <div className={`notice ${tone}`}>
      <Icon name="warn" size={15} />
      <span>{children}</span>
    </div>
  )
}

function AIInsightsCard() {
  const { data, loading, error, reload } = useAsync(() => api.getClassInsights(), [])

  if (loading) return <div className="p-loose cell-sub">Analyzing class performance...</div>
  if (error) return <div className="p-loose text-bad">{error}</div>
  if (!data || !data.summary) return null

  return (
    <div className="p-loose stack small">
      <p className="text-pretty">{data.summary}</p>
      
      {data.weakTopics.length > 0 && (
        <div className="stack tiny">
          <label className="kicker text-bad">Weak Topics</label>
          <div className="cluster gap-tiny">
            {data.weakTopics.map(t => <span key={t} className="badge bad">{t}</span>)}
          </div>
        </div>
      )}

      {data.nextSteps.length > 0 && (
        <div className="stack tiny">
          <label className="kicker">Next Steps</label>
          <ul className="list-bullet cell-sub">
            {data.nextSteps.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}

      <Button variant="ghost" size="sm" icon="refresh" onClick={reload}>
        Refresh Insights
      </Button>
    </div>
  )
}
