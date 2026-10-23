import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type ExamSectionRange, type StudentExam, type SubmitResult } from '../api'
import { Button, Figure, Icon, MathText, RadioOption, Spinner, Tag } from '../components/ui'
import { notify, ConfirmDialog } from '../components/feedback'

export function StudentExam({ exam, onFinish }: { exam: StudentExam; onFinish: () => void }) {
  const [current, setCurrent] = useState(0)
  const [answers, setAnswers] = useState<Record<number, number>>({})
  const [flagged, setFlagged] = useState<number[]>([])
  // Optional section: the questions this candidate has chosen to sit. Anything
  // not chosen here can never be marked, so the choice is made before the
  // answer, exactly as it is on a printed paper.
  const [chosen, setChosen] = useState<number[]>([])
  const [seconds, setSeconds] = useState(exam.duration_minutes * 60)
  const [submitted, setSubmitted] = useState(false)
  const [showSubmit, setShowSubmit] = useState(false)
  const [tabWarning, setTabWarning] = useState(false)
  const [tabLeaves, setTabLeaves] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<SubmitResult | null>(null)

  // The paper is one continuous run; sections only say how it is marked.
  // Older papers arrive without them, so fall back to a single compulsory band.
  const sections: ExamSectionRange[] = useMemo(() => {
    if (exam.sections && exam.sections.length) return exam.sections
    return [{ title: 'SECTION A', kind: 'compulsory', answerAny: null, start: 0, end: exam.questions.length, count: exam.questions.length }]
  }, [exam.sections, exam.questions.length])

  const sectionOf = (idx: number) => sections.find((s) => idx >= s.start && idx < s.end) || sections[0]
  const isOptional = (idx: number) => sectionOf(idx)?.kind === 'optional'
  const quotaOf = (sec: ExamSectionRange) => Math.max(0, Math.min(sec.answerAny ?? 0, sec.count))

  const question = exam.questions[current]
  const section = sectionOf(question?.idx ?? 0)
  const optionalQuestion = isOptional(question?.idx ?? 0)
  const isChosen = chosen.includes(question?.idx ?? -1)
  // An optional question only accepts an answer once the candidate has chosen it.
  const answerable = !optionalQuestion || isChosen

  // What this candidate can actually be marked on: all compulsory questions plus
  // the optional questions they are allowed to choose.
  const maxScore = exam.maxScore || sections.reduce((a, s) => a + (s.kind === 'optional' ? quotaOf(s) : s.count), 0)
  const compulsoryCount = sections.reduce((a, s) => a + (s.kind === 'optional' ? 0 : s.count), 0)
  const chosenInSection = (sec: ExamSectionRange) => chosen.filter((idx) => idx >= sec.start && idx < sec.end).length
  const answeredOptional = chosen.filter((idx) => answers[idx] !== undefined).length
  const answeredCompulsory = Object.keys(answers).filter((k) => !isOptional(Number(k))).length
  const answered = answeredCompulsory + answeredOptional
  const progress = maxScore > 0 ? (answered / maxScore) * 100 : 0

  const figureNum = (() => {
    let n = 0
    for (const q of exam.questions) {
      if (q.figure) n += 1
      if (q.idx === question.idx) return q.figure ? n : 0
    }
    return 0
  })()

  // Timer ticks every second (pure updater — no side effects inside).
  useEffect(() => {
    if (submitted) return
    const timer = window.setInterval(() => setSeconds((v) => Math.max(0, v - 1)), 1000)
    return () => window.clearInterval(timer)
  }, [submitted])

  // Tab-leave tracking.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && !submitted) {
        setTabWarning(true)
        setTabLeaves((n) => n + 1)
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [submitted])

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      setSubmitted(true)
      // Only chosen-and-answered optional questions are sent, so the server
      // marks exactly what the candidate committed to.
      const payload: Record<number, number> = {}
      for (const [k, v] of Object.entries(answers)) {
        const idx = Number(k)
        if (isOptional(idx) && !chosen.includes(idx)) continue
        payload[idx] = v
      }
      const res = await api.submitExam(exam.id, payload, flagged.length, tabLeaves)
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not submit your exam')
      notify('error', err instanceof Error ? err.message : 'Could not submit your exam')
      setSubmitted(false)
    } finally {
      setBusy(false)
    }
  }

  // Auto-submit exactly once when time expires.
  const autoSubmitted = useRef(false)
  useEffect(() => {
    if (submitted) return
    if (seconds <= 0 && !autoSubmitted.current) {
      autoSubmitted.current = true
      void submit()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, submitted])

  const selectAnswer = (index: number) => {
    if (!answerable) return
    setAnswers((old) => ({ ...old, [question.idx]: index }))
  }

  // Choosing is limited to the section's quota. Swapping out a choice drops the
  // answer with it so nothing unchosen is ever left behind to be marked.
  const choose = () => {
    const idx = question.idx
    if (isChosen) {
      setChosen((old) => old.filter((x) => x !== idx))
      setAnswers((old) => {
        const next = { ...old }
        delete next[idx]
        return next
      })
      return
    }
    const quota = quotaOf(section)
    if (chosenInSection(section) >= quota) {
      notify('info', `You may only answer ${quota} question${quota === 1 ? '' : 's'} from ${section.title}. Remove one to choose another.`)
      return
    }
    setChosen((old) => [...old, idx])
  }

  const toggleFlag = () =>
    setFlagged((old) => (old.includes(question.idx) ? old.filter((id) => id !== question.idx) : [...old, question.idx]))

  const timeLabel = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`

  const missingCompulsory = Math.max(0, compulsoryCount - answeredCompulsory)
  const optionalShort = sections
    .filter((s) => s.kind === 'optional')
    .map((s) => Math.max(0, quotaOf(s) - chosenInSection(s)))
    .reduce((a, b) => a + b, 0)
  const submitWarning = [
    missingCompulsory > 0 ? `${missingCompulsory} compulsory question${missingCompulsory === 1 ? '' : 's'} unanswered.` : null,
    optionalShort > 0 ? `${optionalShort} optional question${optionalShort === 1 ? '' : 's'} still to choose.` : null,
  ].filter(Boolean) as string[]

/* The clock changes colour at the two thresholds that mean something: a
   quarter of the paper still to run, and the last five minutes. */
  const clockLevel =
    seconds <= 300 ? 'critical' : seconds <= exam.duration_minutes * 60 * 0.25 ? 'warn' : undefined

  // ── Result ──
  if (submitted && result) {
    const pct = result.total > 0 ? Math.round((result.score / result.total) * 100) : 0
    return (
      <div className="hall">
        <div className="hall-body stack loose">
          <section className="verdict">
            <span className={`verdict-mark ${pct >= 50 ? 'pass' : 'fail'}`}>
              <Icon name={pct >= 50 ? 'check' : 'x'} size={28} />
            </span>
            <div>
              <p className="kicker">T. Gold Brighter Tomorrow Model School</p>
              <h1>Assessment submitted</h1>
              <p className="muted">Your response has been recorded securely.</p>
            </div>
            <p className="verdict-score">
              <b>{pct}%</b>
              <span>
                {result.score} of {result.total} correct
              </span>
            </p>
            <div className="verdict-stats">
              <div>
                <b>
                  {result.score}/{result.total}
                </b>
                <span>Score</span>
              </div>
              <div>
                <b>{pct}%</b>
                <span>Percent</span>
              </div>
              <div>
                <b>{result.marked}</b>
                <span>Flagged</span>
              </div>
              <div>
                <b>{tabLeaves}</b>
                <span>Tab leaves</span>
              </div>
            </div>
            <Button variant="secondary" icon="arrowLeft" onClick={onFinish}>
              Back to my exams
            </Button>
          </section>

          <section className="panel">
            <header className="panel-head">
              <div className="min-w-0">
                <p className="kicker">The record</p>
                <h2>Answer review</h2>
              </div>
            </header>
            <div className="panel-body">
              <p className="hint" style={{ marginTop: 0 }}>
                Green is the right answer. Red is the choice you made, with the right answer beside
                it. Anything you skipped is left quiet rather than marked wrong.
              </p>
              {result.review.map((item) => (
                <div className="review-item" key={item.idx}>
                  <div className="review-head">
                    <p className="q-stem">
                      <span className="q-no">{String(item.idx + 1).padStart(2, '0')}</span>
                      <MathText text={item.prompt} />
                    </p>
                    <Tag tone={item.chosen === item.correct ? 'jade' : 'vermilion'} dot>
                      {item.chosen === item.correct
                        ? `Correct · ${String.fromCharCode(65 + item.correct)}`
                        : `Wrong · answer ${String.fromCharCode(65 + item.correct)}`}
                    </Tag>
                  </div>

                  <div className="row wrap" style={{ gap: 6 }}>
                    {item.section ? <Tag>{item.section}</Tag> : null}
                    {item.optional ? <Tag tone="chalk">Optional</Tag> : null}
                    {item.optional && item.counted === false ? (
                      <Tag tone="brass">Answered outside your quota — not marked</Tag>
                    ) : null}
                  </div>

                  {item.figure ? <Figure src={item.figure} caption="Question figure" /> : null}

                  <div className="q-options" style={{ marginTop: 'var(--s-3)' }}>
                    {item.options.map((opt, i) => (
                      <RadioOption
                        key={opt}
                        group={`review-${item.idx}`}
                        letter={String.fromCharCode(65 + i)}
                        label={<MathText text={opt} />}
                        revealed
                        locked
                        correct={i === item.correct}
                        selected={i === item.chosen}
                      />
                    ))}
                  </div>

                  {item.explanation ? (
                    <p className="review-note">
                      <Icon name="info" size={14} />
                      <span>
                        <MathText text={item.explanation} />
                      </span>
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </section>

          {error ? <p className="error">{error}</p> : null}
        </div>
      </div>
    )
  }

  if (submitted && !result && !busy && !error) {
    return (
      <div className="hall">
        <div className="hall-body">
          <div className="verdict">
            <Spinner size="lg" label="Submitting your exam…" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="hall">
      <div className="hall-bar">
        <div className="hall-bar-id">
          <span className="hall-bar-title">{exam.title}</span>
          <span className="hall-bar-sub">
            {[exam.subject, exam.class_level].filter(Boolean).join(' · ')} · Student Assessment
            Portal
          </span>
        </div>

        <div className="hall-progress">
          <div className="hall-progress-track">
            <i className="hall-progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="hall-progress-legend">
            <span>
              {answered} of {maxScore} answered
            </span>
            <span>{Math.round(progress)}%</span>
          </div>
        </div>

        <div className="clock" data-level={clockLevel}>
          <span className="clock-label">Time left</span>
          <span className="clock-time">{timeLabel}</span>
        </div>
      </div>

      <main className="hall-body">
        <div className="hall-grid">
          <article className="sheet">
            <div className="sheet-pad">
              <header className="sheet-masthead">
                <div className="min-w-0">
                  <p className="sheet-school">T. Gold Brighter Tomorrow · Model School</p>
                  <h1 className="sheet-title">{exam.title}</h1>
                </div>
                <div className="sheet-meta">
                  <span>
                    Subject <b>{exam.subject ?? '—'}</b>
                  </span>
                  <span>
                    Class <b>{exam.class_level ?? '—'}</b>
                  </span>
                  <span>
                    Topic <b>{question.topic || 'Objective test'}</b>
                  </span>
                  <span>
                    Time <b>{exam.duration_minutes} min</b>
                  </span>
                </div>
              </header>

              <div className={`sheet-band ${optionalQuestion ? 'optional' : ''}`}>
                <span className="sheet-band-name">{section.title}</span>
                <span className="sheet-band-rule">
                  {optionalQuestion
                    ? `Answer ANY ${quotaOf(section)} of the ${section.count} questions here. Only the ones you choose are marked.`
                    : `Answer ALL ${section.count} questions in this section.`}
                </span>
                <span className="sheet-band-count">
                  {optionalQuestion
                    ? `Questions ${section.start + 1}–${section.end} · ${chosenInSection(section)}/${quotaOf(section)} chosen`
                    : `Questions ${section.start + 1}–${section.end}`}
                </span>
              </div>

              <p className="q-stem">
                <span className="q-no">{String(current + 1).padStart(2, '0')}</span>
                <MathText text={question.prompt} />
              </p>

              {question.figure && figureNum > 0 ? (
                <Figure src={question.figure} caption={`Fig. ${figureNum}`} />
              ) : null}

              <div className="q-options" style={{ opacity: answerable ? 1 : 0.55, marginTop: 'var(--s-4)' }}>
                {question.options.map((option, index) => (
                  <RadioOption
                    key={option}
                    group={`q-${question.idx}`}
                    letter={String.fromCharCode(65 + index)}
                    label={<MathText text={option} />}
                    selected={answers[question.idx] === index}
                    disabled={!answerable}
                    onChange={() => selectAnswer(index)}
                  />
                ))}
              </div>

              {optionalQuestion ? (
                <div className="choose-box" data-chosen={isChosen}>
                  <Button
                    variant={isChosen ? 'primary' : 'secondary'}
                    size="sm"
                    className="on-sheet"
                    icon={isChosen ? 'check' : 'plus'}
                    onClick={choose}
                    disabled={!isChosen && chosenInSection(section) >= quotaOf(section)}
                  >
                    {isChosen ? 'Chosen — remove' : 'Choose this question'}
                  </Button>
                  <span className="choose-box-text">
                    {isChosen
                      ? 'This one counts toward your score.'
                      : `Choose it to unlock the options — ${quotaOf(section) - chosenInSection(section)} choice${
                          quotaOf(section) - chosenInSection(section) === 1 ? '' : 's'
                        } left in this section.`}
                  </span>
                </div>
              ) : null}

              <div className="exam-controls">
                <Button
                  variant="secondary"
                  className="on-sheet"
                  icon="arrowLeft"
                  disabled={current === 0}
                  onClick={() => setCurrent((v) => Math.max(0, v - 1))}
                >
                  Previous
                </Button>
                <Button
                  variant="brass"
                  className="on-sheet"
                  icon="flag"
                  aria-pressed={flagged.includes(question.idx)}
                  onClick={toggleFlag}
                >
                  {flagged.includes(question.idx) ? 'Flagged' : 'Flag'}
                </Button>
                <span className="spacer" />
                <Button
                  variant="primary"
                  className="on-sheet"
                  iconRight="arrowRight"
                  disabled={current === exam.questions.length - 1}
                  onClick={() => setCurrent((v) => Math.min(exam.questions.length - 1, v + 1))}
                >
                  Next
                </Button>
              </div>
            </div>
          </article>

          <aside className="omr">
            <div className="omr-head">
              <div className="min-w-0">
                <p className="kicker">Assessment map</p>
                <h2>Questions</h2>
              </div>
              <Tag tone="chalk">{Math.round(progress)}%</Tag>
            </div>

            {sections.map((sec) => (
              <div className="omr-section" key={sec.title}>
                <div className="omr-section-head">
                  <span className="omr-section-name">{sec.title}</span>
                  <span className="omr-section-name">
                    {sec.kind === 'optional' ? `any ${quotaOf(sec)}` : `${sec.count} questions`}
                  </span>
                </div>
                <div className="omr-row">
                  {exam.questions.slice(sec.start, sec.end).map((item) => (
                    <button
                      key={item.idx}
                      className="omr-cell"
                      data-state={
                        flagged.includes(item.idx)
                          ? 'flagged'
                          : chosen.includes(item.idx)
                            ? 'chosen'
                            : answers[item.idx] !== undefined
                              ? 'answered'
                              : undefined
                      }
                      data-current={item.idx === current}
                      aria-current={item.idx === current}
                      aria-label={`Question ${item.idx + 1}`}
                      onClick={() => setCurrent(item.idx)}
                    >
                      {item.idx + 1}
                      {flagged.includes(item.idx) ? <i className="flag-dot" /> : null}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="omr-legend">
              <span>
                <i className="current" /> Current
              </span>
              <span>
                <i className="answered" /> Answered
              </span>
              <span>
                <i className="flagged"
                  style={{ color: 'var(--vermilion)', fontWeight: 700, textShadow: '0 0 6px var(--vermilion)' }} />
                Flagged
              </span>
              {sections.some((s) => s.kind === 'optional') ? (
                <span>
                  <i className="chosen" /> Chosen
                </span>
              ) : null}
            </div>

            <div className="omr-tally">
              <div>
                <b>{answered}</b>
                <span>Answered</span>
              </div>
              <div>
                <b>{Math.max(0, maxScore - answered)}</b>
                <span>Remaining</span>
              </div>
              <div>
                <b>{flagged.length}</b>
                <span>Flagged</span>
              </div>
            </div>

            {missingCompulsory > 0 || optionalShort > 0 ? (
              <p className="hint">
                {[
                  missingCompulsory > 0
                    ? `${missingCompulsory} compulsory question${missingCompulsory === 1 ? '' : 's'} still unanswered.`
                    : null,
                  optionalShort > 0
                    ? `${optionalShort} optional question${optionalShort === 1 ? '' : 's'} still to choose.`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' ')}
              </p>
            ) : (
              <p className="hint">Everything that will be marked has an answer.</p>
            )}

            {error ? <p className="error">{error}</p> : null}

            <Button variant="danger" block onClick={() => setShowSubmit(true)} loading={busy}>
              Submit exam
            </Button>
          </aside>
        </div>

        {tabWarning ? (
          <ConfirmDialog
            title="Return to your exam"
            body="Leaving the assessment has been recorded. Returning to other tabs may be marked as a violation."
            confirmLabel="Continue exam"
            onConfirm={() => setTabWarning(false)}
            onCancel={() => setTabWarning(false)}
          />
        ) : null}

        {showSubmit ? (
          <ConfirmDialog
            title="Submit this exam?"
            body={
              submitWarning.length
                ? `You have answered ${answered} of the ${maxScore} questions that count. ${submitWarning.join(' ')} Everything you answer outside your optional quota will not be marked.`
                : `You have answered all ${maxScore} questions that count. Submit now?`
            }
            confirmLabel="Submit exam"
            busy={busy}
            onConfirm={() => {
              setShowSubmit(false)
              void submit()
            }}
            onCancel={() => setShowSubmit(false)}
          />
        ) : null}
      </main>
    </div>
  )
}
