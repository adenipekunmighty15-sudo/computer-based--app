# CBT App — Plan

**Active work:** Teacher subject onboarding + AI question-bank pre-generation.
**Decided:** post-login onboarding gate · silent background queue with status badges · this feature ships before the security/exam work (which is preserved in Appendix A, unstarted).

App: React 19 + TS + Vite · Express + `node:sqlite` (WAL) · hand-rolled router · UI kit in `src/components/ui`, cross-screen patterns in `src/components/patterns`.

---

# PART 1 — Teacher subject onboarding

## Design decisions (stated so they can be overruled at approval)

| Question | Decision | Why |
|---|---|---|
| Where stored | **New `teacher_subjects` table** (relational), not a JSON column on `users` | The subject list repeats across phases (Mathematics exists in Primary, JSS and SSS), so the unit of selection is *subject + level*, not a bare string. The table also carries per-subject AI status naturally. |
| Level scoping | Every selection is a `(subject, level)` pair | "Mathematics (Primary)" and "Mathematics (SSS)" are different banks; without level they would collapse into one ambiguous entry. |
| Question tagging | Existing convention: `questions.subject` (text) + `questions.teacher_id`, **plus a new `questions.class_level`** | The schema has no `subject_id` and introducing one would fork the data model from `exams.subject`, `Bank` and `QuestionEditor`, which all use free-text subject today. `class_level` is what is genuinely missing and is needed to tell the three banks apart. |
| AI prompt | **Reuse the existing pipeline unchanged** (`runGenerateRound` + `MCQ_SYSTEM`) | `MCQ_SYSTEM` (`server/config/ai.js:1452`) already mandates exactly 4 options A–D, one correct answer, a short `explanation` and a `topic` per item — it is literally the prompt you specified. Passing `topic: undefined` makes the pipeline draw "a mix of foundational topics" from the whole subject (`index.js:694-703`). |
| Queue | New in-process FIFO (`server/bank-prep.js`, concurrency 1) — **not** `jobs.js` | `jobs.js` caps at 4 jobs/user and evicts the oldest (`jobs.js:15,22-29`); a teacher selecting 8 subjects would evict 5. `jobs.js` also only stores results in memory — this feature must persist to the bank. |
| Trigger point | `PUT /api/my/subjects` returns immediately; generation runs behind it | Non-blocking, as specified. |
| Durability | Queue is in-process; **self-healing** on the next `GET /api/my/subjects` | A restart mid-generation re-queues any selected subject still short of target. Cheaper than persisting a queue for a school-scale app. |
| Existing accounts | Covered automatically | The gate fires for any teacher whose subject set is empty — including the 10 pre-existing teacher rows. |

---

## Step 1 — Frontend: catalogue + multi-select picker

### 1.1 `src/lib/school.ts` — canonical catalogue

`SUBJECTS` at `school.ts:14` is exported but imported nowhere, so the catalogue becomes the single source of truth. Add:

```ts
export type SchoolLevel = 'Primary' | 'JSS' | 'SSS'

export const SUBJECT_CATALOGUE: Record<SchoolLevel, readonly string[]> = {
  Primary: [
    'Mathematics', 'English Language', 'Basic Science & Technology',
    'National Values Education', 'Pre-Vocational Studies',
    'Christian/Islamic Religious Studies', 'Yoruba/Hausa/Igbo',
  ],
  JSS: [
    'Mathematics', 'English', 'Basic Science', 'Basic Technology', 'Business Studies',
    'National Values Education', 'Cultural & Creative Arts', 'French', 'Nigerian Languages',
  ],
  SSS: [
    'Mathematics', 'English Language', 'Civic Education', 'Trade & Entrepreneurship',
    'Data Processing', 'Catering Services',
    'Physics', 'Chemistry', 'Biology', 'Further Mathematics', 'Agricultural Science',
    'Economics', 'Government', 'Literature in English', 'Financial Accounting', 'Commerce',
  ],
}

export const LEVEL_LABEL: Record<SchoolLevel, string> = {
  Primary: 'Primary school',
  JSS: 'Junior Secondary (JSS)',
  SSS: 'Senior Secondary (SSS)',
}

export interface TeacherSubject { subject: string; level: SchoolLevel }
export const subjectKey = (s: TeacherSubject) => `${s.level}::${s.subject}`
```

