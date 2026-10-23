import { useState } from 'react'
import type { Question } from '../../api'
import { Button, Figure } from '../ui'

interface QuestionEditorProps {
  q: Question
  saving: boolean
  submitLabel: string
  /** `pinned` puts the actions in their own footer so a dive can keep them in reach. */
  footer: 'inline' | 'pinned'
  /** Resolves true once the change is safely stored, so a host can close. */
  onSave: (q: Question) => Promise<boolean> | boolean
  onCancel: () => void
}

/**
 * The question form's fields, with no chrome of their own, so a host can drop
 * them into a modal or dive them onto a surface. Owns the draft: an edit that is
 * ascended without saving is thrown away, which is the only safe default when
 * the same component is mounted twice.
 */
export function QuestionEditor({ q, saving, submitLabel, footer, onSave, onCancel }: QuestionEditorProps) {
  const [draft, setDraft] = useState<Question>(q)

  const set = (patch: Partial<Question>) => setDraft((d) => ({ ...d, ...patch }))
  const setOption = (i: number, v: string) =>
    set({ options: draft.options.map((o, x) => (x === i ? v : o)) })

  const actions = (
    <>
      <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      <Button variant="primary" type="submit" loading={saving}>{submitLabel}</Button>
    </>
  )

  return (
    <form
      className="question-editor"
      onSubmit={(e) => {
        e.preventDefault()
        void onSave({ ...draft, answer: Number(draft.answer) })
      }}
    >
      <div className="question-editor-fields">
        <div className="field">
          <label htmlFor="qe-prompt">Question stem</label>
          <textarea
            id="qe-prompt"
            required
            rows={2}
            value={draft.prompt}
            onChange={(e) => set({ prompt: e.target.value })}
            placeholder="Write your question…"
          />
        </div>

        {draft.options.map((opt, i) => (
          <div className="field" key={i}>
            <label htmlFor={`qe-opt-${i}`}>{String.fromCharCode(65 + i)}.</label>
            <input
              id={`qe-opt-${i}`}
              required
              value={opt}
              onChange={(e) => setOption(i, e.target.value)}
              placeholder={`Option ${String.fromCharCode(65 + i)}`}
            />
          </div>
        ))}

        <div className="field">
          <label htmlFor="qe-answer">Correct answer</label>
          <select id="qe-answer" value={draft.answer} onChange={(e) => set({ answer: Number(e.target.value) })}>
            {draft.options.map((_, i) => (
              <option key={i} value={i}>
                {String.fromCharCode(65 + i)}. {draft.options[i] || `Option ${String.fromCharCode(65 + i)}`}
              </option>
            ))}
          </select>
        </div>

        <div className="grid-2" style={{ gap: 10 }}>
          <div className="field">
            <label htmlFor="qe-subject">Subject</label>
            <input id="qe-subject" value={draft.subject || ''} onChange={(e) => set({ subject: e.target.value })} placeholder="e.g. Mathematics" />
          </div>
          <div className="field">
            <label htmlFor="qe-topic">Topic</label>
            <input id="qe-topic" value={draft.topic || ''} onChange={(e) => set({ topic: e.target.value })} placeholder="e.g. Fractions" />
          </div>
          <div className="field">
            <label htmlFor="qe-difficulty">Difficulty</label>
            <select id="qe-difficulty" value={draft.difficulty || 'medium'} onChange={(e) => set({ difficulty: e.target.value })}>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
          </div>
        </div>

        <div className="field">
          <label htmlFor="qe-explanation">Explanation (optional)</label>
          <textarea
            id="qe-explanation"
            rows={2}
            value={draft.explanation || ''}
            onChange={(e) => set({ explanation: e.target.value })}
            placeholder="Shown to students in the answer review"
          />
        </div>

        {draft.figure && (
          <div className="field">
            <label>Figure</label>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <Figure src={draft.figure} className="thumb" />
              <Button variant="danger" size="sm" icon="trash" onClick={() => set({ figure: null })}>
                Remove
              </Button>
            </div>
          </div>
        )}
      </div>

      {footer === 'inline'
        ? <div className="modal-actions">{actions}</div>
        : <div className="question-editor-foot">{actions}</div>}
    </form>
  )
}
