import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type AiJob, type Question, type QuestionType } from '../../api'
import { MathText, Spinner, EmptyState, Skeleton, Figure, Icon } from '../../components/ui'
import { notify } from '../../components/feedback'

export function Builder() {
  const [bank, setBank] = useState<Question[]>([])
  const [bankLoading, setBankLoading] = useState(true)
  const [selection, setSelection] = useState<Question[]>([])
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState('')
  const [classLevel, setClassLevel] = useState('SS3')
  const [duration, setDuration] = useState(45)
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)

  const [genSubject, setGenSubject] = useState('Mathematics')
  const [genTopic, setGenTopic] = useState('')
  const [genCount, setGenCount] = useState(5)
  const [genDiff, setGenDiff] = useState('medium')
  const [genType, setGenType] = useState<QuestionType>('multiple-choice')
  const [generating, setGenerating] = useState(false)
  const [genResults, setGenResults] = useState<Question[]>([])
  const [genProgress, setGenProgress] = useState<Pick<AiJob, 'done' | 'requested' | 'status'> | null>(null)
  const genPoll = useRef<number | null>(null)

  const [blueprintPrompt, setBlueprintPrompt] = useState('')
  const [blueprinting, setBlueprinting] = useState(false)
  const [blueprintResult, setBlueprintResult] = useState<any>(null)

  const runBlueprint = async () => {
    if (!blueprintPrompt.trim()) return
    setBlueprinting(true)
    try {
      const r = await api.aiBlueprint({ prompt: blueprintPrompt })
      setBlueprintResult(r.blueprint)
      if (r.blueprint) {
        if (r.blueprint.compulsory) setGenCount(r.blueprint.compulsory)
        if (r.blueprint.coverage) setGenTopic(r.blueprint.coverage)
        notify('success', 'AI blueprint generated! Settings applied.')
      }
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Blueprint failed')
    } finally {
      setBlueprinting(false)
    }
  }

  useEffect(() => () => { if (genPoll.current) window.clearInterval(genPoll.current) }, [])

  const refreshBank = useCallback(async () => {
    try {
      const r = await api.listQuestions()
      setBank(r.questions)
    } catch { /* keep existing */ }
  }, [])

  useEffect(() => {
    api.listQuestions()
      .then((r) => setBank(r.questions))
      .catch(() => notify('error', 'Could not load the question bank'))
      .finally(() => setBankLoading(false))
  }, [])

  const filtered = bank.filter((q) => !selection.some((s) => s.id === q.id)).filter((q) => {
    const s = search.toLowerCase()
    return !s || q.prompt.toLowerCase().includes(s)
  })

  const add = (q: Question) => setSelection((old) => [...old, q])
  const removeAt = (i: number) => setSelection((old) => old.filter((_, x) => x !== i))
  const move = (i: number, dir: -1 | 1) =>
    setSelection((old) => {
      const j = i + dir
      if (j < 0 || j >= old.length) return old
      const next = [...old]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const generate = async () => {
    setGenerating(true)
    setMessage('')
    setGenResults([])
    setGenProgress(null)
    try {
      const r = await api.aiStartJob({ subject: genSubject, topic: genTopic, count: genCount, difficulty: genDiff, classLevel, type: genType })
      setGenProgress({ done: 0, requested: r.requested, status: 'running' })
      setMessage(`Generating questions… Generating the remaining ${r.requested} question${r.requested === 1 ? '' : 's'}…`)
      genPoll.current = window.setInterval(() => {
        api.aiJob(r.jobId).then((job) => {
          const questions = job.questions ?? []
          setGenProgress({ done: job.done, requested: job.requested, status: job.status })
          if (questions.length > 0) {
            setGenResults(questions)
            const remaining = Math.max(0, job.requested - questions.length)
            setMessage(`Generating questions… ${questions.length}/${job.requested} ready. Generating the remaining ${remaining} question${remaining === 1 ? '' : 's'}…`)
          } else {
            setMessage(`Generating questions… Generating the remaining ${job.requested} question${job.requested === 1 ? '' : 's'}…`)
          }
          if (job.status === 'running') return

          if (genPoll.current) window.clearInterval(genPoll.current)
          genPoll.current = null
          setGenerating(false)
          if (job.status === 'error') {
            setMessage(job.error || 'Generation failed.')
            notify('error', job.error || 'AI generate failed')
            return
          }
          if (job.note) notify('info', job.note)
          else notify('success', `Generated ${questions.length} questions — add the ones you keep.`)
        }).catch((err) => {
          if (genPoll.current) window.clearInterval(genPoll.current)
          genPoll.current = null
          setGenerating(false)
          setGenProgress((old) => old ? { ...old, status: 'error' } : old)
          notify('error', err instanceof Error ? err.message : 'AI generate failed')
        })
      }, 20000)
    } catch (err) {
      setGenerating(false)
      notify('error', err instanceof Error ? err.message : 'AI generate failed')
    }
  }

  const saveExam = async () => {
    if (!title.trim()) { setMessage('Give the exam a title'); return }
    if (selection.length === 0) { setMessage('Add at least one question to the exam'); return }
    setSaving(true)
    setMessage('')
    try {
      await api.createExam({
        title: title.trim(),
        subject: subject.trim() || null,
        class_level: classLevel || null,
        duration_minutes: Number(duration) || 30,
        questions: selection,
      })
      notify('success', 'Exam saved. Assign it to students in Exams → Assign.')
      setSelection([])
      setTitle('')
      await refreshBank()
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Could not save exam')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Exam builder</h1>
          <p className="sub">Pick questions from the bank or generate fresh ones with AI, then publish.</p>
        </div>
      </div>
      {message && <p className={message.startsWith('Exam saved') || message.includes('added') ? '' : 'error'}>{message}</p>}

      <div className="grid-2">
        <div className="flex-col" style={{ gap: 14 }}>
          <div className="panel">
            <div className="panel-head"><h2>Question bank</h2></div>
            <div className="panel-body">
              <div className="field" style={{ marginBottom: 10 }}>
                <input placeholder="Search bank…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              {bankLoading ? (
                <div style={{ display: 'grid', gap: 12 }}>
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="q-row" style={{ borderBottom: 0 }}>
                      <div style={{ flex: 1, display: 'grid', gap: 8 }}>
                        <Skeleton w="72%" h={13} />
                        <Skeleton w="38%" h={11} />
                      </div>
                      <Skeleton w={72} h={36} r={10} />
                    </div>
                  ))}
                </div>
              ) : filtered.length === 0 ? (
                <EmptyState
                  icon="list"
                  title={search ? 'No matching bank questions' : 'Bank is empty'}
                  body="Generate questions in the AI Lab or add one in the Question bank."
                />
              ) : (
                <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                  {filtered.map((q) => (
                    <div className="q-row" key={q.id}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ fontSize: 13, lineHeight: 1.4, display: 'block' }}><MathText text={q.prompt} /></strong>
                        <span className="muted" style={{ fontSize: 12 }}>{q.subject || ''} {q.topic || ''}</span>
                      </div>
                      <button className="btn secondary" onClick={() => add(q)}>Add +</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>AI Exam Blueprint</h2></div>
            <div className="panel-body stack small">
              <p className="cell-sub">Describe the exam you want in plain words, and let AI build a blueprint and configure generation parameters for you.</p>
              <div className="field">
                <textarea
                  rows={2}
                  value={blueprintPrompt}
                  onChange={(e) => setBlueprintPrompt(e.target.value)}
                  placeholder="e.g. 30 questions for SS2 Physics on Waves and Optics, mixed difficulty"
                />
              </div>
              <button className="btn secondary" disabled={blueprinting} onClick={() => void runBlueprint()} style={{ width: '100%' }}>
                {blueprinting ? <><Spinner size="sm" label="" /> Designing blueprint…</> : 'Design with AI'}
              </button>
              {blueprintResult && (
                <div className="p-sm bg-surface rounded stack tiny border">
                  <strong className="text-sm">Blueprint applied:</strong>
                  <span className="cell-sub">{blueprintResult.coverage}</span>
                  <span className="tag gold">Target count: {blueprintResult.compulsory} questions</span>
                </div>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-head"><h2>Generate with AI</h2></div>
            <div className="panel-body">
              <div className="grid-2" style={{ gap: 10 }}>
                <div className="field"><label>Subject</label><input value={genSubject} onChange={(e) => setGenSubject(e.target.value)} /></div>
                <div className="field"><label>Topic</label><input value={genTopic} onChange={(e) => setGenTopic(e.target.value)} placeholder="Fractions, Algebra…" /></div>
                <div className="field"><label>Count</label><input type="number" min={1} max={100} value={genCount} onChange={(e) => setGenCount(Number(e.target.value))} /></div>
                <div className="field"><label>Difficulty</label>
                  <select value={genDiff} onChange={(e) => setGenDiff(e.target.value)}>
                    <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option><option value="mixed">Mixed</option>
                  </select>
                </div>
                <div className="field"><label>Question type</label>
                  <select value={genType} onChange={(e) => setGenType(e.target.value as QuestionType)}>
                    <option value="multiple-choice">Multiple choice</option>
                    <option value="essay">Essay</option>
                    <option value="theory">Theory</option>
                  </select>
                </div>
              </div>
              <button className="btn primary" disabled={generating} onClick={() => void generate()} style={{ width: '100%' }}>
                {generating ? <><Spinner size="sm" label="" /> Generating…</> : 'Generate questions'}
              </button>
              {genProgress && (() => {
                const pct = genProgress.requested ? Math.min(100, Math.round((genProgress.done / genProgress.requested) * 100)) : 0
                return (
                  <div className="ai-job" role="status" aria-live="polite" style={{ marginTop: 10 }}>
                    <div className="row-between" style={{ gap: 10 }}>
                      <strong style={{ fontSize: 13 }}>
                        {genProgress.status === 'running'
                          ? `Generating… ${genProgress.done} of ${genProgress.requested}`
                          : genProgress.status === 'done'
                            ? `Finished — ${genProgress.done} question${genProgress.done === 1 ? '' : 's'}`
                            : 'Generation failed'}
                      </strong>
                      <span className="muted" style={{ fontSize: 12 }}>{pct}%</span>
                    </div>
                    <div className="ai-job-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Question generation progress">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                )
              })()}
              {genResults.length > 0 && (
                <div style={{ marginTop: 12 }}>
                  <div className="row-between"><strong style={{ fontSize: 14 }}>{genResults.length} generated {genProgress?.status === 'running' ? 'so far ' : ''}— add the ones you want</strong></div>
                  <div style={{ maxHeight: 300, overflowY: 'auto', marginTop: 8 }}>
                    {genResults.map((q, i) => (
                      <div className="q-row" key={`${i}-${q.prompt}`}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong style={{ fontSize: 13, lineHeight: 1.4, display: 'block' }}><MathText text={q.prompt} /></strong>
                          <span className="muted" style={{ fontSize: 12 }}>{genType === 'multiple-choice' ? `Answer ${String.fromCharCode(65 + q.answer)}` : `${genType === 'essay' ? 'Essay' : 'Theory'} question`}</span>
                        </div>
                        <button className="btn secondary" onClick={() => { add(q); setGenResults((old) => old.filter((_, x) => x !== i)) }}>Add +</button>
                      </div>
                    ))}
                  </div>
                  <button className="btn secondary" style={{ width: '100%', marginTop: 8 }} onClick={() => setGenResults([])}>Clear generated list</button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div>
          <div className="panel" style={{ position: 'sticky', top: 16 }}>
            <div className="panel-head"><h2>Exam paper</h2><span className="tag gold">{selection.length} questions</span></div>
            <div className="panel-body">
              <div className="field"><label>Exam title</label><input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. SS3 Mathematics Test 1" /></div>
              <div className="grid-3" style={{ gap: 10 }}>
                <div className="field"><label>Subject</label><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Mathematics" /></div>
                <div className="field"><label>Class</label>
                  <select value={classLevel} onChange={(e) => setClassLevel(e.target.value)}>
                    {['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'].map((c) => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="field"><label>Minutes</label><input type="number" min={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /></div>
              </div>

              {selection.length === 0 ? (
                <div className="empty">No questions added yet.</div>
              ) : (
                <div style={{ maxHeight: 420, overflowY: 'auto' }}>
                  {selection.map((q, i) => (
                    <div className="q-row" key={`${q.id ?? 'gen'}-${i}`}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong style={{ fontSize: 13, lineHeight: 1.4, display: 'block' }}>{i + 1}. <MathText text={q.prompt} /></strong>
                        {q.figure && <Figure src={q.figure} className="thumb" />}
                        <span className="muted" style={{ fontSize: 12 }}>Answer {String.fromCharCode(65 + q.answer)}</span>
                      </div>
                      <div className="flex" style={{ gap: 6 }}>
                        <button className="btn secondary icon sm" aria-label="Move question up" data-tip="Move up" disabled={i === 0} onClick={() => move(i, -1)}><Icon name="chevron" size={14} style={{ transform: 'rotate(180deg)' }} /></button>
                        <button className="btn secondary icon sm" aria-label="Move question down" data-tip="Move down" disabled={i === selection.length - 1} onClick={() => move(i, 1)}><Icon name="chevron" size={14} /></button>
                        <button className="btn danger icon sm" aria-label="Remove question" data-tip="Remove" onClick={() => removeAt(i)}><Icon name="x" size={14} /></button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button className="btn primary full" style={{ marginTop: 14 }} disabled={saving || selection.length === 0} onClick={() => void saveExam()}>
                {saving ? <><Spinner size="sm" label="" /> Saving…</> : 'Save exam'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
