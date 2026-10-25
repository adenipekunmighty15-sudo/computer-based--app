import { useEffect, useMemo, useRef, useState } from 'react'
import { api, type ExamSection, type FigureSource, type FigureStyle, type PaperPayload, type Question, type QuestionType } from '../../api'
import { MathText, Spinner, Figure, Button, Modal, Segmented, Icon } from '../../components/ui'
import { notify } from '../../components/feedback'
import { ThinkingDrawer, type ThinkingState } from '../../components/patterns/ThinkingDrawer'

interface SheetQ extends Question {
  uid: number
}

// A section is a *band* of the one continuous sheet. The questions are stored
// in one unbroken run; `kind` only decides how a band is marked. `type` is the
// band's format: 'multiple-choice' (auto-graded) or 'theory'/'essay' (prose,
// marked by the teacher). One paper mixes bands — Section A objective, Section
// B theory is the classic SSCE spread.
interface SheetSection {
  title: string
  kind: 'compulsory' | 'optional'
  answerAny: number | null
  type?: QuestionType
  instruction: string
  questions: SheetQ[]
}

type SheetPatch = SheetSection[] | ((old: SheetSection[] | null) => SheetSection[] | null)

const MAX_PAPER = 9000
/* No ceiling on illustrations. A teacher asking for a diagram on every question
   gets one on every question; the server draws them at its own pace and the
   teacher waits. The old cap of 20 meant "illustrate this 60-question paper"
   quietly drew a third of it. */
const MAX_FIGURES = 1000
const autoFigureCount = (total: number) => (total <= 0 ? 0 : Math.min(MAX_FIGURES, Math.max(1, Math.round(total / 3))))
const clamp = (v: number, lo: number, hi: number) => {
  const n = parseInt(String(v), 10)
  if (!Number.isFinite(n)) return lo
  return Math.max(lo, Math.min(hi, n))
}

// What a candidate is actually marked out of: every compulsory question plus
// exactly the number of optional questions they may choose.
const marksFor = (sheet: SheetSection[]) =>
  sheet.reduce((a, s) => a + (s.kind === 'optional' ? Math.min(s.answerAny ?? 0, s.questions.length) : s.questions.length), 0)

