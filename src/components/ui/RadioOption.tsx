import { type InputHTMLAttributes, type ReactNode } from 'react'
import { motion } from 'framer-motion'

/* One answer in the exam.

   The screen and the print sheet are deliberately the same object — a candidate
   who has sat a paper on the desk should meet the same A-D squares on screen —
   so this renders `.q-option` from exam.css rather than a parallel component.

   State is carried on `data-state` because the correcting pen is a colour swap,
   not a second component. Note the asymmetry: a question the candidate never
   answered gets no state and a quiet note, so a paper with eight wrong answers
   does not open as eight red boxes. What they skipped is a conversation, not an
   accusation. */

interface RadioOptionProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'children'> {
  /** A, B, C, D — shown in the lettered square. */
  letter: string
  label: ReactNode
  /** Every option in a question shares this. */
  group: string
  /** The paper is marked: show what the right answer was. */
  revealed?: boolean
  correct?: boolean
  selected?: boolean
  /** Nothing to do with the answer — blocks further input after submit. */
  locked?: boolean
}

export function RadioOption({
  letter,
  label,
  group,
  revealed,
  correct,
  selected,
  locked,
  className = '',
  ...rest
}: RadioOptionProps) {
  const done = Boolean(revealed || locked)
  const state = revealed ? (correct ? 'correct' : selected ? 'wrong' : undefined) : selected ? 'selected' : undefined

  const note = revealed ? (correct ? 'Correct' : selected ? 'Your answer' : 'Not answered') : null

  return (
    <motion.label
      className={`q-option ${done ? 'q-option-locked' : ''} ${className}`.trim()}
      data-state={state}
      animate={revealed && correct ? {
        scale: [1, 1.05, 1],
        boxShadow: ['0 0 0px var(--c-success)', '0 0 15px var(--c-success)', '0 0 0px var(--c-success)'],
      } : {}}
      transition={{
        duration: 0.4,
        times: [0, 0.5, 1],
        ease: 'easeOut'
      }}
    >
      <input type="radio" name={group} disabled={done} {...rest} />
      <span className="q-option-letter">{letter}</span>
      <span className="q-option-text">{label}</span>
      {note ? <span className="q-option-note">{note}</span> : null}
    </motion.label>
  )
}
