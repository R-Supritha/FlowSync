import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { authApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import useTheme from '../hooks/useTheme'

// FR1: choose a new password with the link from the email.
export default function ResetPassword() {
  useTheme()
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [form, setForm] = useState({ password: '', confirm: '' })
  const [state, setState] = useState({ status: 'idle', message: '' })
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    if (form.password.length < 8) return setState({ status: 'error', message: 'Password must be at least 8 characters' })
    if (form.password !== form.confirm) return setState({ status: 'error', message: 'The two passwords do not match' })
    setState({ status: 'saving', message: '' })
    try {
      const res = await authApi.reset(token, form.password)
      setState({ status: 'done', message: res.message })
    } catch (err) {
      setState({ status: 'error', message: errorMessage(err, 'Could not change the password') })
    }
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit} noValidate>
        <h1>Choose a new password</h1>
        {!token ? (
          <p className="fs-error" role="alert">This reset link is incomplete. <Link to="/forgot-password">Ask for a new one</Link>.</p>
        ) : state.status === 'done' ? (
          <>
            <p role="status">{state.message}</p>
            <Link className="fs-btn primary" to="/login" style={{ display: 'block', textAlign: 'center' }}>Sign in</Link>
          </>
        ) : (
          <>
            <label className="fs-label" htmlFor="rp-password">New password</label>
            <input id="rp-password" type="password" autoComplete="new-password" className="fs-input" autoFocus value={form.password} onChange={set('password')} />
            <label className="fs-label" htmlFor="rp-confirm">Repeat the new password</label>
            <input id="rp-confirm" type="password" autoComplete="new-password" className="fs-input" value={form.confirm} onChange={set('confirm')} />
            <p className="fs-muted" style={{ margin: '4px 0 0' }}>At least 8 characters.</p>
            {state.status === 'error' && (
              <p className="fs-error" role="alert">
                {state.message} {/expired|invalid/i.test(state.message) && <Link to="/forgot-password">Ask for a new link</Link>}
              </p>
            )}
            <button type="submit" className="fs-btn primary" style={{ width: '100%', marginTop: 16 }} disabled={state.status === 'saving'}>
              {state.status === 'saving' ? 'Saving…' : 'Change password'}
            </button>
          </>
        )}
        {state.status !== 'done' && <p style={{ marginBottom: 0 }}><Link to="/login">Back to sign in</Link></p>}
      </form>
    </div>
  )
}