*Two deviations from your list, flagged for approval:* `Trade/Entrepreneurship (e.g., Data Processing, Catering)` is emitted as **three** selectable entries (`Trade & Entrepreneurship`, `Data Processing`, `Catering Services`) because a school teaches those as distinct subjects and the AI bank must be tagged accordingly. `Christian/Islamic Religious Studies` and `Yoruba/Hausa/Igbo` are kept as single entries exactly as you wrote them — say the word and I will split them into CRS/IRS and Yoruba/Hausa/Igbo.

### 1.2 New `src/components/patterns/SubjectPicker.tsx`

Exported from `patterns/index.ts` (two screens need it: onboarding + settings, which is the kit rule for that folder).

```tsx
interface SubjectPickerProps {
  value: TeacherSubject[]
  onChange: (next: TeacherSubject[]) => void
  error?: string | null
  disabled?: boolean
}
```

Behaviour:
- **Search** `<input type="search">` filters case-insensitively across all three phases; empty query shows everything; a "No subject matches" state when nothing matches.
- **Three grouped columns/sections** — one per level, heading = `LEVEL_LABEL[level]` — each option a `<button type="button" aria-pressed={selected}>`. Native buttons keep keyboard operation, focus order and screen-reader announcement free.
- **Selected tags** render above the groups with a remove control each: `<button aria-label="Remove Mathematics, Junior Secondary">`.
- Live counter in the `Field` label row: `3 selected` (uses the existing `meter` slot of `FieldFrame`, `ui/Field.tsx:29-46`).
- Reuses the kit only: `Field` (label/hint/error), `Tag`/`Badge`, `Icon`, `SearchBox` styling from `data.css`.
- Disabled state while saving; `error` shown through `Field`'s `role="alert"` slot.

### 1.3 New `src/pages/teacher/SubjectOnboarding.tsx`

Full-screen gate (renders **instead of** `Shell`, not inside it):

1. Heading "What do you teach?" + "Pick every subject you teach. Your question bank starts building the moment you save — you don't have to wait for it."
2. `<SubjectPicker>` + primary button **"Save & prepare my question bank"** (disabled at zero selections) → `api.saveMySubjects(selection)`.
3. On success the same screen flips to a **status list**: one row per selected subject — `Mathematics · JSS` with a status pill (`Queued` → `Generating` → `20 ready` / `Partial (7/20) · Retry`). Polled every 10 s while anything is `generating` (`aria-live="polite"` so assistive tech announces completion).
4. **"Go to dashboard"** is enabled the moment the save returns — never blocks on generation. A `Saving…` spinner covers only the PUT.

### 1.4 Wire the gate — `src/pages/TeacherApp.tsx`

Add one piece of state (state stays **unconditional**, above any early return, so hook order never changes):

```tsx
const [subjects, setSubjects] = useState<TeacherSubjectStatus[] | null>(null)   // null = loading
useEffect(() => { void api.mySubjects().then((r) => setSubjects(r.subjects)).catch(() => setSubjects([])) }, [])

if (subjects !== null && subjects.length === 0) {
  return <SubjectOnboarding onSaved={(s) => setSubjects(s)} />
}
```

This sits after the existing hooks and before the render at `TeacherApp.tsx:103-123`, and short-circuits before the dashboard's `Promise.all([listQuestions, listExams, listStudents])` (`TeacherApp.tsx:152-158`) — a brand-new teacher skips three heavy requests.

Dashboard card: extend the existing `attention[]` builder (`TeacherApp.tsx:236-263`) with — if any subject is not `ready` — `{ tone:'info', title:'Preparing your question bank (n subjects)', go:'/profile', cta:'View progress' }`, rendered by the existing card loop at `:312-329`. No new route, no router change.

### 1.5 Profile editor — `src/components/patterns/AccountSettings.tsx`

New "Subjects I teach" section for teachers only (mirroring the existing `isStudent` gate pattern at `:99-102`): `SubjectPicker` + status pills + its **own** Save button and dirty check (the existing `profileDirty` at `:149-151` drives the profile form only — subjects must not share it, or a name edit would silently rewrite the subject set).

### 1.6 `src/api.ts`

```ts
export type SchoolLevel = 'Primary' | 'JSS' | 'SSS'
export interface TeacherSubject { subject: string; level: SchoolLevel }
export interface SubjectStatus extends TeacherSubject {
  count: number
  status: 'pending' | 'generating' | 'partial' | 'ready'
}
export interface Question { /* …existing… */ class_level?: string | null }

mySubjects: () => req<{ subjects: SubjectStatus[]; target: number }>('GET', '/api/my/subjects'),
saveMySubjects: (subjects: TeacherSubject[]) =>
  req<{ subjects: SubjectStatus[]; target: number }>('PUT', '/api/my/subjects', { subjects }),
```

