import { useEffect, useState } from 'react'
import { api, type ExamStudentResult, type PerQuestionStat, type ResultRow } from '../../api'
import { MathText, Skeleton, EmptyState, Spinner } from '../../components/ui'
import { notify } from '../../components/feedback'
import { ResultDocuments } from '../../components/patterns/ResultDocuments'

export function Results({ examId, onBack }: { examId: number; onBack: () => void }) {
  const [title, setTitle] = useState('')
  const [results, setResults] = useState<ResultRow[]>([])
  const [perQuestion, setPerQuestion] = useState<PerQuestionStat[]>([])
  const [assignedCount, setAssignedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [studentResult, setStudentResult] = useState<ExamStudentResult | null>(null)
  const [detailLoading, setDetailLoading] = useState<number | null>(null)

  useEffect(() => {
    api
      .examResults(examId)
      .then((r) => {
        setTitle(r.exam.title)
        setResults(r.results)
        setPerQuestion(r.perQuestion)
        setAssignedCount(r.assignedCount)
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load results'))
      .finally(() => setLoading(false))
  }, [examId])

  const avg = results.length ? results.reduce((a, r) => a + (r.score / (r.total || 1)) * 100, 0) / results.length : 0
  const submissions = results.length

  const openStudentResult = async (studentId: number) => {
    setDetailLoading(studentId)
    try {
      setStudentResult(await api.examStudentResult(examId, studentId))
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Could not load student answers')
    } finally {
      setDetailLoading(null)
    }
  }

  if (studentResult) {
    return (
      <div className="stack loose">
        <div className="page-head no-print">
          <div><h1>{studentResult.student.name}</h1><p className="sub">{title} · Individual result documents</p></div>
          <button className="btn secondary" onClick={() => setStudentResult(null)}>← Back to results</button>
        </div>
        <ResultDocuments result={studentResult} student={studentResult.student} />
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>{loading ? <><Spinner size="sm" label="" /> Loading results…</> : title}</h1>
          <p className="sub">Results for all assigned students.</p>
        </div>
        <button className="btn secondary" onClick={onBack}>← Back</button>
      </div>
      {error && <p className="error">{error}</p>}

      {loading ? (
        <div className="panel">
          <div className="panel-body">
            <div className="stat-cards">
              <Skeleton h={74} />
              <Skeleton h={74} />
              <Skeleton h={74} />
            </div>
            <div className="flex-col" style={{ marginTop: 16 }}>
              <Skeleton h={40} />
              <Skeleton h={40} />
              <Skeleton h={40} />
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="stat-cards" style={{ marginBottom: 18 }}>
            <div className="stat-card"><strong>{assignedCount}</strong><span>Assigned</span></div>
            <div className="stat-card"><strong>{submissions}</strong><span>Submitted</span></div>
            <div className="stat-card"><strong>{avg.toFixed(1)}%</strong><span>Class average</span></div>
          </div>

          {results.length === 0 ? (
            <div className="panel">
              <EmptyState
                icon="inbox"
                title="No submissions yet"
                body="Students will appear here after they submit. Share this exam with your class to get started."
              />
            </div>
          ) : (
            <div className="panel" style={{ marginBottom: 18 }}>
              <div className="panel-head"><h2>Student scores</h2></div>
              <div className="panel-body" style={{ padding: 0 }}>
                <div className="table-scroll">
                <table className="tbl">
                  <thead>
                    <tr><th>Student</th><th>ID</th><th>Class</th><th>Score</th><th>%</th><th>Flags</th><th>Submitted</th><th>Documents</th></tr>
                  </thead>
                  <tbody>
                    {results.map((r) => {
                      const pct = Math.round((r.score / (r.total || 1)) * 100)
                      return (
                        <tr key={`${r.student_name}-${r.submitted_at}`}>
                          <td><strong>{r.student_name}</strong></td>
                          <td>{r.student_code || '—'}</td>
                          <td>{r.student_class || '—'}</td>
                          <td>{r.score}/{r.total}</td>
                          <td><span className={`tag ${pct >= 50 ? 'green' : 'red'}`}>{pct}%</span></td>
                          <td>{r.marked}</td>
                          <td>{new Date(r.submitted_at).toLocaleString()}</td>
                          <td><button className="btn secondary sm" disabled={detailLoading === r.student_id} onClick={() => void openStudentResult(r.student_id)}>{detailLoading === r.student_id ? 'Loading…' : 'Answers & certificate'}</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}

          {perQuestion.length > 0 && (
            <div className="panel">
              <div className="panel-head"><h2>Per-question analysis</h2></div>
              <div className="panel-body" style={{ padding: 0 }}>
                <div className="table-scroll">
                <table className="tbl">
                  <thead>
                    <tr><th style={{ width: 44 }}>#</th><th>Question</th><th>Correct</th><th>Attempts</th><th style={{ width: 140 }}>Accuracy</th></tr>
                  </thead>
                  <tbody>
                    {perQuestion.map((q) => (
                      <tr key={q.index}>
                        <td>{q.index + 1}</td>
                        <td><MathText text={q.prompt} /></td>
                        <td>{q.correct}</td>
                        <td>{q.total}</td>
                        <td>
                          <div className="flex" style={{ gap: 8 }}>
                            <div style={{ flex: 1, height: 10, borderRadius: 99, background: 'var(--slab-2)', overflow: 'hidden' }}>
                              <div style={{ width: `${q.pct}%`, height: '100%', background: q.pct >= 50 ? 'var(--jade)' : 'var(--vermilion)' }} />
                            </div>
                            <span className="muted" style={{ fontSize: 12 }}>{q.pct}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
