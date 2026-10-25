import { useEffect, useState } from 'react'
import { api, type MyResult } from '../api'
import { MathText, Skeleton, EmptyState, Spinner, Figure, Icon, Panel, Button, Tag, RadioOption } from '../components/ui'
import { PageHead } from '../components/patterns/Topbar'
import { ResultDocuments } from '../components/patterns/ResultDocuments'
import { useAuth } from '../auth-context'
import { useScreenContext } from '../lib/context'

function AIExplainButton({ question, answer, topic }: { question: string; answer: string; topic: string }) {
  const [explanation, setExplanation] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [language, setLanguage] = useState<'English' | 'Yoruba' | 'Igbo' | 'Hausa'>('English')

  const explain = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.aiExplain({ question, answer, topic, language })
      setExplanation(res.explanation)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load explanation')
    } finally {
      setLoading(false)
    }
  }

  if (explanation) {
    return (
      <div className="surface p-medium radius stack tiny" style={{ borderLeft: '3px solid var(--accent, #2563eb)' }}>
        <div className="cluster gap-tiny" style={{ justifyContent: 'space-between' }}>
          <div className="cluster gap-tiny">
            <Icon name="sparkle" size={14} />
            <strong style={{ fontSize: 13 }}>AI Explanation ({language}):</strong>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setExplanation(null)}>
            Close
          </Button>
        </div>
        <div className="cell-sub" style={{ fontSize: 13 }}>
          <MathText text={explanation} />
        </div>
      </div>
    )
  }

  return (
    <div className="cluster gap-tiny">
      <select
        value={language}
        onChange={e => setLanguage(e.target.value as any)}
        style={{
          fontSize: 12,
          padding: '4px 6px',
          borderRadius: 6,
          border: '1px solid var(--border, #d1d5db)',
          backgroundColor: 'var(--bg, #ffffff)',
          color: 'var(--fg, #111827)',
          outline: 'none',
          cursor: 'pointer',
        }}
      >
        <option value="English">English</option>
        <option value="Yoruba">Yorùbá</option>
        <option value="Igbo">Igbo</option>
        <option value="Hausa">Hausa</option>
      </select>
      <Button
        variant="ghost"
        size="sm"
        icon="sparkle"
        disabled={loading}
        onClick={explain}
      >
        {loading ? 'Asking AI...' : 'Explain'}
      </Button>
      {error && <span className="text-bad" style={{ fontSize: 12 }}>{error}</span>}
    </div>
  )
}

/* The answer review.

   A student opens this once, straight after submitting, and it decides whether
   they feel the mark was fair. So it leads with the verdict and the number —
   not with a list — and every question below shows the right answer beside the
   one they gave, because "what was it then?" is the only reason to be here.

   The integrity numbers (tab switches, review flags) sit in the same row as the
   score on purpose. Hiding them would be easier for the school, but a student
   who can see them is a student who trusts the score, and a student who does
   not trust the score appeals it. */

