import { Component, type ReactNode } from "react"

/**
 * Keeps one part of the window from taking the rest down (PRD: a failure
 * cannot blank the core). The error is logged; the part shows a short note
 * and can be tried again. What the outputs show is not touched.
 */
export class ErrorBoundary extends Component<{ name: string; children: ReactNode; quiet?: boolean }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error) {
    console.error(`[ui] ${this.props.name} failed:`, error)
  }

  render() {
    if (!this.state.error) return this.props.children
    if (this.props.quiet) return null
    return (
      <div role="alert" className="m-6 rounded-lg border border-destructive/40 bg-card p-4 text-sm">
        <p className="font-medium">Something went wrong in {this.props.name}.</p>
        <p className="mt-1 text-muted-foreground">The screens keep showing what they showed. Try again, or switch to another view.</p>
        <button type="button" className="mt-3 rounded-md border border-border px-3 py-1.5 hover:bg-muted" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    )
  }
}
