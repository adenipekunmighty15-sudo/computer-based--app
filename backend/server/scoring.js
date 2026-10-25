// Server-authoritative exam timing + grading (pure logic, unit-testable).
// The client only renders a countdown; the server owns the deadline.

// Small grace window so a legitimate auto-submit that fires right at the
// countdown crossing zero is never rejected because of network latency.
export const SUBMIT_GRACE_MS = 30000

export function computeDeadline(startedAt, durationMinutes) {
  const mins = Math.max(1, parseInt(durationMinutes, 10) || 30)
  return startedAt + mins * 60000
}

export function isSubmissionLate(startedAt, durationMinutes, now = Date.now()) {
  return now > computeDeadline(startedAt, durationMinutes) + SUBMIT_GRACE_MS
}

export function timeLeftMs(startedAt, durationMinutes, now = Date.now()) {
  return Math.max(0, computeDeadline(startedAt, durationMinutes) - now)
}

// The paper is ONE continuous run of questions; sections only describe how the
// run is marked. This resolves the stored section list into absolute index
// ranges so every consumer (grading, the student navigator, the printed sheet)
// agrees on which numbers belong to Section A and which to Section B.
// Exams saved before sections existed fall back to a single compulsory run.
export function examSectionRanges(exam) {
  const questions = (exam && Array.isArray(exam.questions) ? exam.questions : [])
  const raw = exam && Array.isArray(exam.sections) ? exam.sections : []
  const ranges = []
  let cursor = 0
  for (const s of raw) {
    if (cursor >= questions.length) break
    const kind = s && s.kind === 'optional' ? 'optional' : 'compulsory'
    const count = Math.max(0, parseInt(s?.count, 10) || 0)
    if (count === 0) continue
    const end = Math.min(questions.length, cursor + count)
    const answerAny = kind === 'optional' ? Math.max(0, parseInt(s?.answerAny, 10) || 0) : null
    ranges.push({
      title: (s && s.title) || `Section ${String.fromCharCode(65 + ranges.length)}`,
      kind,
      answerAny,
      start: cursor,
      end,
      count: end - cursor,
      type: normaliseStoredType(s && s.type),
    })
    cursor = end
  }
  if (ranges.length === 0) {
    ranges.push({ title: 'SECTION A', kind: 'compulsory', answerAny: null, start: 0, end: questions.length, count: questions.length, type: 'multiple-choice' })
  }
  return ranges
}

// "essay", "theory" and "structured" all mean a hand-marked prose question.
const isProseType = (type) => {
  const value = String(type || '').trim().toLowerCase()
  return value === 'essay' || value === 'theory' || value === 'structured'
}
const normaliseStoredType = (type) => (isProseType(type) ? 'theory' : 'multiple-choice')

// A question is *manual* when it (or the section it sits in) is a theory/essay
// question: the candidate writes an answer that is not auto-markable. Such
// questions still appear on the paper and their answers are recorded, but they
// contribute to neither the auto score nor the auto-marked total — the teacher
// marks them separately.
export function isManualQuestion(exam, index) {
  const q = exam && Array.isArray(exam.questions) ? exam.questions[index] : null
  if (!q) return false
  if (isProseType(q.qtype)) return true
  const section = examSectionRanges(exam).find((s) => index >= s.start && index < s.end)
  return Boolean(section && section.type === 'theory')
}

// The total that is actually auto-marked: every compulsory objective question
// plus exactly the number of optional objective questions the candidate may
// choose. Theory/essay questions are excluded — they are marked by the teacher.
export function examMaxScore(exam) {
  return examSectionRanges(exam).reduce(
    (a, s) => a + (s.kind === 'optional' ? Math.min(s.answerAny ?? 0, s.count) : s.count),
    0,
  ) - manualCountInRanges(exam)
}

function manualCountInRanges(exam) {
  if (!exam || !Array.isArray(exam.questions)) return 0
  let manual = 0
  for (const range of examSectionRanges(exam)) {
    for (let i = range.start; i < range.end; i += 1) {
      if (isManualQuestion(exam, i)) manual += 1
    }
  }
  return manual
}

// Grade an exam against a student's answers map { questionIndex: optionIndex }.
// A theory/essay question may carry a free-text answer (a string) instead of an
// option index; it is recorded as answered but never auto-marked.
//
// In an optional section the candidate chooses which questions to sit; the
// server decides *which* ones count by taking the first `answerAny` questions
// the candidate actually answered, in paper order. Anything they answered
// beyond their quota is recorded but never marked, so a candidate cannot gain
// marks by answering the whole optional pool.
export function gradeExam(exam, answers = {}) {
  const questions = (exam && Array.isArray(exam.questions) ? exam.questions : [])
  const sections = examSectionRanges(exam)
  const picks = answers && typeof answers === 'object' ? answers : {}

  let score = 0
  const counted = new Array(questions.length).fill(false)

  for (const sec of sections) {
    // A wrong answer still uses up one of the candidate's choices, exactly as
    // it would on a printed paper.
    let budget = sec.kind === 'optional' ? Math.min(sec.answerAny ?? 0, sec.count) : sec.count
    for (let i = sec.start; i < sec.end; i += 1) {
      const manual = isManualQuestion(exam, i)
      const chosen = picks[i]
      if (chosen === undefined || chosen === null) continue
      if (budget <= 0) continue
      budget -= 1
      counted[i] = true
      if (manual) continue
      if (typeof chosen !== 'number') continue
      if (chosen === questions[i].answer) score += 1
    }
  }

  // The auto-marked total: the whole budget minus every theory/essay question,
  // which are marked by the teacher separately (matches examMaxScore, so the
  // pre-submission "out of" figure and the result total always agree).
  const total = examMaxScore(exam)

  return { score, total, counted }
}