export function ExamSheetTool() {
  const uid = useRef(1)
  const [title, setTitle] = useState('SS3 Mathematics Assessment')
  const [subject, setSubject] = useState('Mathematics')
  const [classLevel, setClassLevel] = useState('SS3')
  const [duration, setDuration] = useState(45)
  // Blueprint — the teacher sets the *shape*, the AI decides what to cover.
  const [marks, setMarks] = useState(1)
  const [coverage, setCoverage] = useState('')
  const [compulsory, setCompulsory] = useState(40)
  const [withOptional, setWithOptional] = useState(true)
  const [optional, setOptional] = useState(10)
  const [answerAny, setAnswerAny] = useState(5)
  // Per-section format. Sections can mix on one paper — Section A multiple
  // choice and Section B theory/essay is the classic SSCE spread.
  const [sectionTypes, setSectionTypes] = useState<{ A: QuestionType; B: QuestionType }>({ A: 'multiple-choice', B: 'multiple-choice' })
  const applyPreset = (patch: { A: QuestionType; B: QuestionType }) => {
    setSectionTypes(patch)
    setSectionFormats({})
  }
  const setSectionType = (section: 'A' | 'B', type: QuestionType) => setSectionTypes((old) => ({ ...old, [section]: type }))
  // A section can also be a strict format mix — "5 MCQ + 1 essay" — whose counts
  // are exact. `sectionFormats` stores the mix plans only; any section absent
  // here falls back to its single `sectionTypes` entry. Counts must add up to
  // the whole section (the generator never pads or borrows), so the editor
  // walks the tally live.
  const [sectionFormats, setSectionFormats] = useState<Partial<Record<'A' | 'B', QuestionType | Partial<Record<QuestionType, number>>>>>({})
  const FORMAT_TYPES: QuestionType[] = ['multiple-choice', 'essay', 'theory']
  const isMix = (section: 'A' | 'B') => {
    const f = sectionFormats[section]
    return f !== undefined && f !== null && typeof f === 'object'
  }
  const mixFor = (section: 'A' | 'B') => (isMix(section) ? (sectionFormats[section] as Partial<Record<QuestionType, number>>) : {})
  const mixTotal = (section: 'A' | 'B') => FORMAT_TYPES.reduce((a, t) => a + (mixFor(section)[t] ?? 0), 0)
  const mixState = (section: 'A' | 'B'): { tone: 'ok' | 'over' | 'short' | 'empty'; text: string } => {
    const expected = section === 'A' ? plannedCompulsory : plannedOptional
    const got = mixTotal(section)
    if (got === 0) return { tone: 'empty', text: 'Every format is set to 0 — the section has no questions.' }
    if (got === expected) return { tone: 'ok', text: `Fills all ${expected} — counts are exact.` }
    if (got > expected) return { tone: 'over', text: `Mixes to ${got} of ${expected} — that is ${got - expected} too many.` }
    return { tone: 'short', text: `Mixes to ${got} of ${expected} — ${expected - got} left unassigned.` }
  }
  const setMix = (section: 'A' | 'B', type: QuestionType, count: number) => {
    const record = { ...mixFor(section), [type]: count }
    if (count <= 0) delete record[type]
    const filled = Object.keys(record).length
    setSectionFormats((old) => ({ ...old, [section]: filled ? record : { [sectionTypes[section]]: section === 'A' ? plannedCompulsory : plannedOptional } }))
  }
  const clearMix = (section: 'A' | 'B') =>
    setSectionFormats((old) => {
      const next = { ...old }
      delete next[section]
      return next
    })
  // The mix plans that actually go over the wire — single-type entries are
  // already expressed by sectionTypes and are omitted here.
  const mixBlueprint = useMemo(() => {
    const out: Partial<Record<'A' | 'B', Partial<Record<QuestionType, number>>>> = {}
    for (const section of ['A', 'B'] as const) {
      const f = sectionFormats[section]
      if (f !== undefined && f !== null && typeof f === 'object') out[section] = f as Partial<Record<QuestionType, number>>
    }
    return out
  }, [sectionFormats])
  const [manualFigureCount, setManualFigureCount] = useState<number | null>(null)
  const [figureStyle, setFigureStyle] = useState<FigureStyle>('clean')
  // Where the paper's pictures come from — per paper, not a school-wide setting.
  const [figureSource, setFigureSource] = useState<FigureSource>('auto')
  const [busy, setBusy] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [sheet, setSheet] = useState<SheetSection[] | null>(null)
  const [instructions, setInstructions] = useState('')
  const [message, setMessage] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  // Live steps for the Thinking Drawer while a paper is being written.
  const [thinking, setThinking] = useState<ThinkingState | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // If the teacher navigates away mid-generation, stop the stream and let the
  // server stop after its current call.
  useEffect(() => () => abortRef.current?.abort(), [])

  const plannedCompulsory = clamp(compulsory, 1, MAX_PAPER)
  const plannedOptional = withOptional ? clamp(optional, 0, MAX_PAPER) : 0
  const plannedAny = withOptional ? clamp(answerAny, 0, Math.max(1, plannedOptional)) : 0
  const plannedTotal = plannedCompulsory + plannedOptional
  const plannedMarks = plannedCompulsory * clamp(marks, 1, 10) + plannedAny * clamp(marks, 1, 10)
  const plannedFigures = Math.min(Math.min(MAX_FIGURES, plannedTotal), manualFigureCount ?? autoFigureCount(plannedTotal))
  const touch = (key: string) => setTouched((old) => ({ ...old, [key]: true }))
  const subjectInvalid = touched.subject && !subject.trim()
  const countInvalid = touched.compulsory && plannedCompulsory < 1
  // An optional section the candidate must answer in full is just more
  // compulsory work, so the server folds it into Section A.
  const foldsToCompulsory = plannedOptional > 0 && plannedAny >= plannedOptional

  // The stepper above the workspace reflects where the teacher actually is:
  // Shape while configuring, Illustrate while the AI writes and draws, Review
  // once a paper exists and is being previewed before publish.
  const progressStep = busy ? 2 : sheet && sheet.length > 0 ? 3 : 1

  // Adopt a generated paper (also carries the figure/note envelope) into the
  // sheet state. One title, one source of truth: the AI's title goes into
  // `title`, which is both what the A4 preview prints and what publish sends.
  const applyPaper = (r: PaperPayload) => {
    if (!r.paper) {
      setMessage({ text: 'No paper returned — try again or reduce the counts.', tone: 'error' })
      notify('info', 'No paper returned — try again or reduce the counts.')
      return
    }
    setInstructions(r.paper.instructions || '')
    setTitle(r.paper.paperTitle || title.trim() || `${subject} paper`)
    // One sheet, several bands: questions stay in generation order, and the
    // numbers run straight through from 1 to N.
    setSheet(
      r.paper.sections.map((sec) => ({
        title: sec.title,
        kind: sec.kind,
        answerAny: sec.answerAny ?? null,
        type: sec.type || 'multiple-choice',
        instruction: sec.instruction || '',
        questions: sec.questions.map((q) => ({ ...q, uid: uid.current++ })),
      })),
    )
    const total = r.paper.sections.reduce((a, s) => a + s.questions.length, 0)
    const drawn = r.figures ?? 0
    const text = r.note || `Paper generated — ${total} questions with ${drawn} labelled diagram${drawn === 1 ? '' : 's'}. Preview it below before publishing.`
    setMessage({ text, tone: 'ok' })
    notify('success', 'Exam sheet generated — review before publishing.')
  }

  const cancelGenerate = () => {
    abortRef.current?.abort()
  }

  const generate = async () => {
    if (plannedTotal > MAX_PAPER) {
      const text = `Maximum ${MAX_PAPER} questions per exam sheet — reduce the counts.`
      setMessage({ text, tone: 'error' })
      notify('error', text)
      return
    }
    // A strict mix must fill its section exactly — the generator never pads or
    // borrows across formats, so a short tally means a short section.
    for (const section of ['A', 'B'] as const) {
      if (!isMix(section)) continue
      const state = mixState(section)
      if (state.tone !== 'ok') {
        const text = `Section ${section} ${state.text.toLowerCase().replace(/—.*$/, '')}`
        setMessage({ text, tone: 'error' })
        notify('error', text)
        return
      }
    }
    setBusy(true)
    setMessage(null)
    const controller = new AbortController()
    abortRef.current = controller
    setThinking({ steps: [], status: 'running', error: null })
    try {
      // The streamed twin of /ai/paper: each step lands in the Thinking Drawer
      // the moment the server has it, instead of one opaque minutes-long wait.
      const r = await api.aiPaperStream(
        {
          subject,
          classLevel,
          type: sectionTypes.A,
          blueprint: {
            marks: clamp(marks, 1, 10),
            coverage: coverage.trim(),
            compulsory: plannedCompulsory,
            optional: plannedOptional,
            answerAny: plannedAny,
            sectionTypes,
            ...(Object.keys(mixBlueprint).length ? { sectionFormats: mixBlueprint } : {}),
            figures: plannedFigures,
            figureStyle,
            figureSource,
          },
        },
        {
          signal: controller.signal,
          onStep: (step) => setThinking((t) => (t ? { ...t, steps: [...t.steps, step] } : t)),
        },
      )
      applyPaper(r)
      setThinking((t) => (t ? { ...t, status: 'done' } : t))
    } catch (err) {
      const cancelled = controller.signal.aborted
      if (cancelled) {
        setThinking((t) => (t ? { ...t, status: 'cancelled', error: null } : t))
      } else {
        const text = err instanceof Error ? err.message : 'Generation failed'
        setThinking((t) => (t ? { ...t, status: 'error', error: text } : t))
        setMessage({ text, tone: 'error' })
        notify('error', text)
      }
    } finally {
      setBusy(false)
    }
  }

  const total = sheet ? sheet.reduce((a, s) => a + s.questions.length, 0) : 0
  const flatten = (): Question[] => (sheet || []).flatMap((s) => s.questions.map(({ uid: _uid, ...q }) => q))

  const removeQ = (qid: number) =>
    setSheet((old) =>
      old
        ?.map((s) => ({ ...s, questions: s.questions.filter((q) => q.uid !== qid) }))
        .filter((s) => s.questions.length > 0) ?? null,
    )

  // Reorder across the whole sheet, not per section: question 20 can move up
  // into Section A's tail and question 21 moves down, section sizes stay put.
  const moveQ = (qid: number, dir: -1 | 1) =>
    setSheet((old) => {
      if (!old) return old
      const flat = old.flatMap((s) => s.questions)
      const i = flat.findIndex((q) => q.uid === qid)
      const j = i + dir
      if (i === -1 || j < 0 || j >= flat.length) return old
      const next = [...flat]
      ;[next[i], next[j]] = [next[j], next[i]]
      let k = 0
      return old.map((s) => ({ ...s, questions: next.slice(k, (k += s.questions.length)) }))
    })

  const addSection = () =>
    setSheet((old) => (old ? [...old, { title: `SECTION ${String.fromCharCode(65 + old.length)}`, kind: 'compulsory', answerAny: null, instruction: 'Answer ALL questions in this section.', questions: [] }] : old))

  const patchSection = (i: number, patch: Partial<Omit<SheetSection, 'questions'>>) =>
    setSheet((old) => old?.map((s, x) => (x === i ? { ...s, ...patch } : s)) ?? null)

  const removeSection = (i: number) => setSheet((old) => (old ? old.filter((_, x) => x !== i) : old))

  const publish = async () => {
    if (!title.trim()) return setMessage({ text: 'Give the exam a title', tone: 'error' })
    if (!sheet || total === 0) return setMessage({ text: 'The sheet has no questions yet', tone: 'error' })
    setPublishing(true)
    setMessage(null)
    try {
      // An optional band that lost questions while editing can end up smaller
      // than its quota; anything with nothing left to choose from becomes
      // compulsory so the student screen never shows a pointless choice.
      const sections: ExamSection[] = sheet.flatMap((s): ExamSection[] => {
        const count = s.questions.length
        if (count === 0) return []
        const answerAny = s.kind === 'optional' ? clamp(s.answerAny ?? 0, 0, count) : 0
        const type = s.type || 'multiple-choice'
        if (answerAny <= 0) return [{ title: s.title, kind: 'compulsory', count, answerAny: null, type }]
        return [{ title: s.title, kind: 'optional', count, answerAny, type }]
      })
      await api.createExam({
        title: title.trim(),
        subject: subject.trim() || null,
        class_level: classLevel || null,
        duration_minutes: Number(duration) || 30,
        questions: flatten(),
        sections,
      })
      setMessage({ text: 'Published. Open “Exams & results” to assign it to students.', tone: 'ok' })
      notify('success', 'Exam published. Assign it to students in Exams & results.')
      setSheet(null)
      setInstructions('')
    } catch (err) {
      const text = err instanceof Error ? err.message : 'Publish failed'
      setMessage({ text, tone: 'error' })
      notify('error', text)
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="sheet-workspace">
      <div className="sheet-progress" aria-label="Exam sheet progress">
        <div className="sheet-progress-line"><span style={{ width: `${(progressStep - 1) * 50}%` }} /></div>
        <div className={`sheet-progress-step${progressStep === 1 ? ' active' : ''}${progressStep > 1 ? ' done' : ''}`}><span>{progressStep > 1 ? <Icon name="check" size={13} /> : 1}</span><strong>Shape</strong><small>Set the paper</small></div>
        <div className={`sheet-progress-step${progressStep === 2 ? ' active' : ''}${progressStep > 2 ? ' done' : ''}`}><span>{progressStep > 2 ? <Icon name="check" size={13} /> : 2}</span><strong>Illustrate</strong><small>Add diagrams</small></div>
        <div className={`sheet-progress-step${progressStep === 3 ? ' active' : ''}`}><span>3</span><strong>Review</strong><small>Preview and publish</small></div>
      </div>

      {message && (
        <p className={`sheet-message ${message.tone === 'ok' ? 'hint' : 'error'}`} style={{ fontWeight: 600, whiteSpace: 'pre-line' }}>{message.text}</p>
      )}

      {!sheet && (
        <div className="panel sheet-setup-card">
          <div className="panel-head sheet-card-head"><div><p className="kicker">AI paper studio</p><h2 className="row" style={{ gap: 8 }}><Icon name="file" size={17} /> Build the exam paper</h2><p className="hint">Set the essentials first. The AI will keep the paper structure, labels and numbering consistent.</p></div></div>
          <div className="panel-body">
            <section className="sheet-card sheet-card-meta">
              <div className="sheet-card-title"><span className="sheet-card-index">01</span><div><h3>Paper identity</h3><p>Give the assessment a clear name students will recognise.</p></div></div>
              <div className="grid-2 sheet-meta-grid">
              <div className="field sheet-field"><label htmlFor="sheet-title">Exam title</label><input id="sheet-title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => touch('title')} aria-invalid={touched.title && !title.trim() ? true : undefined} /><span className={`field-hint ${touched.title && !title.trim() ? 'sheet-hint-error' : ''}`}>{touched.title && !title.trim() ? 'Add a title so the paper is easy to find later.' : 'Shown at the top of the printed paper.'}</span></div>
              <div className="field sheet-field"><label htmlFor="sheet-subject">Subject</label><input id="sheet-subject" value={subject} onChange={(e) => setSubject(e.target.value)} onBlur={() => touch('subject')} aria-invalid={subjectInvalid ? true : undefined} /><span className={`field-hint ${subjectInvalid ? 'sheet-hint-error' : ''}`}>{subjectInvalid ? 'Add the subject before generating.' : 'Used to guide the question writer and diagram labels.'}</span></div>
              <div className="field sheet-field"><label htmlFor="sheet-class">Class</label>
                <select id="sheet-class" value={classLevel} onChange={(e) => setClassLevel(e.target.value)}>
                  {['JSS1', 'JSS2', 'JSS3', 'SS1', 'SS2', 'SS3'].map((c) => <option key={c}>{c}</option>)}
                </select>
                <span className="field-hint">Sets the expected level of language and difficulty.</span>
              </div>
              <div className="field sheet-field"><label htmlFor="sheet-duration">Duration (minutes)</label><input id="sheet-duration" type="number" min={1} value={duration} onChange={(e) => setDuration(Number(e.target.value))} onBlur={() => touch('duration')} /><span className="field-hint">The timer students will see during the exam.</span></div>
              <div className="field sheet-field"><label htmlFor="sheet-question-type">Section A format</label>
                {!isMix('A') ? (
                  <select id="sheet-question-type" value={sectionTypes.A} onChange={(e) => setSectionType('A', e.target.value as QuestionType)}>
                    <option value="multiple-choice">Multiple choice</option>
                    <option value="essay">Essay</option>
                    <option value="theory">Theory</option>
                  </select>
                ) : (
                  <select id="sheet-question-type" value="mixed" disabled aria-label="Section A format (mixed)">
                    <option value="mixed">Mixed — multiple formats</option>
                  </select>
                )}
                <span className="field-hint">Sections can mix formats — fine-tune B below, or split Section A in the paper-shape card.</span>
              </div>
            </div>
            </section>

            <section className="sheet-card sheet-card-shape">
            <div className="sheet-card-title"><span className="sheet-card-index">02</span><div><h3>Paper shape</h3><p>Group related questions into a simple marking structure.</p></div></div>
            <p className="hint sheet-section-intro">
              You choose the size. The AI writes every section and decides which topics go where — the whole paper comes back as
              <strong> one sheet</strong>, numbered 1 to {plannedTotal || 0} straight through.
            </p>

            <div className="sheet-format-presets" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '4px 0 12px' }}>
              <span className="kicker" style={{ alignSelf: 'center' }}>Format</span>
              <button type="button" className="btn secondary sm" onClick={() => applyPreset({ A: 'multiple-choice', B: 'multiple-choice' })}>All multiple choice</button>
              <button type="button" className="btn secondary sm" onClick={() => applyPreset({ A: 'theory', B: 'multiple-choice' })}>Section A theory · B MCQ</button>
              <button type="button" className="btn secondary sm" onClick={() => applyPreset({ A: 'multiple-choice', B: 'essay' })}>Section A MCQ · B essay</button>
              <button type="button" className="btn secondary sm" onClick={() => applyPreset({ A: 'essay', B: 'essay' })}>All essay</button>
            </div>

            <div className="sheet-section-card">
              <div className="panel-head">
                <h2 style={{ fontSize: 15 }}>SECTION A — Compulsory</h2>
                <span className="tag gold">Answer all</span>
              </div>
              <div className="panel-body">
                <div className="field" style={{ maxWidth: 260 }} data-type-badge="A">
                  <label>Question format</label>
                  {!isMix('A') ? (
                    <select value={sectionTypes.A} onChange={(e) => setSectionType('A', e.target.value as QuestionType)} aria-label="Section A question format">
                      <option value="multiple-choice">Multiple choice — auto-marked</option>
                      <option value="essay">Essay — written answer</option>
                      <option value="theory">Theory — written answer</option>
                    </select>
                  ) : (
                    <div className="sheet-mix-editor" style={{ display: 'grid', gap: 8 }}>
                      {FORMAT_TYPES.map((type) => (
                        <label key={type} className="sheet-mix-row flex" style={{ alignItems: 'center', gap: 8, fontSize: 13 }}>
                          <span className="grow">{type === 'multiple-choice' ? 'Multiple choice' : type === 'essay' ? 'Essay' : 'Theory'}</span>
                          <input
                            type="number"
                            min={0}
                            max={plannedCompulsory}
                            value={mixFor('A')[type] ?? 0}
                            onChange={(e) => setMix('A', type, Number(e.target.value))}
                            aria-label={`Section A ${type} count`}
                            className="sheet-mix-input"
                            style={{ width: 64, textAlign: 'right' }}
                          />
                        </label>
                      ))}
                      <p className={`hint ${mixState('A').tone === 'ok' ? '' : 'sheet-hint-error'}`} style={{ margin: 0 }}>{mixState('A').text}</p>
                      <button type="button" className="btn secondary sm" onClick={() => clearMix('A')}>Use one format instead</button>
                    </div>
                  )}
                </div>
                {!isMix('A') ? (
                  <button type="button" className="btn secondary sm" style={{ alignSelf: 'start' }} onClick={() => setSectionFormats((old) => ({ ...old, A: { 'multiple-choice': plannedCompulsory } }))}>
                    <Icon name="sliders" size={13} /> Mix formats
                  </button>
                ) : null}
                <div className="grid-3" style={{ gap: 10 }}>
                  <div className="field">
                    <label>Questions (1 – {MAX_PAPER})</label>
                    <input type="number" min={1} max={MAX_PAPER} value={compulsory} onChange={(e) => setCompulsory(Number(e.target.value))} onBlur={() => touch('compulsory')} aria-invalid={countInvalid ? true : undefined} />
                  </div>
                  <div className="field">
                    <label>Marks each</label>
                    <input type="number" min={1} max={10} value={marks} onChange={(e) => setMarks(Number(e.target.value))} />
                  </div>
                  <div className="field">
                    <label>Question numbers</label>
                    <input value={`1 – ${plannedCompulsory}`} readOnly disabled />
                  </div>
                </div>
                <p className="hint" style={{ margin: '8px 0 0' }}>Every candidate answers all of these. Questions {1}–{plannedCompulsory}.</p>
              </div>
            </div>

            <div className="sheet-section-card optional-card">
              <div className="panel-head">
                <h2 style={{ fontSize: 15 }}>SECTION B — Optional</h2>
                <label className="flex" style={{ alignItems: 'center', gap: 8, fontSize: 13 }}>
                  <input type="checkbox" checked={withOptional} onChange={(e) => {
                    const on = e.target.checked
                    setWithOptional(on)
                    if (!on) setSectionFormats((old) => {
                      const next = { ...old }
                      delete next.B
                      return next
                    })
                  }} style={{ width: 16, height: 16 }} />
                  Add an optional section
                </label>
              </div>
              <div className="panel-body">
                <div className="field" style={{ maxWidth: 260 }} data-type-badge="B">
                  <label>Question format</label>
                  {!isMix('B') ? (
                    <select value={sectionTypes.B} disabled={!withOptional} onChange={(e) => setSectionType('B', e.target.value as QuestionType)} aria-label="Section B question format">
                      <option value="multiple-choice">Multiple choice — auto-marked</option>
                      <option value="essay">Essay — written answer</option>
                      <option value="theory">Theory — written answer</option>
                    </select>
                  ) : (
                    <div className="sheet-mix-editor" style={{ display: 'grid', gap: 8 }}>
                      {FORMAT_TYPES.map((type) => (
                        <label key={type} className="sheet-mix-row flex" style={{ alignItems: 'center', gap: 8, fontSize: 13 }}>
                          <span className="grow">{type === 'multiple-choice' ? 'Multiple choice' : type === 'essay' ? 'Essay' : 'Theory'}</span>
                          <input
                            type="number"
                            min={0}
                            max={plannedOptional}
                            value={mixFor('B')[type] ?? 0}
                            disabled={!withOptional}
                            onChange={(e) => setMix('B', type, Number(e.target.value))}
                            aria-label={`Section B ${type} count`}
                            className="sheet-mix-input"
                            style={{ width: 64, textAlign: 'right' }}
                          />
                        </label>
                      ))}
                      <p className={`hint ${mixState('B').tone === 'ok' ? '' : 'sheet-hint-error'}`} style={{ margin: 0 }}>{mixState('B').text}</p>
                      <button type="button" className="btn secondary sm" disabled={!withOptional} onClick={() => clearMix('B')}>Use one format instead</button>
                    </div>
                  )}
                </div>
                {!isMix('B') ? (
                  <button type="button" className="btn secondary sm" style={{ alignSelf: 'start' }} disabled={!withOptional} onClick={() => setSectionFormats((old) => ({ ...old, B: { 'multiple-choice': plannedOptional } }))}>
                    <Icon name="sliders" size={13} /> Mix formats
                  </button>
                ) : null}
                <div className="grid-3" style={{ gap: 10 }}>
                  <div className="field">
                    <label>Questions to print</label>
                    <input type="number" min={0} max={MAX_PAPER} value={optional} disabled={!withOptional} onChange={(e) => setOptional(Number(e.target.value))} />
                  </div>
                  <div className="field">
                    <label>Candidate answers any</label>
                    <input type="number" min={0} max={MAX_PAPER} value={answerAny} disabled={!withOptional} onChange={(e) => setAnswerAny(Number(e.target.value))} />
                  </div>
                  <div className="field">
                    <label>Question numbers</label>
                    <input value={withOptional && plannedOptional > 0 ? `${plannedCompulsory + 1} – ${plannedTotal}` : '—'} readOnly disabled />
                  </div>
                </div>
                <p className="hint" style={{ margin: '8px 0 0' }}>
                  {withOptional && plannedOptional > 0
                    ? foldsToCompulsory
                      ? `Answering all ${plannedOptional} means there is nothing to choose — this becomes part of Section A instead.`
                      : `The candidate picks any ${plannedAny} of these ${plannedOptional}; only the chosen ones are marked.`
                    : 'No optional section — the paper is Section A only.'}
                </p>
              </div>
            </div>
            </section>

            <div className="sheet-figure-plan">
              <div className="sheet-figure-plan-head">
                <div>
                  <p className="kicker">Illustration plan</p>
                  <h2>Make the paper visual</h2>
                  <p className="hint">The AI will draw clean, labelled school diagrams and place them directly into the paper preview.</p>
                </div>
                <div className="sheet-figure-count" aria-live="polite">
                  <strong>{plannedFigures}</strong>
                  <span>of {plannedTotal} questions illustrated</span>
                </div>
              </div>
              <div className="sheet-figure-controls">
                <input
                  type="range"
                  min={0}
                  max={Math.min(MAX_FIGURES, Math.max(1, plannedTotal))}
                  value={plannedFigures}
                  onChange={(e) => setManualFigureCount(Number(e.target.value))}
                  aria-label="Number of questions with labelled diagrams"
                  disabled={plannedTotal === 0}
                />
                <div className="sheet-figure-presets">
                  <button type="button" className="btn secondary sm" onClick={() => setManualFigureCount(null)}>Auto · 1 in 3</button>
                  <button type="button" className="btn secondary sm" onClick={() => setManualFigureCount(Math.min(10, plannedTotal))}>10 diagrams</button>
                  <button type="button" className="btn secondary sm" onClick={() => setManualFigureCount(Math.min(MAX_FIGURES, plannedTotal))}>Illustrate all</button>
                  <Segmented
                    value={figureStyle}
                    onChange={setFigureStyle}
                    ariaLabel="Diagram style"
                    options={[
                      { value: 'clean', label: 'Clean labels', icon: 'sliders' },
                      { value: 'pencil', label: 'Pencil', icon: 'edit' },
                    ]}
                  />
                  <Segmented
                    value={figureSource}
                    onChange={setFigureSource}
                    ariaLabel="Picture source"
                    options={[
                      { value: 'auto', label: 'Auto', icon: 'refresh' },
                      { value: 'ai', label: 'AI only', icon: 'edit' },
                      { value: 'web', label: 'Web photos', icon: 'search' },
                    ]}
                  />
                </div>
                <p className="hint" style={{ margin: '8px 0 0' }}>
                  {figureSource === 'web'
                    ? 'Real, freely licensed diagrams from Wikimedia Commons/Openverse — no AI drawing, credits attached to each picture.'
                    : figureSource === 'ai'
                      ? 'The AI draws every diagram; nothing is fetched from the web.'
                      : 'The AI draws the diagrams, and freely licensed web pictures step in when a draw fails.'}
                </p>
              </div>
            </div>

            <section className="sheet-card sheet-card-brief">
              <div className="sheet-card-title"><span className="sheet-card-index">03</span><div><h3>Content direction</h3><p>Optional guidance helps the AI balance the paper around your priorities.</p></div></div>
              <div className="field sheet-field" style={{ marginTop: 12 }}>
              <label htmlFor="sheet-coverage">What the AI should cover <span className="muted">(optional)</span></label>
              <textarea id="sheet-coverage" rows={2} value={coverage} onChange={(e) => setCoverage(e.target.value)} placeholder="e.g. Number theory, algebra, geometry and statistics, with harder algebra last." />
              <span className="field-hint">Leave blank for a balanced syllabus spread.</span>
              </div>
            </section>

            <p className="hint" style={{ margin: '10px 0 0' }}>
              One paper · <strong>{plannedTotal} questions</strong> numbered 1 – {plannedTotal} · <strong>{plannedMarks} marks</strong>{' '}
                {withOptional && plannedOptional > 0 ? `· Section A: all ${plannedCompulsory}, Section B: any ${plannedAny} of ${plannedOptional}` : `· all compulsory`}
            </p>

            <div className="sheet-generate-bar">
              <div><strong>{plannedTotal} questions</strong><span>{plannedFigures} labelled diagrams · {plannedMarks} marks</span></div>
              <button className="btn primary" disabled={busy || !subject.trim() || plannedCompulsory < 1} onClick={() => void generate()}>
                {busy ? <><Spinner size="sm" label="" /> Generating the full paper (up to 60s)…</> : 'Generate exam paper with AI'}
              </button>
            </div>
            <p className="hint" style={{ margin: '10px 0 0' }}>
              Uses <strong>ai/paper</strong>. After generating you can rewrite, vary, reorder and edit any question before publishing.
            </p>
          </div>
        </div>
      )}

      {sheet && sheet.length > 0 && (
        <ExamSheet
          sheet={sheet}
          title={title}
          onTitle={setTitle}
          instructions={instructions}
          subject={subject}
          classLevel={classLevel}
          duration={duration}
          marks={marks}
          onSheet={setSheet}
          onReset={() => { setSheet(null); setInstructions('') }}
          onRemove={removeQ}
          onMove={moveQ}
          onPatchSection={patchSection}
          onAddSection={addSection}
          onRemoveSection={removeSection}
          onPublish={() => void publish()}
          publishing={publishing}
          figureStyle={figureStyle}
          figureSource={figureSource}
        />
      )}
      {thinking ? (
        <ThinkingDrawer
          thinking={thinking}
          onCancel={cancelGenerate}
          onClose={() => setThinking(null)}
        />
      ) : null}
    </div>
  )
}