Shared polling hook `useSubjectStatus()` in `src/lib/hooks.ts` (fetch once, then re-fetch every 10 s **only while** some status is `generating`; stops on tab-hide via the existing `useTabVisible`). Used by `SubjectOnboarding` and the dashboard card so there is one polling implementation, not two.

---

## Step 2 — Database

### 2.1 New table + migration (`server/db.js`, inside the existing `CREATE TABLE` block at `:15-106`)

```sql
CREATE TABLE IF NOT EXISTS teacher_subjects (
  user_id INTEGER NOT NULL,
  subject TEXT NOT NULL,
  level   TEXT NOT NULL CHECK (level IN ('Primary','JSS','SSS')),
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, subject, level)
);
```

### 2.2 Column the bank needs + its index (alongside `ensureColumn` calls at `:115-121`)

```js
ensureColumn('questions', 'class_level', 'TEXT')     // NULL on every pre-existing row: safe
db.exec('CREATE INDEX IF NOT EXISTS idx_questions_teacher_bank
             ON questions (teacher_id, subject, class_level)')
```
This is also the first real index in the schema (the audit found zero) and it is exactly what the status query needs.

### 2.3 `db.js` functions

```js
export function getTeacherSubjects(userId)                       // rows ordered by level, subject
export function replaceTeacherSubjects(userId, list) {           // BEGIN → DELETE → N×INSERT → COMMIT
  db.exec('BEGIN'); try { … db.exec('COMMIT') } catch (e) { db.exec('ROLLBACK'); throw e }
}
export function bankCounts(userId) {
  // one grouped scan; the new index serves it
  return db.prepare(`SELECT subject, class_level AS level, COUNT(*) AS n
                     FROM questions WHERE teacher_id = ?
                     GROUP BY subject, class_level`).all(userId)
}
```

`insertQuestionsBulk` (`db.js:319-349`) gains `q.class_level || null` in the INSERT column list — its two existing callers (AILab "save all", bulk route) send no such field, so they keep writing `NULL`. `questionFromRow` (`:146-159`) gains `class_level: r.class_level ?? null` so the bank can display it. Nothing leaks into exams: `insertExam` builds its snapshot from explicit fields (`db.js:360`) and the student route whitelists its own fields (`index.js:1658`).

**Not touched:** `sanitizeUser` (`:186-189`) — subjects are fetched by their own endpoint rather than on every authenticated request.

---

## Step 3 — API endpoints (append to `teacherRouter`, just above the student block at `server/index.js:~1637`)

Both are guarded `mustBeTeacher` (the role check is read from the DB row, not the request — `auth.js:49-58`).

### 3.1 `PUT /api/my/subjects`

```js
teacherRouter.put('/my/subjects', mustBeTeacher, rateLimit({ max: 20, key: (req) => `subjects:${req.user.id}` }),
  wrap(async (req, res) => {
    const raw = req.body?.subjects
    if (!Array.isArray(raw)) return res.status(400).json({ error: 'Subjects must be a list' })
    if (raw.length > 40) return res.status(400).json({ error: 'Select at most 40 subjects' })

    const seen = new Set(); const clean = []
    for (const s of raw) {
      const level = String(s?.level || ''); const subject = String(s?.subject || '').trim()
      if (!LEVELS.includes(level)) return res.status(400).json({ error: `Unknown level: ${level}` })
      if (!SUBJECT_CATALOGUE[level].includes(subject))      // server-side allow-list, never client trust
        return res.status(400).json({ error: `Unknown subject: ${subject || '(blank)'}` })
      const key = `${level}::${subject}`
      if (seen.has(key)) continue
      seen.add(key); clean.push({ subject, level })
    }

    replaceTeacherSubjects(req.user.id, clean)               // one transaction, all-or-nothing
    enqueueBankPrep(clean.filter((s) => countFor(s) < BANK_TARGET)
      .map((s) => ({ userId: req.user.id, ...s, generate: bankGenerator(req.user.id) })))

    res.json(subjectView(req.user.id))                       // returns instantly — no await on generation
  }))
```

Validation is a **server-side allow-list** against the catalogue: a teacher cannot smuggle arbitrary `subject` strings (which are later interpolated into AI prompts) through this endpoint.

### 3.2 `GET /api/my/subjects` (status + self-heal)

