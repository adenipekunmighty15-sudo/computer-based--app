import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '../ui/Button'
import { Icon } from '../ui/Icon'

/* App-wide safety net.

   An uncaught render error used to leave the whole app a blank white screen
   with no way forward. This boundary catches it, logs the details, and offers
   the two things a person can actually do: try the render again, or reload. It
   deliberately uses no context or router state, so it still works when the
   thing that broke is a provider. */

interface Props {
  children: ReactNode
  /** Optional custom fallback; receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App crashed:', error, info.componentStack)
  }

  reset = () => this.setState({ error: null })

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    if (this.props.fallback) return this.props.fallback(error, this.reset)

    return (
      <main className="onboarding" role="alert">
        <section className="onboarding-card">
          <div className="onboarding-head">
            <h1>Something went wrong</h1>
            <p className="hint">
              The page hit an unexpected error. Your work is saved as you go — reload to pick up where
              you left off.
            </p>
          </div>
          <div className="row-end" style={{ gap: 10, paddingTop: 12 }}>
            <Button variant="secondary" onClick={this.reset}>
              Try again
            </Button>
            <Button variant="primary" icon="refresh" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
          {import.meta.env.DEV ? (
            <p className="notice bad" style={{ marginTop: 16 }}>
              <Icon name="warn" size={15} />
              <code style={{ whiteSpace: 'pre-wrap' }}>{error.message}</code>
            </p>
          ) : null}
        </section>
      </main>
    )
  }
}
