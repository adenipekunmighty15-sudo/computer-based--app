/* The school. These are the words that appear on a real paper, so they live in
   one place and everything else reads from them — a masthead, a filter menu
   and a printed sheet can never disagree about what the school is called. */

export const SCHOOL = {
  name: 'T. Gold Brighter Tomorrow',
  kind: 'Model School',
  place: 'Model School',
  seal: 'T',
  session: '2025 / 26',
  papersPrefix: 'TGBT',
} as const

export const SUBJECTS = [
  'Mathematics',
  'Physics',
  'Chemistry',
  'Biology',
  'English',
  'Computer Studies',
  'Government',
  'Economics',
  'Geography',
  'Civic Education',
] as const

/* What a teacher teaches, and what the bank is prepared for.

   The three phases are stored separately because a school teaches Mathematics
   at all of them and the questions are not interchangeable: a Primary fraction
   is not an SSS trigonometry question. Every selection is therefore a
   (subject, level) pair, and the level travels with the generated questions so
   the bank can be told apart later. */
export type SchoolLevel = 'Primary' | 'JSS' | 'SSS'

export const SCHOOL_LEVELS: readonly SchoolLevel[] = ['Primary', 'JSS', 'SSS']

export const LEVEL_LABEL: Record<SchoolLevel, string> = {
  Primary: 'Primary school',
  JSS: 'Junior Secondary (JSS)',
  SSS: 'Senior Secondary (SSS)',
}

export const SUBJECT_CATALOGUE: Record<SchoolLevel, readonly string[]> = {
  Primary: [
    'Mathematics',
    'English Language',
    'Basic Science & Technology',
    'National Values Education',
    'Pre-Vocational Studies',
    'Christian/Islamic Religious Studies',
    'Yoruba/Hausa/Igbo',
  ],
  JSS: [
    'Mathematics',
    'English',
    'Basic Science',
    'Basic Technology',
    'Business Studies',
    'National Values Education',
    'Cultural & Creative Arts',
    'French',
    'Nigerian Languages',
  ],
  SSS: [
    'Mathematics',
    'English Language',
    'Civic Education',
    'Trade & Entrepreneurship',
    'Data Processing',
    'Catering Services',
    'Physics',
    'Chemistry',
    'Biology',
    'Further Mathematics',
    'Agricultural Science',
    'Economics',
    'Government',
    'Literature in English',
    'Financial Accounting',
    'Commerce',
  ],
}

export interface TeacherSubject {
  subject: string
  level: SchoolLevel
}

export const subjectKey = (s: TeacherSubject): string => `${s.level}::${s.subject}`

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const
export type Difficulty = (typeof DIFFICULTIES)[number]

export const CLASS_LEVELS = [
  'JSS 1',
  'JSS 2',
  'JSS 3',
  'SSS 1',
  'SSS 2',
  'SSS 3',
] as const

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'] as const

export function letter(i: number): string {
  return LETTERS[i] ?? String.fromCharCode(65 + i)
}

export const TONES = {
  chalk: 'var(--chalk)',
  jade: 'var(--jade)',
  vermilion: 'var(--vermilion)',
  brass: 'var(--brass)',
  gold: 'var(--gold)',
  rule: 'var(--rule-hi)',
} as const

/* A mark band, used wherever a percentage is shown with a verdict attached.
   The bands are the ones Nigerian secondary schools actually use. */
export function band(p: number): { label: string; tone: 'jade' | 'chalk' | 'brass' | 'vermilion' } {
  if (p >= 75) return { label: 'A1 · Excellent', tone: 'jade' }
  if (p >= 70) return { label: 'B2 · Very good', tone: 'jade' }
  if (p >= 65) return { label: 'B3 · Good', tone: 'chalk' }
  if (p >= 60) return { label: 'C4 · Credit', tone: 'chalk' }
  if (p >= 55) return { label: 'C5 · Credit', tone: 'chalk' }
  if (p >= 50) return { label: 'C6 · Credit', tone: 'brass' }
  if (p >= 45) return { label: 'D7 · Pass', tone: 'brass' }
  if (p >= 40) return { label: 'E8 · Pass', tone: 'brass' }
  return { label: 'F9 · Fail', tone: 'vermilion' }
}

export function stamp(): string {
  const d = new Date()
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function paperRef(subject?: string | null, classLevel?: string | null): string {
  const s = (subject ?? 'Exam').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()
  const c = (classLevel ?? '').replace(/[^A-Za-z0-9]/g, '')
  return [SCHOOL.papersPrefix, s, c].filter(Boolean).join('-')
}
