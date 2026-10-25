import { useEffect, useState } from 'react'
import { api } from '../../api'
import { Panel, Icon, Skeleton, Button } from '../ui'

interface InsightsData {
  summary: string
  weakTopics: string[]
  strengths: string[]
  nextSteps: string[]
}

export function AiInsights() {
  const [data, setData] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchInsights = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.getClassInsights()
      setData(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load insights')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchInsights()
  }, [])

  if (loading) {
    return (
      <Panel title="AI Performance Insights" kicker="Analysis">
        <div className="stack tight">
          <Skeleton h={16} w="90%" />
          <Skeleton h={16} w="80%" />
          <div className="flex" style={{ gap: 20, marginTop: 12 }}>
            <div className="grow"><Skeleton h={100} /></div>
            <div className="grow"><Skeleton h={100} /></div>
          </div>
        </div>
      </Panel>
    )
  }

  if (error) {
    return (
      <Panel title="AI Performance Insights" kicker="Analysis">
        <div className="notice bad">
          <Icon name="warn" size={15} />
          <span>{error}</span>
          <Button variant="ghost" size="sm" onClick={fetchInsights}>Retry</Button>
        </div>
      </Panel>
    )
  }

  if (!data) return null

  return (
    <Panel 
      title="AI Performance Insights" 
      kicker="Analysis"
      actions={
        <Button variant="ghost" size="sm" icon="refresh" onClick={fetchInsights}>
          Refresh
        </Button>
      }
    >
      <div className="stack">
        <p className="ai-summary" style={{ fontSize: 15, lineHeight: 1.5, color: 'var(--fg-dim)' }}>
          {data.summary}
        </p>

        <div className="grid-cols" style={{ '--cols': 2, gap: 24, marginTop: 16 } as any}>
          <div className="stack tight">
            <h4 className="flex" style={{ gap: 8, color: 'var(--red)', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <Icon name="warn" size={14} /> Weak Topics
            </h4>
            <ul className="stack tight" style={{ padding: 0, listStyle: 'none' }}>
              {data.weakTopics.map((t, i) => (
                <li key={i} className="flex" style={{ gap: 8, fontSize: 14 }}>
                  <span style={{ color: 'var(--red)' }}>•</span> {t}
                </li>
              ))}
              {data.weakTopics.length === 0 && <li className="cell-sub">No critical weak spots identified.</li>}
            </ul>
          </div>

          <div className="stack tight">
            <h4 className="flex" style={{ gap: 8, color: 'var(--green)', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <Icon name="sparkle" size={14} /> Class Strengths
            </h4>
            <ul className="stack tight" style={{ padding: 0, listStyle: 'none' }}>
              {data.strengths.map((s, i) => (
                <li key={i} className="flex" style={{ gap: 8, fontSize: 14 }}>
                  <span style={{ color: 'var(--green)' }}>•</span> {s}
                </li>
              ))}
              {data.strengths.length === 0 && <li className="cell-sub">Keep testing to identify strengths.</li>}
            </ul>
          </div>
        </div>

        <div className="next-steps" style={{ marginTop: 20, padding: 16, background: 'var(--bg-inc)', borderRadius: 12 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Recommended Next Steps</h4>
          <div className="flex wrap" style={{ gap: 8 }}>
            {data.nextSteps.map((step, i) => (
              <span key={i} className="tag neutral" style={{ padding: '6px 12px', borderRadius: 20 }}>
                {step}
              </span>
            ))}
          </div>
        </div>
      </div>
    </Panel>
  )
}
