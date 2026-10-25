import { useState } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import useTheme from '../hooks/useTheme'

// FR1: ask for a password reset link. The answer is the same whether or not the email is registered.
export default function ForgotPassword() {
  useTheme()
  const [email, setEmail] = useState('')
  const [state, setState] = useState({ status: 'idle', message: '' })

  async function submit(e) {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setState({ status: 'error', message: 'Enter a valid email address' })
    setState({ status: 'sending', message: '' })
    try {
      const res = await authApi.forgot(email.trim())
      setState({ status: 'sent', message: res.message })
    } catch (err) {
      setState({ status: 'error', message: errorMessage(err, 'Could not send the reset link') })
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit} noValidate>
        <h1>Reset your password</h1>
        {state.status === 'sent' ? (
          <>
            <p role="status">{state.message}</p>
            <p className="fs-muted">The link works for 60 minutes and can be used once.</p>
          </>
        ) : (
          <>
            <p className="fs-muted" style={{ margin: 0 }}>Enter the email you signed up with and we will send you a link.</p>
            <label className="fs-label" htmlFor="fp-email">Email</label>
            <input id="fp-email" type="email" autoComplete="email" className="fs-input" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
            {state.status === 'error' && <p className="fs-error" role="alert">{state.message}</p>}
            <button type="submit" className="fs-btn primary" style={{ width: '100%', marginTop: 16 }} disabled={state.status === 'sending'}>
              {state.status === 'sending' ? 'Sending…' : 'Send reset link'}
            </button>
          </>
        )}
        <p style={{ marginBottom: 0 }}><Link to="/login">Back to sign in</Link></p>
      </form>
    </div>
  )
}
