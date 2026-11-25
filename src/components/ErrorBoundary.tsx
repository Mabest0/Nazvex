import { Component, type ErrorInfo, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

interface Props {
  children: ReactNode
  /** Shown in the message so it is clear which part failed. */
  label?: string
}

/** Keeps one broken view from blanking the whole app. */
export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Render error in ${this.props.label ?? 'view'}:`, error.message, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="card flex flex-col items-center px-6 py-14 text-center">
        <TriangleAlert className="size-8" style={{ color: 'var(--warn)' }} />
        <h2 className="display mt-4 text-lg font-semibold">This view hit a problem</h2>
        <p className="mt-1 max-w-md text-pretty text-sm" style={{ color: 'var(--subtle)' }}>
          {this.state.error.message || 'Unexpected error.'} Your funds and settings are safe onchain.
        </p>
        <button type="button" className="btn btn-primary mt-5" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}