export function ResultReview({ examId, onBack }: { examId: number; onBack: () => void }) {
  const { user } = useAuth()
  const { setContext } = useScreenContext()
  const [result, setResult] = useState<MyResult | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    api
      .myResult(examId)
      .then((d) => {
        if (live) {
          setResult(d)
          setContext({
            title: 'Exam Result Review',
            description: `Reviewing results for exam: ${d.title}`,
            data: {
              examTitle: d.title,
              score: d.score,
              total: d.total,
              subject: d.subject
            },
            suggestions: [
              `Explain my mistakes in ${d.subject}`,
              'How can I improve my score next time?',
              'Create a study plan based on this result'
            ]
          })
        }
      })
      .catch((err: unknown) => {
        if (live) setError(err instanceof Error ? err.message : 'Could not load result')
      })
    return () => {
      live = false
      setContext(null)
    }
  }, [examId, setContext])

  if (error) {
    return (
      <div className="page">
        <Panel>
          <EmptyState
            icon="warn"
            title="Could not load result"
            body={error}
            action={{ label: 'Back', onClick: onBack, icon: 'arrowLeft' }}
          />
        </Panel>
      </div>
    )
  }

  if (!result) {
    return (
      <div className="page">
        <PageHead
          title="Your result"
          tagline="Fetching your marked answers."
          actions={<Button variant="secondary" icon="arrowLeft" onClick={onBack}>Back</Button>}
        />
        <div className="verdict">
          <Spinner size="lg" label="Marking your paper" />
        </div>
        <Panel title="Answer review">
          <div className="stack">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} h={72} />
            ))}
          </div>
        </Panel>
      </div>
    )
  }

  const pct = Math.round((result.score / result.total) * 100)
  const passed = pct >= 50

  /* Figures are numbered in the order they are met, so a student comparing the
     review to the paper on the desk can say "figure 3" and mean one thing. */
  const figureNumbers: Record<number, number> = {}
  let n = 0
  for (const item of result.review) if (item.figure) figureNumbers[item.idx] = ++n

  return (
    <div className="page">
      <PageHead
        title={result.title}
        kicker={result.subject || 'Assessment'}
        tagline={`Submitted ${new Date(result.submittedAt).toLocaleString()}`}
        actions={
          <Button variant="secondary" icon="arrowLeft" onClick={onBack}>
            Back to my exams
          </Button>
        }
      />

      {/* The verdict. One mark, one number, one honest line. */}
      <div className="verdict">
        <span className={`verdict-mark ${passed ? 'pass' : 'fail'}`}>
          <Icon name={passed ? 'check' : 'x'} size={28} />
        </span>
        <div>
          <h1>{passed ? 'Passed' : 'Not passed yet'}</h1>
          <p className="sub" style={{ marginTop: 6 }}>
            {result.total - result.score === 0
              ? 'A full mark. Nothing to fix.'
              : `You lost ${result.total - result.score} of ${result.total} marks. The ones worth another look are below.`}
          </p>
        </div>
        <p className="verdict-score">
          <b>{result.score}</b>
          <span>/ {result.total} &middot; {pct}%</span>
        </p>
        <div className="verdict-stats">
          <div>
            <b>{pct}%</b>
            <span>Score</span>
          </div>
          <div>
            <b>{result.marked}</b>
            <span>Review flags</span>
          </div>
          <div>
            <b>{result.tabLeaves}</b>
            <span>Tab switches</span>
          </div>
        </div>
      </div>

      <Panel title="Answer review" kicker="Every question, with the marker's answer beside yours">
        {result.review.map((item) => {
          const blank = item.manual
            ? !(typeof item.chosen === 'string' && item.chosen.trim())
            : item.chosen === null
          const right = !item.manual && item.chosen !== null && item.chosen === item.correct
          return (
            <article className="review-item" key={item.idx}>
              <div className="review-head">
                <div className="row" style={{ gap: 11, alignItems: 'flex-start', minWidth: 0 }}>
                  <span className="q-no">{item.idx + 1}</span>
                  <p className="q-stem" style={{ margin: 0 }}>
                    <MathText text={item.prompt} />
                  </p>
                </div>
                {item.manual ? (
                  <Tag tone="chalk">{blank ? 'Not answered' : 'Answered · marked by your teacher'}</Tag>
                ) : (
                  <>
                    {blank ? <Tag tone="brass">Not answered</Tag> : null}
                    {right ? <Tag tone="jade">Correct</Tag> : null}
                    {!blank && !right ? <Tag tone="vermilion">Answer {String.fromCharCode(65 + item.correct)}</Tag> : null}
                  </>
                )}
              </div>

              {item.figure ? <Figure src={item.figure} caption={`Fig. ${figureNumbers[item.idx]}`} /> : null}

              {item.manual ? (
                <div className="field">
                  <label>Your answer{item.mark ? ` · ${item.mark} mark${item.mark === 1 ? '' : 's'}` : ''}</label>
                  <MathText text={typeof item.chosen === 'string' && item.chosen.trim() ? item.chosen : '— left blank'} />
                  {item.markingGuide ? (
                    <p className="hint" style={{ marginTop: 8 }}>
                      <strong>Marking guide:</strong> <MathText text={item.markingGuide} />
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="q-options">
                  {item.options.map((opt, i) => (
                    <RadioOption
                      key={opt}
                      group={`review-${item.idx}`}
                      value={i}
                      letter={String.fromCharCode(65 + i)}
                      label={<MathText text={opt} />}
                      revealed
                      correct={i === item.correct}
                      selected={i === item.chosen}
                      locked
                    />
                  ))}
                </div>
              )}

              {item.explanation ? (
                <p className="review-note">
                  <Icon name="info" size={14} />
                  <span>
                    <MathText text={item.explanation} />
                  </span>
                </p>
              ) : null}

              <div className="mt-small">
                <AIExplainButton 
                  question={item.prompt} 
                  answer={item.manual ? (item.markingGuide || 'N/A') : item.options[item.correct]} 
                  topic={item.topic || result.subject || 'General'}
                />
              </div>
            </article>
          )
        })}
      </Panel>
      <ResultDocuments
        result={result}
        student={{ name: user?.name ?? 'Student', student_id: user?.student_id, class: user?.class }}
      />
    </div>
  )
}
