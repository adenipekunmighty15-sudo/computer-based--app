import { useCallback, useEffect, useMemo, useState } from 'react'
import { api, type MyExamRow, type StudentExam } from '../api'
import { useAuth } from '../auth-context'
import { useScreenContext } from '../lib/context'
import { Kpi, KpiRow, Panel, Tag, Button, PageEnter, StatusPill } from '../components/ui'
import { DataTable, Pager, SearchBox, type Column } from '../components/data/DataTable'
import { SettingsPage, notify } from '../components/feedback'
import { Shell, type NavGroup } from '../components/shell/Shell'
import { AccountSettings, PageHead } from '../components/patterns'
import { useTableState, sortRows, paginate, useAsync } from '../lib/hooks'
import { match, navigate, useRoute } from '../lib/router'
import { dur } from '../lib/format'

import { StudentExam as ExamScreen } from './StudentExam'
import { ResultReview } from './ResultReview'

/* The student portal.

   Three places and one hard rule: a student's next action is never more than
   one click from the home screen. An exam that is waiting to be sat says
   "Start", not "Open". A paper that is done says "View result", never "View".

   An exam in progress replaces the whole shell rather than sitting inside it —
   a candidate should not be one distracted click away from the bank. */

const NAV: NavGroup[] = [
  {
    items: [
      { to: '/', label: 'My exams', icon: 'exams' },
      { to: '/results', label: 'Results', icon: 'result' },
      { to: '/profile', label: 'Profile & settings', icon: 'profile' },
      // Its own row: a candidate should be able to enlarge the type before an
      // exam without having to guess that their avatar opens settings.
      { to: '/settings', label: 'Settings', icon: 'settings' },
    ],
  },
]

export function StudentApp() {
  const { user, logout } = useAuth()
  const { setContext } = useScreenContext()
  const route = useRoute()
  const [exams, setExams] = useState<MyExamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [active, setActive] = useState<StudentExam | null>(null)
  const [starting, setStarting] = useState<number | null>(null)

  const screen = route.parts[0] ?? ''
  const review = match('/results/:id', route.path)

  useEffect(() => {
    if (!user) return
    const title = screen === 'results' ? 'Results' : screen === 'profile' ? 'Profile & settings' : screen === 'settings' ? 'Account & access' : 'My exams'
    
    if (active) {
      setContext({
        title: `Exam: ${active.title}`,
        description: `Currently sitting an exam on ${active.subject}.`,
        suggestions: ['How much time do I have left?', 'Explain the instructions for this section']
      })
    } else if (review) {
      // ResultReview has its own setContext
    } else {
      setContext({
        title: `Student Portal - ${title}`,
        description: `Managing exams and reviewing results.`,
        suggestions: [
          'What exam should I take next?',
          'How can I improve my average score?',
          'Tell me more about my study path'
        ]
      })
    }
    return () => setContext(null)
  }, [user, screen, active, review, setContext])

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      const r = await api.myExams()
      setExams(r.exams)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your exams')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const startExam = async (id: number) => {
    setStarting(id)
    try {
      const r = await api.getMyExam(id)
      setActive(r.exam)
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Could not open this exam')
      void refresh()
    } finally {
      setStarting(null)
    }
  }

  /* A paper in progress is its own world. No rail, no palette, no exit but
     finishing — the exam screen renders on its own. */
  if (active) {
    return <ExamScreen exam={active} onFinish={() => { setActive(null); void refresh() }} />
  }

  const completed = exams.filter((e) => e.completed)
  const scored = completed.filter((e) => typeof e.score === 'number')
  const average = scored.length
    ? Math.round(scored.reduce((sum, e) => sum + ((e.score ?? 0) / (e.total || 1)) * 100, 0) / scored.length)
    : null
  const outstanding = exams.filter((e) => !e.completed)

  return (
    <Shell
      groups={NAV}
      scope="Student portal"
      user={{ name: user?.name ?? '—', role: 'Student' }}
      trail={screen ? [{ label: screen === 'results' ? 'Results' : screen === 'profile' ? 'Profile & settings' : screen === 'settings' ? 'Account & access' : 'My exams' }] : undefined}
      onSettings={() => navigate('/settings')}
      onLogout={() => void logout()}
    >
      <PageEnter key={route.path}>
        {review ? (
          <ResultReview examId={Number(review.id)} onBack={() => navigate('/results')} />
        ) : screen === 'profile' ? (
          <Profile
            assigned={exams.length}
            completed={completed.length}
            average={average}
            onSignedOut={() => void logout()}
          />
        ) : screen === 'settings' ? (
          <SettingsPage onClose={() => navigate('/')} />
        ) : screen === 'results' ? (
          <Results exams={exams} loading={loading} />
        ) : (
          <Home
            exams={exams}
            loading={loading}
            error={error}
            starting={starting}
            onStart={startExam}
            outstanding={outstanding.length}
          />
        )}
      </PageEnter>

      <span className="sr-only" aria-live="polite">
        {loading ? 'Loading your exams' : `${exams.length} exams assigned`}
      </span>
    </Shell>
  )
}

