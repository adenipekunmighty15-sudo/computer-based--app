import { useState } from 'react'
import type { MyResult, ReviewItem } from '../../api'
import { Button, MathText } from '../ui'

type StudentIdentity = { name: string; student_id?: string | null; class?: string | null }
type DocumentKind = 'answers' | 'certificate'

export function ResultDocuments({ result, student }: { result: MyResult; student: StudentIdentity }) {
  const [kind, setKind] = useState<DocumentKind>('answers')
  const percent = result.total > 0 ? Math.round((result.score / result.total) * 100) : 0
  const passed = percent >= 50

  const print = () => {
    const target = `result-${kind}`
    const clearTarget = () => {
      delete window.document.body.dataset.printTarget
      window.removeEventListener('afterprint', clearTarget)
    }
    window.document.body.dataset.printTarget = target
    window.addEventListener('afterprint', clearTarget, { once: true })
    window.print()
  }

  return (
    <section className="result-documents">
      <div className="result-doc-controls no-print">
        <div className="result-doc-tabs" role="group" aria-label="Printable result document">
          <button type="button" className="btn secondary" aria-pressed={kind === 'answers'} onClick={() => setKind('answers')}>A4 answer sheet</button>
          <button type="button" className="btn secondary" aria-pressed={kind === 'certificate'} onClick={() => setKind('certificate')}>Result certificate</button>
        </div>
        <Button variant="primary" icon="printer" onClick={print}>Print {kind === 'answers' ? 'answer sheet' : 'certificate'}</Button>
      </div>

      <div className="result-doc-preview">
        {kind === 'answers' ? (
          <article className="result-print-sheet result-print-answer">
            <header className="result-paper-head">
              <p className="result-school">T. Gold Brighter Tomorrow Model School</p>
              <h2>Student Answer Review</h2>
              <p className="result-paper-title">{result.title}</p>
              <div className="result-paper-meta">
                <span><b>Student:</b> {student.name}</span>
                <span><b>Student ID:</b> {student.student_id || '—'}</span>
                <span><b>Class:</b> {student.class || '—'}</span>
                <span><b>Subject:</b> {result.subject || '—'}</span>
                <span><b>Submitted:</b> {new Date(result.submittedAt).toLocaleDateString()}</span>
                <span><b>Result:</b> {result.score}/{result.total} ({percent}%)</span>
              </div>
            </header>
            {result.review.map((item: ReviewItem) => (
              <section className="result-paper-question" key={item.idx}>
                <div className="result-paper-question-head">
                  <strong>{item.idx + 1}. <MathText text={item.prompt} /></strong>
                  {item.manual ? (
                    <span className={`result-mark ${typeof item.chosen === 'string' && item.chosen.trim() ? 'correct' : 'incorrect'}`}>
                      {typeof item.chosen === 'string' && item.chosen.trim() ? 'Answered · marked by teacher' : 'Not answered'}
                      {item.counted === false ? ' · Not counted' : ''}
                    </span>
                  ) : (
                    <span className={item.chosen === item.correct ? 'result-mark correct' : 'result-mark incorrect'}>
                      {item.chosen === null ? 'Not answered' : item.chosen === item.correct ? 'Correct' : 'Incorrect'}
                      {item.counted === false ? ' · Not counted' : ''}
                    </span>
                  )}
                </div>
                {item.figure ? <img className="result-paper-figure" src={item.figure} alt={`Question ${item.idx + 1} figure`} /> : null}
                {item.manual ? (
                  <p className="result-paper-response">
                    Student response: {typeof item.chosen === 'string' && item.chosen.trim() ? item.chosen : '— left blank'}
                    {item.mark ? ` (${item.mark} mark${item.mark === 1 ? '' : 's'})` : ''}
                    {item.markingGuide ? <> · Marking guide: {item.markingGuide}</> : null}
                  </p>
                ) : item.options.length > 0 ? (
                  <ol type="A" className="result-paper-options">
                    {item.options.map((option, index) => (
                      <li key={`${item.idx}-${index}`} className={index === item.chosen ? 'student-choice' : undefined}>
                        <MathText text={option} />
                        {index === item.chosen ? <span className="result-option-note">Student answer</span> : null}
                        {index === item.correct ? <span className="result-option-note correct">Correct answer</span> : null}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="result-paper-response">Student response: {item.chosen === null ? 'Not answered' : item.options[item.chosen as number] ?? 'Response recorded'}</p>
                )}
              </section>
            ))}
            <footer className="result-paper-foot">Official student answer record · {new Date(result.submittedAt).toLocaleString()}</footer>
          </article>
        ) : (
          <article className="result-print-sheet result-print-certificate">
            <div className="certificate-inner">
              <div className="certificate-seal" aria-hidden="true"><span>TG</span><small>BTMS</small></div>
              <p className="result-school">T. Gold Brighter Tomorrow Model School</p>
              <p className="certificate-overline">Academic achievement</p>
              <h2>Certificate of Achievement</h2>
              <p className="certificate-intro">This certificate is proudly presented to</p>
              <h3 className="certificate-name">{student.name}</h3>
              <p className="certificate-detail">has completed <strong>{result.title}</strong></p>
              <p className="certificate-subject">{result.subject || 'School assessment'}{student.class ? ` · ${student.class}` : ''}</p>
              <div className={`certificate-outcome ${passed ? 'passed' : 'not-passed'}`}>
                <span>FINAL RESULT</span>
                <strong>{passed ? 'PASSED' : 'NOT PASSED'}</strong>
              </div>
              <div className="certificate-score">
                <div><span>MARK</span><strong>{result.score} / {result.total}</strong></div>
                <div><span>PERCENTAGE</span><strong>{percent}%</strong></div>
              </div>
              <p className="certificate-detail certificate-id">
                {student.student_id ? `Student ID ${student.student_id} · ` : ''}Issued {new Date(result.submittedAt).toLocaleDateString()}
              </p>
              <div className="certificate-signatures">
                <span>Class teacher</span>
                <span>Head of school</span>
              </div>
            </div>
          </article>
        )}
      </div>
    </section>
  )
}