```js
teacherRouter.get('/my/subjects', mustBeTeacher, wrap(async (req, res) => {
  res.json(subjectView(req.user.id))
}))
```

`subjectView(userId)` builds each entry as:

| condition | `status` |
|---|---|
| key active or queued in `bank-prep` | `generating` |
| `count >= 20` | `ready` |
| `0 < count < 20` | `partial` |
| `count === 0` | `pending` |

and, as a side effect, re-enqueues any selected subject that is `partial`/`pending`, not in the queue, and **not already attempted in this process** — the self-heal that recovers from a mid-run restart without ever hot-looping on a subject the AI keeps failing (the `attempted` guard lives for the process lifetime; an explicit `PUT` clears it and retries).

### 3.3 AI budget guard

Refactor the existing `assertAiBudget` (`index.js:456-464`) so the background path can ask the same question without a `res`:

```js
function budgetOk(userId, extra) { return !dailyAILimit || aiBudgetFor(userId).used + extra <= dailyAILimit }
function assertAiBudget(res, userId, extra) {          // unchanged behaviour, same callers
  if (budgetOk(userId, extra)) return true
  res.status(429).json({ error: `Daily AI question budget reached (${dailyAILimit}). …` })
  return false
}
```

---

## Step 4 — Asynchronous AI generation

### 4.1 New `server/bank-prep.js` — the queue (no imports from `index.js`, so no cycle)

```js
export const BANK_TARGET = 20
export const PREP_CONCURRENCY = 1          // one AI generation at a time, school-wide

const pending = []                          // { userId, subject, level, generate }
const active  = new Set()                   // `${userId}|${level}|${subject}`
const attempted = new Set()                 // guards self-heal from hot-looping
let running = 0

const keyOf = (t) => `${t.userId}|${t.level}|${t.subject}`

export function enqueueBankPrep(tasks) { …dedupe against pending+active…; void pump(); }
export function prepStateFor(userId) { return { active: [...], pending: [...] } }
export function markAttempted(key) / hasAttempted(key) / clearAttempted(key)

async function pump() {
  while (running < PREP_CONCURRENCY && pending.length) {
    const task = pending.shift(); const key = keyOf(task)
    if (active.has(key)) continue
    active.add(key); running += 1
    void (async () => {
      try { await task.generate(task) }
      catch (err) { console.error('[bank-prep]', task.level, task.subject, err?.message || err) }
      finally { active.delete(key); running -= 1; void pump() }
    })()
  }
}
```

`generate` is **injected** from `index.js`. That keeps the queue pure, dependency-free and unit-testable while the AI helpers stay private to the file that owns them.

### 4.2 `bankGenerator(userId)` — defined in `server/index.js` next to `runGenerateRound`

```js
function bankGenerator(userId) {
  return async ({ subject, level }) => {
    if (!budgetOk(userId, BANK_TARGET)) return              // leave status `pending`; surfaced in UI
    const spec = { subject, classLevel: level, count: BANK_TARGET, type: 'multiple-choice' }
    const out  = await runGenerateRound(spec, BANK_TARGET)  // existing pipeline: AI → web → local fallback
    const fresh = out.questions.slice(0, BANK_TARGET)
      .filter((q) => !findDuplicateQuestion(q.prompt, userId))     // idempotent across re-runs
      .map((q) => ({ ...q, subject, class_level: level }))         // always tag with the picked subject+level
    if (fresh.length) insertQuestionsBulk(fresh, userId)           // one transaction, db.js:319-349
    logAiUsage({ userId, action: 'bank-prep', model: out.model, provider: null,
                 count: fresh.length, latencyMs: out.totalMs, ok: fresh.length > 0 })
    if (fresh.length) console.log(`[bank-prep] user=${userId} ${level}/${subject}: ${fresh.length}/${BANK_TARGET}`)
  }
}
```

Your prompt, expressed through the existing request builder (`index.js:694-703`) — this is what the model receives:

```
system:  MCQ_SYSTEM  (exactly 4 options A–D, one correct answer, short explanation, topic, difficulty)
user:    Subject: Physics
         Class for SSS
         Main topic: General
         Difficulty: mixed
         Question type: Multiple-choice questions with 4 options (A-D).
         Generate exactly 20 DIFFERENT questions on "Physics". …
```

No figures in pre-generation (`attachFigures` needs a live `req` and a per-request budget) — diagrams remain an AILab action.

### 4.3 Sequence