/* ── Home ──────────────────────────────────────────────────────────────────
   The next exam first, then everything else. A student with three papers
   waiting does not want a grid; they want the one to sit next. */

function Home({
  exams,
  loading,
  error,
  starting,
  onStart,
  outstanding,
}: {
  exams: MyExamRow[]
  loading: boolean
  error: string
  starting: number | null
  onStart: (id: number) => void
  outstanding: number
}) {
  const next = exams.find((e) => !e.completed)

  return (
    <div className="stack loose">
      <section className="workspace-pulse student-pulse">
        <div className="workspace-pulse-copy">
          <p className="kicker">Student workspace · your pace</p>
          <h1>One focused paper at a time.</h1>
          <p>Start with the exam waiting for you. The rest can stay quiet.</p>
        </div>
        <div className="workspace-pulse-stat">
          <span className="pulse-stat-value">{outstanding}</span>
          <span className="pulse-stat-label">{outstanding === 1 ? 'paper' : 'papers'}<br />in your queue</span>
        </div>
      </section>

      <PageHead
        title="My exams"
        tagline={outstanding ? `${outstanding} waiting for you.` : 'Nothing due. Enjoy the quiet.'}
      />

      {error ? (
        <div className="notice bad">
          <span>{error}</span>
        </div>
      ) : null}

      <div className="grid col2-gap gap-loose">
        <Panel title="AI Study Path" kicker="Personalized Recommendation">
          <AIStudyPathCard />
        </Panel>

        <div className="stack loose">
          {next ? (
            <Panel kicker="Do this next" title={next.title}>
              <div className="row-between wrap">
                <div className="col">
                  <StatusPill tone="chalk" icon="clock">
                    {dur(next.duration_minutes * 60_000)} · {next.subject ?? 'Assessment'}
                  </StatusPill>
                  <span className="cell-sub">
                    {[next.subject, next.class_level].filter(Boolean).join(' · ') || 'Uncategorised'}
                  </span>
                </div>
                <Button
                  variant="primary"
                  size="lg"
                  loading={starting === next.id}
                  onClick={() => onStart(next.id)}
                  data-tip="The timer starts as soon as you open it"
                >
                  Start exam
                </Button>
              </div>
            </Panel>
          ) : null}

          <Panel kicker="Everything assigned" title="All exams" flush>
            <DataTable<MyExamRow>
              rows={exams}
              columns={columns()}
              rowKey={(e) => e.id}
              loading={loading}
              emptyTitle="No exams assigned yet"
              emptyBody="When a teacher assigns an assessment it will appear here, ready to start."
              onRowClick={(e) => (e.completed ? navigate(`/results/${e.id}`) : onStart(e.id))}
              footNote={
                <span className="cell-sub">An exam cannot be reopened once submitted.</span>
              }
            />
          </Panel>
        </div>
      </div>
    </div>
  )
}

function columns(): Column<MyExamRow>[] {
  return [
    {
      key: 'title',
      label: 'Exam',
      pin: 'left',
      width: 240,
      cell: (e) => (
        <div className="min-w-0">
          <div className="cell-strong truncate">{e.title}</div>
          <div className="cell-sub truncate">{[e.subject, e.class_level].filter(Boolean).join(' · ')}</div>
        </div>
      ),
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
      key: 'status',
      label: 'Status',
      width: 130,
      sort: (e) => (e.completed ? 1 : 0),
      cell: (e) =>
        e.completed ? <Tag tone="jade" dot>Submitted</Tag> : <Tag tone="brass" dot>Not started</Tag>,
    },
    {
      key: 'score',
      label: 'Score',
      width: 110,
      align: 'right',
      sort: (e) => e.score ?? null,
      cell: (e) =>
        typeof e.score === 'number' ? (
          <span className="cell-num">
            {e.score}/{e.total}
          </span>
        ) : (
          <span className="cell-sub">—</span>
        ),
    },
  ]
}

/* ── Results ───────────────────────────────────────────────────────────────
   The one screen a student returns to after every paper, so it is a table and
   not a pile of cards: the scores line up, and the worst one is findable. */

