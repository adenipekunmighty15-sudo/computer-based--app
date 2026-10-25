// Types for the server-side subject catalogue. Mirrors src/lib/school.ts so a
// client test can import the server allow-list through TypeScript.
export const SCHOOL_LEVELS: readonly string[]
export const SUBJECT_CATALOGUE: Record<string, readonly string[]>