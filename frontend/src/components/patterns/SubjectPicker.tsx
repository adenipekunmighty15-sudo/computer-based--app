import { useMemo, useState } from 'react'
import { Icon } from '../ui/Icon'
import {
  SUBJECT_CATALOGUE,
  SCHOOL_LEVELS,
  LEVEL_LABEL,
  type SchoolLevel,
  type TeacherSubject,
  subjectKey,
} from '../../lib/school'

/* Choose the subjects you teach, one chip per (subject, level).

   The catalogue is the school's, grouped by phase — Primary, JSS, SSS — because
   Mathematics at Primary and Mathematics at SSS are two different banks. Letting
   a teacher tap both is the whole point, so the model is a multi-select set of
   <TeacherSubject>, not a single dropdown. */

export function SubjectPicker({
  value,
  onChange,
  max = 12,
}: {
  value: TeacherSubject[]
  onChange: (next: TeacherSubject[]) => void
  max?: number
}) {
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()

  const toggle = (level: SchoolLevel) => (subject: string) => {
    const key = subjectKey({ level, subject })
    if (value.some((s) => subjectKey(s) === key)) {
      onChange(value.filter((s) => subjectKey(s) !== key))
    } else if (value.length < max) {
      onChange([...value, { level, subject }])
    }
  }

  const visible = useMemo(() => {
    return SCHOOL_LEVELS.map((level) => ({
      level,
      items: SUBJECT_CATALOGUE[level].filter((s) => !query || s.toLowerCase().includes(query)),
    }))
  }, [query])

  return (
    <div className="subject-picker">
      <label className="subject-search">
        <Icon name="search" size={14} />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search subjects"
          aria-label="Search subjects"
        />
      </label>

      <div className="subject-grid">
        {visible.map(({ level, items }) => (
          <div className="subject-col" key={level}>
            <p className="subject-col-label">{LEVEL_LABEL[level]}</p>
            <div className="subject-buttons" role="group" aria-label={LEVEL_LABEL[level]}>
              {items.map((subject) => {
                const on = value.some((s) => subjectKey({ level, subject }) === subjectKey(s))
                return (
                  <button
                    key={subject}
                    type="button"
                    className={on ? 'subject-chip is-on' : 'subject-chip'}
                    aria-pressed={on}
                    onClick={() => toggle(level)(subject)}
                  >
                    <span className="subject-chip-check" aria-hidden="true">
                      <Icon name="check" size={11} />
                    </span>
                    <span>{subject}</span>
                  </button>
                )
              })}
              {items.length === 0 ? <p className="hint">No matches</p> : null}
            </div>
          </div>
        ))}
      </div>

      <div className="subject-selected">
        <p className="hint">
          {value.length === 0
            ? 'Pick each subject you teach. We will prepare a starter question bank for it.'
            : `${value.length} of ${max} selected — each bank takes a minute or two to prepare`}
        </p>
        {value.length > 0 ? (
          <div className="subject-tags">
            {value.map((s) => (
              <button
                key={subjectKey(s)}
                type="button"
                className="subject-tag"
                aria-label={`Remove ${s.subject} (${s.level})`}
                onClick={() => toggle(s.level)(s.subject)}
              >
                <span className="subject-tag-level">{s.level}</span>
                <span>{s.subject}</span>
                <Icon name="x" size={10} />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}