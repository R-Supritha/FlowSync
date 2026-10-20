import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="auth-wrap">
      <div className="auth-card" style={{ textAlign: 'center' }}>
        <h1>Page not found</h1>
        <p className="fs-muted">That address doesn't exist.</p>
        <Link to="/">Back to FlowSync</Link>
      </div>
    </div>
  )
}
