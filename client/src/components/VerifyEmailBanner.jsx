import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { authApi, profileApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { setUser } from '../store/authSlice'
import { pushToast } from '../store/uiSlice'

// FR1: shown at the top while the signed-in person has not confirmed their email.
export default function VerifyEmailBanner() {
  const dispatch = useDispatch()
  const unverified = useSelector((s) => Boolean(s.auth.user) && s.auth.user.emailVerified === false)
  const [busy, setBusy] = useState(false)

  // The link may have been used in another tab: ask the server once whether it is confirmed by now.
  useEffect(() => {
    if (!unverified) return undefined
    let alive = true
    profileApi
      .me()
      .then((res) => {
        if (alive && res.emailVerified === true) dispatch(setUser({ emailVerified: true }))
      })
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [unverified, dispatch])

  if (!unverified) return null

  async function resend() {
    setBusy(true)
    try {
      const res = await authApi.resend()
      if (res.alreadyVerified) dispatch(setUser({ emailVerified: true }))
      dispatch(pushToast(res.message, 'success'))
    } catch (e) {
      dispatch(pushToast(errorMessage(e, 'Could not send the email'), 'error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="verify-banner" role="status">
      <span>Your email address is not confirmed yet. Open the link we emailed you. Until then you cannot create workspaces or invite people.</span>
      <button type="button" className="fs-btn small" disabled={busy} onClick={resend}>{busy ? 'Sending…' : 'Resend link'}</button>
    </div>
  )
}
