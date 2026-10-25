import { useCallback, useEffect, useState } from 'react'
import { api, type Question } from '../../api'
import { EmptyState, Skeleton, Modal } from '../../components/ui'
import { notify, ConfirmDialog } from '../../components/feedback'
import { BankRow } from '../../components/patterns/BankRow'
import { QuestionEditor } from '../../components/patterns/QuestionEditor'

const EMPTY: Question = { prompt: '', options: ['', '', '', ''], answer: 0, topic: '', subject: '', difficulty: 'medium', explanation: '' }

export function Bank() {
  const [questions, setQuestions] = useState<Question[]>([])
  const [semanticResults, setSemanticResults] = useState<Question[] | null>(null)
  const [search, setSearch] = useState('')
  const [semantic, setSemantic] = useState(false)
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState<Question | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<Question | null>(null)
  const [deleting, setDeleting] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setLoading(true)
      const r = await api.listQuestions()
      setQuestions(r.questions)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not load questions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!semantic || !search.trim()) {
      setSemanticResults(null)
      return
    }

    const timer = setTimeout(async () => {
      setSearching(true)
      try {
        const r = await api.searchQuestions(search)
        setSemanticResults(r.questions)
      } catch (err) {
        console.warn('Semantic search failed:', err)
      } finally {
        setSearching(false)
      }
    }, 500)

    return () => clearTimeout(timer)
  }, [search, semantic])

  const filtered = semanticResults !== null ? semanticResults : questions.filter((q) => {
    const s = search.toLowerCase()
    return !s || q.prompt.toLowerCase().includes(s) || (q.topic || '').toLowerCase().includes(s) || (q.subject || '').toLowerCase().includes(s)
  })

  /** Resolves true once the change is stored, so a dive can ascend on it. */
  const save = async (q: Question) => {
    setSaving(true)
    setMessage('')
    try {
      const clean = {
        prompt: q.prompt.trim(),
        options: q.options.map((o) => o.trim()).filter(Boolean),
        answer: Math.min(q.answer, q.options.length - 1),
        topic: q.topic?.trim() || null,
        subject: q.subject?.trim() || null,
        difficulty: q.difficulty || 'medium',
        explanation: q.explanation?.trim() || null,
        figure: q.figure?.trim() || null,
      }
      if (clean.options.length < 2) throw new Error('A question needs at least 2 options')
      if (q.id) await api.updateQuestion(q.id, clean)
      else await api.createQuestion(clean)
      setEditing(null)
      notify('success', q.id ? 'Question updated in the bank.' : 'Question saved to the bank.')
      await refresh()
      return true
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save question')
      return false
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!confirmDelete?.id) return
    setDeleting(true)
    try {
      await api.deleteQuestion(confirmDelete.id)
      notify('success', 'Question deleted from the bank.')
    } catch {
      notify('error', 'Could not delete this question.')
    } finally {
      setDeleting(false)
      setConfirmDelete(null)
      await refresh()
    }
  }

  return (
    <div>
      <div className="page-head">
        <div>
          <h1>Question bank</h1>
          <p className="sub">{questions.length} questions saved. Build the rest in the AI Lab.</p>
        </div>
        <button className="btn primary" onClick={() => setEditing({ ...EMPTY })}>+ New question</button>
      </div>

      {message && <p className="error">{message}</p>}

      <div className="panel">
        <div className="panel-head">
          <div className="field" style={{ margin: 0, flex: 1, maxWidth: 360 }}>
            <input
              placeholder={semantic ? 'Search by concept (AI powered)…' : 'Search by prompt, topic or subject…'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="flex" style={{ gap: 12 }}>
            <label className="flex" style={{ gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500 }}>
              <input type="checkbox" checked={semantic} onChange={(e) => setSemantic(e.target.checked)} />
              Semantic Search (AI)
            </label>
            <span className="tag">{searching ? 'Searching…' : `${filtered.length} shown`}</span>
          </div>
        </div>
        <div className="panel-body">
          {loading ? (
            <div style={{ display: 'grid', gap: 14 }}>
              {[0, 1, 2].map((i) => (
                <div key={i} className="q-row" style={{ borderBottom: 0 }}>
                  <div style={{ flex: 1, display: 'grid', gap: 10 }}>
                    <Skeleton w="70%" h={14} />
                    <Skeleton w="40%" h={11} />
                    <Skeleton w="28%" h={22} r={99} />
                  </div>
                  <div className="flex" style={{ gap: 8 }}>
                    <Skeleton w={72} h={38} r={10} />
                    <Skeleton w={86} h={38} r={10} />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={search ? 'search' : 'bank'}
              title={search ? 'No questions match your search' : 'Your question bank is empty'}
              body={search ? 'Try a different keyword, or clear the search.' : 'Generate questions in the AI Lab, or create your first one manually.'}
            />
          ) : (
            <div className="bank-list">
              {filtered.map((q, i) => (
                <BankRow
                  key={q.id ?? i}
                  question={{ ...q, options: [...q.options] }}
                  number={i + 1}
                  tags={[q.subject, q.topic, q.difficulty].filter(Boolean) as string[]}
                  saving={saving}
                  onSave={save}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {editing && <QuestionForm q={editing} saving={saving} onSave={save} onClose={() => setEditing(null)} />}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete this question?"
          body="This removes the question from the bank permanently. Exams that already include it are unaffected."
          confirmLabel="Delete question"
          busy={deleting}
          onConfirm={() => void doDelete()}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  )
}

export function QuestionForm({ q, saving, onSave, onClose }: { q: Question; saving: boolean; onSave: (q: Question) => void; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={q.id ? 'Edit question' : 'New question'} width={560}>
      <QuestionEditor
        q={q}
        saving={saving}
        submitLabel="Save question"
        footer="inline"
        onSave={(next) => {
          onSave(next)
          return true
        }}
        onCancel={onClose}
      />
    </Modal>
  )
}
