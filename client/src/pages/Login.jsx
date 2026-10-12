import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { clearAuthError, login } from '../store/authSlice'
import useTheme from '../hooks/useTheme'

export default function Login() {
  useTheme()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const location = useLocation()
  const { token, status, error } = useSelector((s) => s.auth)
  const [form, setForm] = useState({ email: '', password: '' })
  const [fieldError, setFieldError] = useState('')

  useEffect(() => {
    dispatch(clearAuthError())
  }, [dispatch])

  if (token) return <Navigate to={location.state?.from || '/'} replace />

  async function submit(e) {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return setFieldError('Enter a valid email address')
    if (!form.password) return setFieldError('Enter your password')
    setFieldError('')
    const res = await dispatch(login({ email: form.email.trim(), password: form.password }))
    if (login.fulfilled.match(res)) navigate(location.state?.from || '/', { replace: true })
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const message = fieldError || error

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit} noValidate>
        <h1>Sign in to FlowSync</h1>
        <p className="fs-muted" style={{ margin: 0 }}>Welcome back.</p>
        <label className="fs-label" htmlFor="login-email">Email</label>
        <input id="login-email" type="email" autoComplete="email" className="fs-input" autoFocus value={form.email} onChange={set('email')} />
        <label className="fs-label" htmlFor="login-password">Password</label>
        <input id="login-password" type="password" autoComplete="current-password" className="fs-input" value={form.password} onChange={set('password')} />
        {message && <p className="fs-error" role="alert">{message}</p>}
        <button type="submit" className="fs-btn primary" style={{ width: '100%', marginTop: 16 }} disabled={status === 'loading'}>
          {status === 'loading' ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="fs-muted" style={{ marginBottom: 0 }}>
          <span title="Not built yet">Forgot password? (coming soon)</span>
        </p>
        <p style={{ marginBottom: 0 }}>
          New here? <Link to="/register">Create an account</Link>
        </p>
      </form>
    </div>
  )
}
