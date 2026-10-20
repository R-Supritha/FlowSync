import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { clearAuthError, register } from '../store/authSlice'
import useTheme from '../hooks/useTheme'

export default function Register() {
  useTheme()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { token, status, error } = useSelector((s) => s.auth)
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [fieldError, setFieldError] = useState('')

  useEffect(() => {
    dispatch(clearAuthError())
  }, [dispatch])

  if (token) return <Navigate to="/" replace />

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) return setFieldError('Enter your name')
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return setFieldError('Enter a valid email address')
    if (form.password.length < 8) return setFieldError('Password must be at least 8 characters')
    setFieldError('')
    const res = await dispatch(register({ name: form.name.trim(), email: form.email.trim(), password: form.password }))
    if (register.fulfilled.match(res)) navigate('/', { replace: true })
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const message = fieldError || error

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit} noValidate>
        <h1>Create your account</h1>
        <label className="fs-label" htmlFor="reg-name">Name</label>
        <input id="reg-name" autoComplete="name" className="fs-input" autoFocus value={form.name} onChange={set('name')} />
        <label className="fs-label" htmlFor="reg-email">Email</label>
        <input id="reg-email" type="email" autoComplete="email" className="fs-input" value={form.email} onChange={set('email')} />
        <label className="fs-label" htmlFor="reg-password">Password</label>
        <input id="reg-password" type="password" autoComplete="new-password" className="fs-input" value={form.password} onChange={set('password')} />
        {message && <p className="fs-error" role="alert">{message}</p>}
        <button type="submit" className="fs-btn primary" style={{ width: '100%', marginTop: 16 }} disabled={status === 'loading'}>
          {status === 'loading' ? 'Creating…' : 'Create account'}
        </button>
        <p style={{ marginBottom: 0 }}>
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  )
}
