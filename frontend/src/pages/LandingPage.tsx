import { navigate } from '../lib/router'
import { Button, Icon } from '../components/ui'
import { Seal } from '../components/ui'

const FEATURES = [
  {
    icon: 'dashboard' as const,
    title: 'Papers on the clock',
    body: 'One continuous paper, sat on a timer, answerable in any order. Answers save as you go, so nothing is ever lost.',
  },
  {
    icon: 'bank' as const,
    title: 'Question bank',
    body: 'Build and save your own MCQ bank, search it, tag it by subject and class level, and reuse it across papers.',
  },
  {
    icon: 'book' as const,
    title: 'Exam builder',
    body: 'Set sections (compulsory and optional), choose question counts, assign papers to students or a whole class.',
  },
  {
    icon: 'students' as const,
    title: 'Full answer review',
    body: 'Every mark comes back with the reasoning behind it — objective marking is instant, theory scripts marked by hand.',
  },
]

const PORTALS = [
  {
    role: 'student' as const,
    label: 'Student Portal',
    desc: 'Sit assigned papers and read the full answer review.',
    icon: 'students' as const,
    color: '#0f9d6e',
  },
  {
    role: 'teacher' as const,
    label: 'Teacher Portal',
    desc: 'Build the bank, set the paper, mark the scripts.',
    icon: 'book' as const,
    color: '#4f46e5',
  },
]

export function LandingPage() {
  const go = () => {
    navigate('/login')
  }

  return (
    <main className="landing" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: '#f5f7f6', color: '#0d1512', fontFamily: 'var(--font-body)' }}>
      <section className="landing-card" style={{
        maxWidth: 900,
        width: '92vw',
        padding: 48,
        borderRadius: 24,
        background: '#ffffff',
        boxShadow: '0 24px 60px -12px rgba(13,21,18,0.12)',
        border: '1px solid rgba(13,21,18,0.08)',
        display: 'grid',
        gap: 32,
      }}>
        <div className="landing-head" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Seal />
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#6a7772' }}>
              T. Gold Brighter Tomorrow · Model School
            </div>
            <h1 style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', lineHeight: 1.05, margin: '8px 0 0', letterSpacing: '-0.02em', fontVariationSettings: "'wdth' 95" }}>
              Computer-Based Testing
            </h1>
            <p style={{ fontSize: 'clamp(0.95rem, 2vw, 1.1rem)', color: '#3c4a45', marginTop: 10, lineHeight: 1.5 }}>
              One calm place for every paper — set it, sit it, mark it, and get the reasoning behind every mark.
            </p>
          </div>
        </div>

        <div className="landing-features" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 18 }}>
          {FEATURES.map((f) => (
            <div key={f.title} style={{ display: 'flex', gap: 12, padding: 16, borderRadius: 14, background: '#f2f6f3', border: '1px solid rgba(13,21,18,0.06)' }}>
              <Icon name={f.icon} size={20} style={{ color: '#0e7490' }} />
              <div>
                <div style={{ fontWeight: 650, fontSize: '0.95rem', color: '#0d1512' }}>{f.title}</div>
                <div style={{ fontSize: '0.85rem', color: '#6a7772', lineHeight: 1.5, marginTop: 4 }}>{f.body}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="landing-portals" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginTop: 8 }}>
          {PORTALS.map((p) => (
            <button
              key={p.role}
              type="button"
              onClick={go}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '18px 20px',
                borderRadius: 16,
                border: '1px solid rgba(13,21,18,0.1)',
                background: '#ffffff',
                color: '#0d1512',
                fontSize: '0.95rem',
                fontWeight: 650,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#f2f6f3'; (e.currentTarget as HTMLElement).style.borderColor = p.color; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = '#ffffff'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(13,21,18,0.1)'; }}
            >
              <Icon name={p.icon} size={18} style={{ color: p.color }} />
              <div>
                <div>{p.label}</div>
                <div style={{ fontSize: '0.8rem', color: '#6a7772', fontWeight: 500 }}>{p.desc}</div>
              </div>
            </button>
          ))}
        </div>

        <div className="landing-cta" style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <Button variant="primary" size="lg" block={false} onClick={() => navigate('/login')}>
            <Icon name="arrowRight" size={16} style={{ color: '#ffffff' }} />
            <span style={{ marginLeft: 8, fontWeight: 650 }}>Get Started — Sign In</span>
          </Button>
        </div>
      </section>
    </main>
  )
}
