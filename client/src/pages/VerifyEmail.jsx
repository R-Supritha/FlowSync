import { useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useSearchParams } from 'react-router-dom'
import { authApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { setUser } from '../store/authSlice'
import useTheme from '../hooks/useTheme'

// FR1: the page the link in the confirmation email opens. It works signed in or signed out.
export default function VerifyEmail() {
  useTheme()
  const dispatch = useDispatch()
  const signedIn = useSelector((s) => Boolean(s.auth.token))
  const [params] = useSearchParams()
  const token = params.get('token') || ''
  const [state, setState] = useState({ status: token ? 'verifying' : 'error', message: token ? '' : 'This confirmation link is incomplete.' })
  const started = useRef(false)

  useEffect(() => {
    if (!token || started.current) return
    started.current = true // the link may only be used once, so ask only once
    authApi
      .verify(token)
      .then((res) => {
        dispatch(setUser({ emailVerified: true }))
        setState({ status: 'done', message: res.message })
      })
      .catch((err) => setState({ status: 'error', message: errorMessage(err, 'Could not confirm the email') }))
  }, [token, dispatch])

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1>Email confirmation</h1>
        {state.status === 'verifying' && <p role="status">Confirming your email…</p>}
        {state.status === 'done' && (
          <>
            <p role="status">{state.message}</p>
            <Link className="fs-btn primary" to={signedIn ? '/' : '/login'} style={{ display: 'block', textAlign: 'center' }}>
              {signedIn ? 'Continue to FlowSync' : 'Sign in'}
            </Link>
          </>
        )}
        {state.status === 'error' && (
          <>
            <p className="fs-error" role="alert">{state.message}</p>
            <p className="fs-muted">If you already confirmed your email, you can just sign in. Otherwise sign in and use "Resend link" in the banner at the top.</p>
            <Link to="/login">Go to sign in</Link>
          </>
        )}
      </div>
    </div>
  )
}
