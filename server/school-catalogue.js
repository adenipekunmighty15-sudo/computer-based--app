// Mirror of src/lib/school.ts — every (subject, level) a teacher may pick.
//
// The client catalogue feeds the picker; this one is the server-side
// allow-list. Subject strings travel straight into AI prompts, so validation
// happens here, on the trust boundary, never on the client. A test
// (tests/bank-prep.test.js) asserts parity between the two so they cannot
// drift apart silently.

export const SCHOOL_LEVELS = ['Primary', 'JSS', 'SSS']

export const SUBJECT_CATALOGUE = {
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