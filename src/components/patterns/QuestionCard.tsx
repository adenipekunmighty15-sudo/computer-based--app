import { useState } from 'react'
import { Tag, DifficultyTag, MathText, RadioOption, Icon, Figure } from '../ui'

export interface Question {
  question: string
  options?: string[]
  correct?: string
  explanation?: string
  topic?: string
  difficulty?: string
  mark?: number
  markingGuide?: string
  image?: string | null
}

interface QuestionCardProps {
  question: Question
  number: number
}

/* A question as the teacher reads it in the bank or the AI Lab.

   Deliberately not the candidate's view. There is no timer, no progress and no
   way to commit an answer here — the one job is "is this question right?", so
   the answer stays behind a deliberate reveal. A teacher who can see the answer
   by accident will eventually publish a paper with the answer in the stem. */

export function QuestionCard({ question: q, number }: QuestionCardProps) {
  const [revealed, setRevealed] = useState(false)
  const isMCQ = Boolean(q.options && q.options.length > 0)
  const correctLetter = q.correct?.trim().charAt(0).toUpperCase() ?? ''

  /* The bank stores an option either as "B. photosynthesis" or as bare text, so
     the letter is optional and has to be stripped before it is shown twice. */
  const optionMatch = (option: string, correct: string): boolean =>
    option.trim().charAt(0).toUpperCase() === correct.trim().charAt(0).toUpperCase()

  return (
    <article className="review-item">
      <div className="review-head">
        <div className="row" style={{ gap: 11, alignItems: 'flex-start', minWidth: 0 }}>
          <span className="q-no">{number}</span>
          <div className="min-w-0">
            <p className="q-stem">
              <MathText text={q.question} />
            </p>
            <div className="row wrap" style={{ gap: 5, marginTop: 8 }}>
              {q.mark ? <Tag>{q.mark} mark{q.mark === 1 ? '' : 's'}</Tag> : null}
              {q.topic ? <Tag outline>{q.topic}</Tag> : null}
              <DifficultyTag value={q.difficulty} />
            </div>
          </div>
        </div>
      </div>

      <Figure src={q.image} thumb />

      {isMCQ ? (
        <div className="q-options" role="radiogroup" aria-label={`Options for question ${number}`}>
          {q.options!.map((option, i) => (
            <RadioOption
              key={option}
              group={`q-${number}`}
              value={i}
              letter={String.fromCharCode(65 + i)}
              label={<MathText text={option.replace(/^[A-Da-d][.)]\s*/, '')} />}
              revealed={revealed}
              correct={q.correct !== undefined && optionMatch(option, q.correct)}
              locked={!revealed}
            />
          ))}
        </div>
      ) : null}

      {q.markingGuide ? (
        <p className="review-note">
          <Icon name="book" size={14} />
          <span>
            <b>Marking guide.</b> {q.markingGuide}
          </span>
        </p>
      ) : null}

      <div className="row-between wrap" style={{ marginTop: 13 }}>
        <button
          type="button"
          className="btn secondary sm"
          onClick={() => setRevealed((r) => !r)}
          aria-expanded={revealed}
        >
          <Icon name={revealed ? 'eye' : 'target'} size={13} />
          {revealed ? 'Hide answer' : 'Reveal answer'}
        </button>

        {revealed ? (
          <div className="row wrap" style={{ gap: 5 }}>
            <Tag tone={isMCQ ? 'jade' : 'chalk'}>
              Answer: {isMCQ ? correctLetter : q.correct}
            </Tag>
            {q.topic ? <Tag outline>{q.topic}</Tag> : null}
            <DifficultyTag value={q.difficulty} />
          </div>
        ) : null}
      </div>

      {revealed && q.explanation ? (
        <p className="review-note">
          <Icon name="info" size={14} />
          <span>{q.explanation}</span>
        </p>
      ) : null}
    </article>
  )
}