```
Teacher saves subjects
  └─ PUT /api/my/subjects  →  validate → 1 transaction → respond 200 (≈ ms)
                                └─ enqueueBankPrep(subjects below target)   ← fire and forget
                                     └─ pump(): one at a time
                                          runGenerateRound({subject, 20, MCQ, no topic})
                                          exact-prompt dedupe → insertQuestionsBulk(subject + class_level + teacher_id)
                                          logAiUsage('bank-prep')
  Teacher is already on the dashboard.
  Client polls GET /api/my/subjects every 10 s while anything is `generating`.
  Restart mid-run → next GET re-queues anything still short.
```

Rate/shape notes: register is unchanged (subjects arrive *after* login). `PUT` is limited to 20/min per teacher. 20 questions ≈ one AI round (`SYNC_ROUND_SIZE = 25`), so a teacher with 8 subjects is ready in roughly 8 sequential calls — minutes, not hours.

---

## Tests & verification

1. **`server/bank-prep.test.mjs`** (pure, no DB): concurrency never exceeds `PREP_CONCURRENCY`; a duplicate key is not enqueued twice; a failing `generate` still releases the slot and the queue keeps draining; `prepStateFor` reports active/pending correctly.
2. **`server/subjects.test.mjs`** (temp `CBT_DB` set **before** importing `db.js`, matching how `db.js:12` resolves the path): `replaceTeacherSubjects` is all-or-nothing on a bad row; `bankCounts` groups by subject+level; `class_level` round-trips through `insertQuestionsBulk`.
3. **`src/components/patterns/SubjectPicker.test.tsx`** (jsdom, existing Testing Library setup): search filters across levels; clicking toggles `aria-pressed` and the tag row; removing a tag updates `value`; unknown subject cannot appear (options come from the catalogue).
4. `npm test` · `npm run lint` · `npm run build` all pass.
5. Manual: register a teacher → onboarding gate appears → search "phys", select SSS Physics + JSS Basic Science → Save → dashboard immediately with "Preparing your question bank" card → status pills reach `20 ready` → questions visible in **Question bank** tagged `Physics · SSS` → reload: no onboarding gate, statuses still `ready`.

## Out of scope (recorded, not built)

- Subject filter dropdown in `Bank` (only a `class_level` tag is added) — natural follow-up now that `class_level` exists.
- Splitting `Christian/Islamic Religious Studies` and `Yoruba/Hausa/Igbo` into separate entries.
- Figures/diagrams during pre-generation; per-subject question-count configurability.
- Setting `AI_DAILY_QUESTION_LIMIT` — **currently unset, so pre-generation is uncapped**. Recommend setting it in `server/.env` before first real use: 20 × 16 subjects ≈ 320 questions per teacher.
- `server/index.js` stays a 1,759-line monolith (the queue itself is isolated in its own module).

---

# APPENDIX A — Deferred: security + exam integrity (not started)

Retained from the earlier audit pass; **unimplemented**. Verified findings: ~18 live API keys committed in `supabase/migrations/api keys for ai lab` · teacher self-registration gate inert because `TEACHER_SIGNUP_CODE` is unset (`index.js:192-195`) · exam deadline/attempts/drafts imported but never called (`index.js:71-80`, `scoring.js:6-19`, `db.js:395-416`) · `POST /api/auth/password` has no auth middleware → always 500 (`index.js:233`) · foreign `.env` loaded at `index.js:97` whitelisting another project's origins · `canEditQuestion`/`canEditExam` imported and never called · no global error handler, `wrap` echoes `err.message` · no error boundary in `src/` · zero `CREATE INDEX`/`REFERENCES`, `busy_timeout = 0` · rate limits keyed by IP (whole-class bucket) · 839 KB single JS chunk, duplicate Google Fonts in `index.html:7-12`.

**Phase 0 (security):** untrack + rotate keys, fail-closed teacher signup, `anyAuth` on the password route, drop the foreign `.env`, ownership checks on destructive teacher routes, global error handler, user-keyed rate limits.
**Phase 1 (exam integrity):** `startAttempt` on exam fetch returning `deadlineAt` + draft · `submissionState()` grace rule (on-time / ≤30 s grace flagged late / expired → grade the last autosave or 410) · new `PUT /api/my/exams/:id/draft` · transactional idempotent submit · client countdown from server deadline, `beforeunload`, `keepalive` flush, submit retries, `busyRef` guard, non-dead-end error panel · app-wide error boundary.

Full detail (exact code per task) was written in the previous revision of this file and can be regenerated on request.
