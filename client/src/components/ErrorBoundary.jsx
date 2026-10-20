import { Component } from 'react'

// Catches render-time errors in the routed page so a single broken view shows a
// recoverable message instead of blanking the whole app.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
    this.reset = this.reset.bind(this)
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    if (typeof console !== 'undefined') {
      console.error('FlowSync view crashed:', error, info)
    }
  }

  reset() {
    this.setState({ error: null })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="state-box" role="alert" style={{ margin: 24 }}>
        <p className="fs-error" style={{ fontWeight: 600, margin: '0 0 8px' }}>
          This view ran into a problem.
        </p>
        <p className="fs-muted" style={{ margin: '0 0 12px' }}>
          {error?.message || 'Something went wrong while rendering this page.'}
        </p>
        <button type="button" className="fs-btn" onClick={this.reset}>
          Try again
        </button>
      </div>
    )
  }
}