function Results({ exams, loading }: { exams: MyExamRow[]; loading: boolean }) {
  const t = useTableState('date')
  const done = useMemo(() => exams.filter((e) => e.completed), [exams])

  const rows = useMemo(() => {
    const terms = t.q.trim().toLowerCase()
    const hit = terms
      ? done.filter((e) => `${e.title} ${e.subject ?? ''}`.toLowerCase().includes(terms))
      : done
    return sortRows(hit, t.sort, t.dir, (e) => {
      switch (t.sort) {
        case 'title':
          return e.title
        case 'score':
          return e.score ?? null
        case 'percent':
          return e.total ? Math.round(((e.score ?? 0) / e.total) * 100) : null
        default:
          return e.submitted_at ?? null
      }
    })
  }, [done, t.q, t.sort, t.dir])

  const page = paginate(rows, t.page, t.per)

  const cols = useMemo<Column<MyExamRow>[]>(
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
            <div className="cell-sub truncate">{[e.subject, e.class_level].filter(Boolean).join(' · ')}</div>
          </div>
        ),
      },
      {
        key: 'score',
        label: 'Score',
        width: 110,
        align: 'right',
        sort: (e) => e.score ?? null,
        cell: (e) => <span className="cell-num">{e.score ?? 0}/{e.total ?? 0}</span>,
      },
      {
        key: 'percent',
        label: 'Percent',
        width: 110,
        align: 'right',
        sort: (e) => (e.total ? ((e.score ?? 0) / e.total) * 100 : null),
        cell: (e) => {
          const p = e.total ? Math.round(((e.score ?? 0) / e.total) * 100) : 0
          return <Tag tone={p >= 50 ? 'jade' : 'vermilion'}>{p}%</Tag>
        },
      },
      {
        key: 'date',
        label: 'Submitted',
        width: 140,
        sort: (e) => e.submitted_at ?? null,
        cell: (e) => <span className="cell-sub">{e.submitted_at ? new Date(e.submitted_at).toLocaleDateString('en-GB') : '—'}</span>,
      },
    ],
    [],
  )

  return (
    <div className="stack loose">
      <PageHead title="Results" tagline="Every submitted paper, with the full answer review." />

      <Panel kicker="The record" title="Submitted exams" flush>
        <DataTable<MyExamRow>
          rows={page}
          columns={cols}
          rowKey={(e) => e.id}
          sort={t.sort}
          dir={t.dir}
          onSort={t.setSort}
          onRowClick={(e) => navigate(`/results/${e.id}`)}
          loading={loading}
          cols={t.cols}
          onCols={t.setCols}
          allKeys={rows.map((e) => e.id)}
          maxHeight={520}
          toolbar={
            <SearchBox
              value={t.q}
              onChange={(v) => t.patch({ q: v || null, page: null })}
              placeholder="Search results"
            />
          }
          emptyTitle="No results yet"
          emptyBody="Once you submit an exam it is marked and filed here."
        />
        <Pager page={t.page} per={t.per} total={rows.length} onPage={t.setPage} onPer={t.setPer} />
      </Panel>
    </div>
  )
}

/* ── Profile ───────────────────────────────────────────────────────────────
   Progress first, then the account. A pupil comes here after a paper to see a
   number and to fix a mistyped name — not to read a form. The account half is
   the shared AccountSettings pattern, so teacher and student change their
   details the same way. */

function Profile({
  assigned,
  completed,
  average,
  onSignedOut,
}: {
  assigned: number
  completed: number
  average: number | null
  onSignedOut: () => void
}) {
  return (
    <div className="stack loose">
      <PageHead title="Profile & settings" tagline="Your progress and your account details." />

      <KpiRow>
        <Kpi label="Assigned" icon="exams" value={assigned} />
        <Kpi label="Completed" icon="checkCircle" value={completed} />
        <Kpi
          label="Average"
          icon="award"
          value={average === null ? '—' : average}
          unit={average === null ? undefined : '%'}
          tone={average === null ? undefined : average >= 50 ? 'jade' : 'vermilion'}
        />
      </KpiRow>

      <AccountSettings onSignedOut={onSignedOut} />
    </div>
  )
}

function AIStudyPathCard() {
  const { data, loading, error } = useAsync(() => api.myRecommendations(), [])

  if (loading) return <div className="p-loose cell-sub">Analyzing your performance...</div>
  if (error) return <div className="p-loose text-bad">{error}</div>
  if (!data) return null

  return (
    <div className="p-loose stack small">
      <p className="text-pretty">{data.summary}</p>
      
      {data.recommendations.length > 0 && (
        <div className="stack tiny">
          <label className="kicker">Recommended for you</label>
          <ul className="list-bullet cell-sub">
            {data.recommendations.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
