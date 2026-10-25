import { useCallback, useEffect, useState } from 'react'
import { api, type ExamSummary, type StudentRow } from '../../api'
import { notify, ConfirmDialog } from '../../components/feedback'
import { EmptyState, Skeleton, Button } from '../../components/ui'
import { PageHead } from '../../components/patterns'
import { match, navigate, useRoute } from '../../lib/router'
import { Results } from './Results'

export function Exams() {
  const route = useRoute()
  const assignmentRoute = match('/exams/:id/assign', route.path)
  const [exams, setExams] = useState<ExamSummary[]>([])
  const [students, setStudents] = useState<StudentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [assignAll, setAssignAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [resultsFor, setResultsFor] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<ExamSummary | null>(null)
  const [deleting, setDeleting] = useState(false)
  const assigning = assignmentRoute ? exams.find((exam) => exam.id === Number(assignmentRoute.id)) ?? null : null

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      const [e, s] = await Promise.all([api.listExams(), api.listStudents()])
      setExams(e.exams)
      setStudents(s.students)
      setMessage('')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load exams')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    Promise.all([api.listExams(), api.listStudents()])
      .then(([e, s]) => { setExams(e.exams); setStudents(s.students) })
      .catch((err) => setMessage(err instanceof Error ? err.message : 'Could not load exams'))
      .finally(() => setLoading(false))
  }, [])

  const toggle = (id: number) =>
    setChecked((old) => {
      const next = new Set(old)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const doAssign = async () => {
    if (!assigning) return
    setBusy(true)
    setMessage('')
    try {
      const r = await api.assignExam(assigning.id, [...checked], assignAll)
      notify('success', `Assigned to ${r.assigned} student(s).`)
      navigate('/exams')
      setChecked(new Set())
      setAssignAll(false)
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Assignment failed')
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await api.deleteExam(confirmDelete.id)
      notify('success', 'Exam deleted.')
    } catch {
      notify('error', 'Could not delete this exam.')
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
      await refresh()
    }
  }

  if (resultsFor !== null) {
    return <Results examId={resultsFor} onBack={() => setResultsFor(null)} />
  }

  if (assignmentRoute) {
    const closeAssign = () => {
      setChecked(new Set())
      setAssignAll(false)
      navigate('/exams')
    }

    return (
      <div className="stack loose">
        <PageHead
          kicker="Exams & results"
          title={assigning ? `Assign ${assigning.title}` : 'Assign exam'}
          tagline="Choose the students who should receive this exam."
          actions={<Button variant="secondary" icon="arrowLeft" onClick={closeAssign}>Back to exams</Button>}
        />
        {loading ? (
          <div className="panel"><div className="panel-body"><Skeleton w="45%" h={18} /><Skeleton w="80%" h={14} /></div></div>
        ) : !assigning ? (
          <div className="panel"><EmptyState icon="exams" title="Exam not found" body="This exam may have been deleted. Return to Exams & results to choose another." /></div>
        ) : (
          <div className="panel">
            <div className="panel-head">
              <div><h2>Student access</h2><p className="sub">{assigning.title} · {students.length} registered students</p></div>
              <span className="tag gold">{assignAll ? students.length : checked.size} selected</span>
            </div>
            <div className="panel-body stack">
              <label className="row" style={{ gap: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={assignAll} onChange={(e) => setAssignAll(e.target.checked)} />
                <span><strong>Assign to all students</strong><span className="muted" style={{ display: 'block', fontSize: 12 }}>Include all {students.length} registered students.</span></span>
              </label>
              {!assignAll && students.length > 0 && (
                <div className="grid-2" style={{ gap: 20 }}>
                  {[...new Set(students.map((student) => student.class || 'No class'))].sort().map((cls) => {
                    const inClass = students.filter((student) => (student.class || 'No class') === cls)
                    return (
                      <section key={cls}>
                        <h3 className="omr-section-name" style={{ padding: '8px 0' }}>{cls} <span className="muted">· {inClass.length}</span></h3>
                        <div className="list">
                          {inClass.map((student) => (
                            <label key={student.id} className="row" style={{ gap: 10, padding: '9px 4px', cursor: 'pointer' }}>
                              <input type="checkbox" checked={checked.has(student.id)} onChange={() => toggle(student.id)} />
                              <span className="grow truncate">{student.name}</span>
                              <span className="muted num">{student.student_id || ''}</span>
                            </label>
                          ))}
                        </div>
                      </section>
                    )
                  })}
                </div>
              )}
              {!assignAll && students.length === 0 && <p className="hint">No students are registered yet.</p>}
              <div className="row-between" style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
                <Button variant="secondary" onClick={closeAssign}>Cancel</Button>
                <Button variant="primary" loading={busy} disabled={!assignAll && checked.size === 0} onClick={() => void doAssign()}>
                  Assign to {assignAll ? students.length : checked.size} student{(assignAll ? students.length : checked.size) === 1 ? '' : 's'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Exams</h1>
          <p className="sub">Create exams in the builder, assign them here, then review results.</p>
        </div>
      </div>
      {message && <p className={message.includes('Assigned') ? 'hint' : 'error'}>{message}</p>}

      {loading ? (
        <div className="panel">
          <div className="panel-body" style={{ display: 'grid', gap: 12 }}>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(160px, 2fr) 1fr 1fr 90px 90px', gap: 14, alignItems: 'center' }}>
                <Skeleton w="85%" h={14} />
                <Skeleton w="60%" h={12} />
                <Skeleton w="55%" h={12} />
                <Skeleton w={60} h={14} />
                <Skeleton w={70} h={14} />
              </div>
            ))}
          </div>
        </div>
      ) : exams.length === 0 ? (
        <div className="panel">
          <EmptyState
            icon="exams"
            title="No exams yet"
            body="Build an exam in the Builder, or generate a full sheet in the AI Lab — then come back here to assign it."
          />
        </div>
      ) : (
        <div className="panel">
          <div className="panel-body">
            <div className="table-scroll">
            <table className="tbl">
              <thead>
                <tr><th>Exam</th><th>Subject</th><th>Class</th><th>Questions</th><th>Duration</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {exams.map((e) => (
                  <tr key={e.id}>
                    <td><strong style={{ fontSize: 14 }}>{e.title}</strong></td>
                    <td>{e.subject || '—'}</td>
                    <td>{e.class_level || '—'}</td>
                    <td>{e.questions?.length ?? '…'}</td>
                    <td>{e.duration_minutes} min</td>
                    <td>
                      <div className="flex" style={{ gap: 6 }}>
                        <button className="btn secondary" onClick={() => setResultsFor(e.id)}>Results</button>
                        <button className="btn primary" onClick={() => { setChecked(new Set()); setAssignAll(false); navigate(`/exams/${e.id}/assign`) }}>Assign</button>
                        <button className="btn danger" onClick={() => setConfirmDelete(e)}>Delete</button>
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

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this exam?"
          body={'"' + confirmDelete.title + '" and its assignments and results will be permanently removed.'}
          confirmLabel="Delete exam"
          busy={deleting}
          onConfirm={() => void doDelete()}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}