function ExamSheet({ sheet, title, onTitle, instructions, subject, classLevel, duration, marks, onSheet, onReset, onRemove, onMove, onPatchSection, onAddSection, onRemoveSection, onPublish, publishing, figureStyle, figureSource }: {
  sheet: SheetSection[]
  title: string
  onTitle: (t: string) => void
  instructions: string
  subject: string
  classLevel: string
  duration: number
  marks: number
  onSheet: (s: SheetPatch) => void
  onReset: () => void
  onRemove: (qid: number) => void
  onMove: (qid: number, dir: -1 | 1) => void
  onPatchSection: (i: number, patch: Partial<Omit<SheetSection, 'questions'>>) => void
  onAddSection: () => void
  onRemoveSection: (i: number) => void
  onPublish: () => void
  publishing: boolean
  figureStyle: FigureStyle
  figureSource: FigureSource
}) {
  const [editing, setEditing] = useState<SheetQ | null>(null)
  const [variantsFor, setVariantsFor] = useState<(SheetQ & { variants: Question[] }) | null>(null)
  const [busyQ, setBusyQ] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [convertText, setConvertText] = useState('')
  const [converting, setConverting] = useState(false)
  const [showA4, setShowA4] = useState(true)
  const [pictureFor, setPictureFor] = useState<SheetQ | null>(null)
  const [picturePrompt, setPicturePrompt] = useState('')
  const [pictureBusy, setPictureBusy] = useState(false)
  const [figBusy, setFigBusy] = useState(false)

  // Draws labelled figures for every question on the sheet that does not have one
  // yet, in small parallel batches — the whole paper gets pictures at once.
  // Uses the currently selected figureSource (auto/ai/web).
  const drawAllFigures = async () => {
    const flat = sheet.flatMap((s) => s.questions)
    const missing = flat.filter((q) => !q.figure)
    if (missing.length === 0) {
      notify('info', 'Every question already has a figure.')
      return
    }
    setFigBusy(true)
    setNote('')
    let made = 0
    let failed = 0
    try {
      // One batched request for the whole sheet rather than N round trips. The
      // server draws these four at a time under a wall-clock budget, so the tab
      // cannot be left waiting on a slow engine for a dozen separate diagrams.
      // `style` matters here: the Pencil/Clean toggle above was being dropped,
      // so "Draw all" silently produced pencil figures whatever was selected.
      // `source` honours the sheet's Picture source toggle: 'web' asks for real
      // licensed diagrams from Wikimedia etc., 'ai' draws only, 'auto' draws first
      // and falls back to the web when a draw fails.
      const r = await api.aiFigures({
        questions: missing.map((q) => ({ prompt: q.prompt, subject: q.subject || null })),
        style: figureStyle,
        source: figureSource,
      })
      r.results.forEach((row, i) => {
        if (row?.ok && row.image) {
          setFigureResult(missing[i].uid, row.image, row.credit ?? null)
          made += 1
        } else {
          failed += 1
        }
      })
      const msg = `Done — ${made} labelled figure${made === 1 ? '' : 's'} drawn${failed ? `, ${failed} could not be drawn` : ''}.`
      setNote(msg)
      notify(made > 0 ? 'success' : 'info', msg)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not draw the figures.'
      setNote(msg)
      notify('error', msg)
    } finally {
      setFigBusy(false)
    }
  }

  const formatQuestion = (q: Question) =>
    `${q.prompt}\n${q.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n')}`

  // A theory/essay question has no options to auto-mark: it is a stem plus a
  // handwritten answer. The AI stamps `qtype` on these; older or hand-added
  // ones are recognised by having no options at all.
  const theoryQ = (q: SheetQ) => q.qtype === 'theory' || q.qtype === 'essay' || q.options.length === 0

  const editQ = (patch: Partial<Question>) => {
    if (!editing) return
    onSheet(sheet.map((s) => ({ ...s, questions: s.questions.map((q) => (q.uid === editing.uid ? { ...q, ...patch, answer: Number(patch.answer ?? q.answer) } : q)) })))
    setEditing((old) => (old ? { ...old, ...patch } : old))
  }

  const rewrite = async (q: SheetQ) => {
    setBusyQ(q.uid)
    setNote('')
    try {
      const r = await api.aiRewrite({ question: formatQuestion(q), difficulty: q.difficulty || 'medium' })
      const fresh = r.questions[0]
      if (fresh) {
        onSheet(sheet.map((s) => ({ ...s, questions: s.questions.map((x) => (x.uid === q.uid ? { ...x, ...fresh, figure: fresh.figure ?? x.figure, uid: q.uid } : x)) })))
        setNote('Rewritten with ai/rewrite.')
        notify('success', 'Question rewritten.')
      } else {
        notify('info', 'No rewritten question returned.')
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Rewrite failed')
      notify('error', err instanceof Error ? err.message : 'Rewrite failed')
    } finally {
      setBusyQ(null)
    }
  }

  const loadVariants = async (q: SheetQ) => {
    setBusyQ(q.uid)
    setNote('')
    try {
      const r = await api.aiVariants({ question: formatQuestion(q), count: 3 })
      if (r.questions.length) {
        setVariantsFor({ ...q, variants: r.questions })
        notify('success', `${r.questions.length} variants ready.`)
      } else {
        setNote('No variants returned.')
        notify('info', 'No variants returned.')
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Variants failed')
      notify('error', err instanceof Error ? err.message : 'Variants failed')
    } finally {
      setBusyQ(null)
    }
  }

  const replaceWithVariant = (qid: number, v: Question) => {
    onSheet(sheet.map((s) => ({ ...s, questions: s.questions.map((q) => (q.uid === qid ? { ...q, ...v, figure: v.figure ?? q.figure, uid: qid } : q)) })))
    setVariantsFor(null)
    setNote('Replaced with an ai/variants clone.')
    notify('success', 'Question replaced with variant.')
  }

  const saveToBank = async (q: SheetQ) => {
    setBusyQ(q.uid)
    setNote('')
    try {
      await api.createQuestion({ ...q })
      setNote('Saved to the question bank.')
      notify('success', 'Saved to the question bank.')
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Save failed')
      notify('error', err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusyQ(null)
    }
  }

  const setFigure = (qid: number, src: string | null) =>
    onSheet((old) => (old || []).map((s) => ({ ...s, questions: s.questions.map((q) => (q.uid === qid ? { ...q, figure: src } : q)) })))

  // Attach a figure and keep the web provenance that comes with it, so a reused
  // Wikimedia picture stays visibly credited when the paper is published.
  const setFigureResult = (qid: number, image: string, credit: Question['figureCredit']) =>
    onSheet((old) => (old || []).map((s) => ({ ...s, questions: s.questions.map((q) => (q.uid === qid ? { ...q, figure: image, figureCredit: credit || q.figureCredit } : q)) })))

  // Regenerates ALL pictures for the current exam using the web source,
  // replacing any existing figures with freshly fetched web diagrams.
  // This runs outside the normal figureSource setting so teachers can force
  // a web-only re-fetch even if the sheet is set to 'ai' or 'auto'.
  const regenerateWebFigures = async () => {
    const flat = sheet.flatMap((s) => s.questions)
    setFigBusy(true)
    setNote('')
    let made = 0
    let failed = 0
    try {
      const r = await api.aiFigures({
        questions: flat.map((q) => ({
          prompt: `${q.prompt} — clean school diagram with clear visible labels for a ${subject || 'exam'} question, with important concepts highlighted`,
          subject: q.subject || null,
        })),
        style: figureStyle,
        source: 'web',
      })
      r.results.forEach((row, i) => {
        if (row?.ok && row.image) {
          setFigureResult(flat[i].uid, row.image, row.credit ?? null)
          made += 1
        } else {
          failed += 1
        }
      })
      const msg = `Done — ${made} labelled figure${made === 1 ? '' : 's'} re-fetched from web${failed ? `, ${failed} failed` : ''}.`
      setNote(msg)
      notify(made > 0 ? 'success' : 'info', msg)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not re-fetch web figures.'
      setNote(msg)
      notify('error', msg)
    } finally {
      setFigBusy(false)
    }
  }

  // Uses the same picture studio engine (ai/image) so every question can carry a
  // labelled visual, not just the ones ai/paper auto-illustrates.
  const generatePicture = async () => {
    if (!pictureFor) return
    setPictureBusy(true)
    setNote('')
    try {
      const prompt = `${picturePrompt.trim() || pictureFor.prompt} — clean school diagram or picture for an exam question, with clear, visible labels.`
      // `style` was not passed here, so the sheet's Pencil/Clean choice did not
      // reach the picture engine and the SVG fallback always came back pencil.
      const r = await api.aiImage({ prompt, size: '4:5', count: 1, style: figureStyle, source: figureSource })
      if (r.images?.[0]) {
        // When the studio answered from the web the source list carries the
        // licence/artist per slot — keep that on the question.
        const webCredit = r.imageSources?.[0]
        setFigureResult(pictureFor.uid, r.images[0], webCredit
          ? { title: webCredit.title, credit: webCredit.artist || webCredit.license || 'Wikimedia Commons', license: webCredit.license, sourceUrl: webCredit.sourceUrl }
          : null)
        setNote('Picture attached to this question — it renders with its labels in the sheet, A4 preview and the student paper.')
        notify('success', 'Picture attached to this question.')
        setPictureFor(null)
        setPicturePrompt('')
      } else {
        setNote('No picture returned — try a clearer prompt or another phrasing.')
        notify('info', 'No picture returned — try a clearer prompt.')
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Picture generation failed')
      notify('error', err instanceof Error ? err.message : 'Picture generation failed')
    } finally {
      setPictureBusy(false)
    }
  }

  // Consecutive figure numbers ("Fig. 1", "Fig. 2"…) across the whole sheet.
  const figNums: Record<number, number> = useMemo(() => {
    const map: Record<number, number> = {}
    let n = 0
    for (const s of sheet) for (const q of s.questions) if (q.figure) map[q.uid] = ++n
    return map
  }, [sheet])

  // The single source of truth for numbering: question numbers run 1..N across
  // every section, so the editor, the A4 print and the student paper agree.
  const { numbers, bands } = useMemo(() => {
    const numbers = new Map<number, number>()
    const bands: { sec: SheetSection; start: number; end: number }[] = []
    let n = 0
    for (const sec of sheet) {
      const start = n + 1
      for (const q of sec.questions) numbers.set(q.uid, ++n)
      bands.push({ sec, start, end: n + 1 })
    }
    return { numbers, bands }
  }, [sheet])

  const convert = async () => {
    setConverting(true)
    setNote('')
    try {
      const r = await api.aiConvert({ text: convertText })
      const add = r.questions.map((q) => ({ ...q, uid: Date.now() + Math.random() }))
      // Past-paper questions join the same sheet as a new compulsory band at
      // the end, so numbering stays unbroken.
      onSheet([
        ...sheet,
        { title: 'ADDITIONAL QUESTIONS', kind: 'compulsory', answerAny: null, instruction: 'Answer ALL questions in this section.', questions: add as SheetQ[] },
      ])
      setConvertText('')
      setNote(`Appended ${add.length} converted questions (ai/convert).`)
      notify('success', `Appended ${add.length} converted questions.`)
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'Convert failed')
      notify('error', err instanceof Error ? err.message : 'Convert failed')
    } finally {
      setConverting(false)
    }
  }

  const total = sheet.reduce((a, s) => a + s.questions.length, 0)
  const figureCount = sheet.reduce((a, s) => a + s.questions.filter((q) => q.figure).length, 0)
  const maxScore = marksFor(sheet)
  const each = clamp(marks, 1, 10)
  const answerLines = instructions
    ? instructions.split('\n').filter((l) => l.trim().length > 0)
    : bands.map((b) => `${b.sec.title} — ${b.sec.instruction}`)

  return (
    <>
      <div className="page-head" style={{ marginBottom: 14 }}>
        <div>
          <input
            className="sheet-title-input"
            value={title}
            onChange={(e) => onTitle(e.target.value)}
            aria-label="Exam title"
            placeholder="Exam title"
          />
          <p className="sub">
            One continuous sheet · {total} questions numbered 1 – {total} · {maxScore * each} marks
            {bands.length > 1 ? ` · ${bands.length} sections` : ''}
            {figureCount > 0 ? ` · ${figureCount} with labelled pictures` : ''} — review before publishing.
          </p>
        </div>
        <div className="flex" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn secondary" disabled={figBusy} onClick={() => void drawAllFigures()} style={{ minHeight: 36 }}>
            {figBusy ? <><Spinner size="sm" label="" /> Drawing {figureCount}/{total}…</> : <><Icon name="image" size={14} /> Draw figures for all ({total - figureCount} left)</>}
          </button>
          <button className="btn secondary" disabled={figBusy || total === 0} onClick={() => void regenerateWebFigures()} style={{ minHeight: 36 }}>
            <Icon name="search" size={14} /> Regenerate web pictures
          </button>
          <button className="btn secondary" onClick={() => setShowA4((v) => !v)}><Icon name="eye" size={14} /> {showA4 ? 'Hide A4 preview' : 'A4 preview'}</button>
          <button className="btn secondary" onClick={() => window.print()}><Icon name="printer" size={14} /> Print A4</button>
          <button className="btn secondary" onClick={onReset}><Icon name="refresh" size={14} /> Regenerate</button>
          <button className="btn primary" disabled={publishing} onClick={onPublish}>{publishing ? 'Publishing…' : <><Icon name="check" size={14} /> Publish exam</>}</button>
        </div>
      </div>
      {note && <p className="hint" style={{ margin: '0 0 12px' }}>{note}</p>}

      {showA4 && (
        <div className="panel a4-preview-wrap" style={{ marginBottom: 16 }}>
          <div className="panel-head">
            <h2>A4 paper preview</h2>
            <button className="btn secondary" onClick={() => window.print()}>Print this page</button>
          </div>
          <div className="panel-body" style={{ overflowX: 'auto' }}>
            <div className="a4-sheet">
              <header className="a4-header">
                <div>
                  <p className="a4-label">T. Gold Brighter Tomorrow Model School</p>
                  <h3>{title}</h3>
                </div>
                <div className="a4-meta">
                  <span>{subject}{classLevel ? ` · ${classLevel}` : ''}</span>
                  <span>{total} questions · {maxScore * each} marks</span>
                  <span>{duration} minutes</span>
                </div>
              </header>

              <div className="a4-instructions">
                <strong>INSTRUCTIONS TO CANDIDATES</strong>
                {answerLines.map((line, i) => <p key={i}>{line}</p>)}
                <p>All questions carry the same number of marks.</p>
              </div>

              {bands.map(({ sec, start, end }) => (
                <section className="a4-section" key={sec.title}>
                  <h4>
                    {sec.title}
                    {sec.kind === 'optional' ? ' — OPTIONAL' : ' — COMPULSORY'}
                    <span style={{ fontWeight: 400, fontSize: 13, display: 'block' }}>
                      {sec.instruction} (Questions {start}–{end - 1})
                    </span>
                  </h4>
                  {sec.questions.map((q) => (
                    <div className="a4-question" key={q.uid}>
                      <p><strong>{numbers.get(q.uid)}.</strong> <MathText text={q.prompt} /></p>
                      {q.figure && <Figure src={q.figure} caption={figNums[q.uid] ? `Fig. ${figNums[q.uid]}` : undefined} />}
                      {theoryQ(q) ? (
                        <p className="muted" style={{ marginTop: 4, fontSize: 12 }}>
                          <em>{q.mark ? `(${q.mark} mark${q.mark === 1 ? '' : 's'} — write your answer below)` : 'Write your answer below.'}</em>
                        </p>
                      ) : (
                        <ol type="A">
                          {q.options.map((o, x) => (
                            <li key={x}><MathText text={o} /></li>
                          ))}
                        </ol>
                      )}
                      {theoryQ(q) && q.markingGuide && (
                        <p style={{ marginTop: 6, fontSize: 12 }}><strong>Marking guide:</strong> <MathText text={q.markingGuide} /></p>
                      )}
                    </div>
                  ))}
                </section>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* One sheet: section bands are headings inside the run, not separate papers. */}
      <div className="panel">
        <div className="panel-head">
          <h2>Exam sheet — questions 1 – {total}</h2>
          <span className="tag gold">{total} questions · {maxScore * each} marks</span>
        </div>
        <div className="panel-body">
          {bands.map(({ sec, start, end }, si) => (
            <div key={sec.title}>
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
                  margin: '18px 0 6px', padding: '10px 12px', borderRadius: 10,
                  background: 'var(--slab-2)', border: '1px solid var(--rule)',
                }}
              >
                <div className="field" style={{ margin: 0, flex: '1 1 220px' }}>
                  <label style={{ fontSize: 11 }}>Section title</label>
                  <input value={sec.title} onChange={(e) => onPatchSection(si, { title: e.target.value })} style={{ minHeight: 34 }} />
                </div>
                <span className={`tag ${sec.kind === 'optional' ? 'blue' : 'gold'}`}>{sec.kind === 'optional' ? 'Optional — answer any' : 'Compulsory — answer all'}</span>
                <div className="field" style={{ margin: 0 }}>
                  <label style={{ fontSize: 11 }}>Format</label>
                  <select
                    value={sec.type || 'multiple-choice'}
                    onChange={(e) => onPatchSection(si, { type: e.target.value as QuestionType })}
                    style={{ minHeight: 34 }}
                    aria-label={`${sec.title} format`}
                  >
                    <option value="multiple-choice">MCQ — auto-marked</option>
                    <option value="essay">Essay — marked by hand</option>
                    <option value="theory">Theory — marked by hand</option>
                  </select>
                </div>
                <span className="muted" style={{ fontSize: 13 }}>Questions {start}–{Math.max(start, end - 1)}</span>
                {sec.kind === 'optional' && (
                  <div className="field" style={{ margin: 0 }}>
                    <label style={{ fontSize: 11 }}>Answer any</label>
                    <input
                      type="number"
                      min={1}
                      max={sec.questions.length}
                      value={sec.answerAny ?? 0}
                      onChange={(e) => onPatchSection(si, { answerAny: Math.max(1, Number(e.target.value) || 1) })}
                      style={{ minHeight: 34, width: 90 }}
                    />
                  </div>
                )}
                {sec.kind === 'optional' && (
                  <button className="btn secondary" onClick={() => onPatchSection(si, { kind: 'compulsory', answerAny: null, instruction: 'Answer ALL questions in this section.' })} style={{ minHeight: 34, padding: '6px 10px' }}>
                    Make compulsory
                  </button>
                )}
                {bands.length > 1 && (
                  <button className="btn danger" onClick={() => onRemoveSection(si)} style={{ minHeight: 34, padding: '6px 10px' }}>
                    <><Icon name="x" size={13} /> Band</>
                  </button>
                )}
              </div>
              <p className="hint" style={{ margin: '0 0 4px' }}>
                {sec.instruction} {sec.kind === 'optional' && sec.questions.length > 0
                  ? `Choose ${Math.min(sec.answerAny ?? 0, sec.questions.length)} of the ${sec.questions.length} questions in this band.`
                  : ''}
              </p>

              {sec.questions.map((q) => (
                <div className="q-row" key={q.uid}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    {editing?.uid === q.uid ? (
                      <InlineEditor
                        q={editing}
                        onSave={(patch) => { editQ(patch); setEditing(null) }}
                        onCancel={() => setEditing(null)}
                      />
                    ) : (
                      <>
                        <strong style={{ fontSize: 14, lineHeight: 1.4, display: 'block' }}>{numbers.get(q.uid)}. <MathText text={q.prompt} /></strong>
                        {q.figure && (
                          <div className="flex" style={{ alignItems: 'flex-start', marginTop: 8, flexWrap: 'wrap' }}>
                            <Figure src={q.figure} caption={figNums[q.uid] ? `Fig. ${figNums[q.uid]}` : undefined} />
                            <div className="flex" style={{ flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                              <button className="btn danger" onClick={() => setFigure(q.uid, null)} style={{ minHeight: 30, padding: '4px 8px' }}><Icon name="x" size={13} /> Remove picture</button>
                              {q.figureCredit?.sourceUrl && (
                                <p className="muted" style={{ fontSize: 12, margin: 0, maxWidth: 240 }}>
                                  <strong>{q.figureCredit.title || 'Web image'}.</strong> {q.figureCredit.credit}{q.figureCredit.license ? ` (${q.figureCredit.license})` : ''}.{' '}
                                  <a href={q.figureCredit.sourceUrl} target="_blank" rel="noreferrer">Source</a>
                                </p>
                              )}
                            </div>
                          </div>
                        )}
                        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                          {q.options.map((o, x) => <span key={x} style={{ marginRight: 12 }}>{String.fromCharCode(65 + x)}. <MathText text={o} /></span>)}
                        </div>
                        <div className="flex" style={{ gap: 6, marginTop: 6 }}>
                          {theoryQ(q) ? (
                            <span className="tag jade">{q.qtype === 'essay' ? 'Essay' : 'Theory'}{(q.mark ? ` · ${q.mark} mark${q.mark === 1 ? '' : 's'}` : '')}</span>
                          ) : (
                            <span className="tag green">Answer {String.fromCharCode(65 + q.answer)}</span>
                          )}
                          {q.difficulty && <span className="tag">{q.difficulty}</span>}
                        </div>
                        {theoryQ(q) && q.markingGuide && (
                          <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}><strong>Marking guide:</strong> <MathText text={q.markingGuide} /></p>
                        )}
                        {q.explanation && <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>— <MathText text={q.explanation} /></p>}
                      </>
                    )}
                  </div>
                  <div className="flex" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button className="btn secondary" onClick={() => { setPicturePrompt(q.prompt); setPictureFor(q) }} style={{ minHeight: 34, padding: '6px 10px' }}><Icon name={q.figure ? 'refresh' : 'image'} size={13} /> {q.figure ? 'Picture' : 'Picture'}</button>
                    <button className="btn secondary" disabled={busyQ === q.uid} onClick={() => rewrite(q)} style={{ minHeight: 34, padding: '6px 10px' }}>Rewrite</button>
                    <button className="btn secondary" disabled={busyQ === q.uid} onClick={() => void loadVariants(q)} style={{ minHeight: 34, padding: '6px 10px' }}>Variants</button>
                    <button className="btn secondary" onClick={() => setEditing({ ...q })} style={{ minHeight: 34, padding: '6px 10px' }}>Edit</button>
                    <button className="btn secondary" disabled={busyQ === q.uid} onClick={() => void saveToBank(q)} style={{ minHeight: 34, padding: '6px 10px' }}>Bank</button>
                    <button className="btn secondary icon sm" aria-label="Move question up" data-tip="Move up" disabled={numbers.get(q.uid) === 1} onClick={() => onMove(q.uid, -1)} style={{ minHeight: 34 }}><Icon name="chevron" size={14} style={{ transform: 'rotate(180deg)' }} /></button>
                    <button className="btn secondary icon sm" aria-label="Move question down" data-tip="Move down" disabled={numbers.get(q.uid) === total} onClick={() => onMove(q.uid, 1)} style={{ minHeight: 34 }}><Icon name="chevron" size={14} /></button>
                    <button className="btn danger icon sm" aria-label="Remove question" data-tip="Remove" onClick={() => onRemove(q.uid)} style={{ minHeight: 34 }}><Icon name="x" size={14} /></button>
                  </div>
                </div>
              ))}
              {sec.questions.length === 0 && <div className="empty">Empty section — remove the band.</div>}
            </div>
          ))}
          {total === 0 && <div className="empty">The sheet is empty — add questions or regenerate.</div>}
        </div>
      </div>

      <div className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head"><h2>Add questions from a past paper (ai/convert)</h2></div>
        <div className="panel-body">
          <textarea value={convertText} rows={4} onChange={(e) => setConvertText(e.target.value)} placeholder="Paste typed/scanned past-exam text…" style={{ width: '100%', border: '1px solid var(--rule)', borderRadius: 6, padding: 10, font: 'inherit' }} />
          <button className="btn secondary" disabled={converting || !convertText.trim()} onClick={() => void convert()} style={{ marginTop: 8 }}>
            {converting ? 'Converting…' : 'Convert and append to this sheet'}
          </button>
        </div>
      </div>

      <button className="btn secondary" onClick={onAddSection} style={{ marginTop: 16 }}>+ Add a section band</button>

      {variantsFor && <VariantsModal q={variantsFor} onPick={replaceWithVariant} onClose={() => setVariantsFor(null)} />}
      {pictureFor && (
        <Modal
          open
          onClose={() => { setPictureFor(null); setPicturePrompt('') }}
          title="Add a picture to this question"
          kicker="Picture studio"
          width={560}
          actions={
            <>
              <Button variant="secondary" onClick={() => { setPictureFor(null); setPicturePrompt('') }}>Cancel</Button>
              <Button variant="primary" loading={pictureBusy} onClick={() => void generatePicture()}>
                Generate and attach
              </Button>
            </>
          }
        >
          <p className="hint" style={{ marginTop: 0 }}>
            The picture studio draws the visual for you — describe it, or leave blank to auto-build
            from the question stem. Labels are rendered clearly and the result appears here, on the A4
            paper and on the student's screen.
          </p>
          <div className="field">
            <label>Describe the picture</label>
            <textarea rows={3} value={picturePrompt} onChange={(e) => setPicturePrompt(e.target.value)} placeholder="Leave blank to auto-build from the question stem" />
          </div>
        </Modal>
      )}
    </>
  )
}

function InlineEditor({ q, onSave, onCancel }: { q: SheetQ; onSave: (patch: Partial<Question>) => void; onCancel: () => void }) {
  // The editor used to write every keystroke straight into the sheet, so the
  // "Cancel" button — which just closed the editor — left the edits in place.
  // A draft plus an explicit commit makes Cancel mean what it says.
  const [draft, setDraft] = useState<Question>(() => ({ ...q }))
  const [answer, setAnswer] = useState<number>(q.answer)
  const setOpt = (i: number, v: string) => setDraft((d) => ({ ...d, options: d.options.map((o, x) => (x === i ? v : o)) }))

  const dirty =
    draft.prompt !== q.prompt ||
    answer !== q.answer ||
    (draft.explanation || '') !== (q.explanation || '') ||
    draft.options.some((o, i) => o !== q.options[i])

  return (
    <div className="panel" style={{ border: '1px solid var(--chalk)' }}>
      <div className="panel-body">
        <div className="field"><label>Question</label>
          <textarea rows={2} value={draft.prompt} onChange={(e) => setDraft((d) => ({ ...d, prompt: e.target.value }))} />
        </div>
        {draft.options.map((opt, i) => (
          <div className="field" key={i}><label>{String.fromCharCode(65 + i)}</label>
            <input value={opt} onChange={(e) => setOpt(i, e.target.value)} />
          </div>
        ))}
        {draft.figure && (
          <div className="field">
            <label>Figure (labels included)</label>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <Figure src={draft.figure} className="thumb" />
              <Button variant="danger" size="sm" icon="trash" onClick={() => setDraft((d) => ({ ...d, figure: null }))}>
                Remove
              </Button>
            </div>
          </div>
        )}
        <div className="field"><label>Correct answer</label>
          <select value={answer} onChange={(e) => setAnswer(Number(e.target.value))}>
            {draft.options.map((_, i) => <option key={i} value={i}>{String.fromCharCode(65 + i)}</option>)}
          </select>
        </div>
        <div className="field"><label>Explanation</label>
          <textarea rows={2} value={draft.explanation || ''} onChange={(e) => setDraft((d) => ({ ...d, explanation: e.target.value }))} />
        </div>
        <div className="btn-row">
          <Button variant="primary" disabled={!dirty} onClick={() => onSave({ ...draft, answer })}>Save changes</Button>
          <Button variant="secondary" onClick={onCancel}>{dirty ? 'Cancel — discard edits' : 'Close'}</Button>
        </div>
        {dirty && <p className="hint" style={{ margin: 0 }}>Unsaved edits. “Cancel — discard edits” throws them away; nothing changes until you save.</p>}
      </div>
    </div>
  )
}

function VariantsModal({ q, onPick, onClose }: { q: SheetQ & { variants: Question[] }; onPick: (qid: number, v: Question) => void; onClose: () => void }) {
  return (
    <Modal
      open
      onClose={onClose}
      title={`Variants for “${(q as SheetQ).prompt.slice(0, 60)}…”`}
      kicker="Clones in the bank"
      width={640}
      actions={
        <Button variant="secondary" onClick={onClose}>Keep original</Button>
      }
    >
      <p className="hint" style={{ marginTop: 0 }}>
        Pick one clone to replace this question in the sheet, or close to keep the original.
      </p>
      <div className="list">
        {q.variants.map((v, i) => (
          <div className="list-row" key={i}>
            <div className="min-w-0">
              <span className="list-row-title"><MathText text={v.prompt} /></span>
              <div className="list-row-sub">
                {v.options.map((o, x) => <span key={x} style={{ marginRight: 10 }}>{String.fromCharCode(65 + x)}. <MathText text={o} /></span>)}
              </div>
              <span className="tag jade">Answer {String.fromCharCode(65 + v.answer)}</span>
            </div>
            <Button variant="primary" onClick={() => onPick(q.uid, v)}>Use this</Button>
          </div>
        ))}
      </div>
    </Modal>
  )
}
