import React from 'react'

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export default class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, info.componentStack)
  }

  handleTryAgain = (): void => {
    this.setState({ hasError: false, error: null })
  }

  handleReload = (): void => {
    window.api.win.reload()
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-screen">
          <div className="error-boundary-card">
            <h2 className="error-boundary-title">Something went wrong</h2>
            <p className="error-boundary-message">
              {this.state.error?.message || 'An unexpected error occurred.'}
            </p>
            <div className="error-boundary-actions">
              <button className="btn" onClick={this.handleTryAgain}>
                Try Again
              </button>
              <button className="btn btn-secondary" onClick={this.handleReload}>
                Reload App
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
