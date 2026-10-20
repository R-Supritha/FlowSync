import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { sendHeartbeat, fetchMyPresence } from '../store/presenceSlice'

const HEARTBEAT_MS = 60000

// Reports to the server once a minute that the app is open. `active` is false while
// the tab is hidden, so the backend can tell Active from Idle without a timer here.
export default function useHeartbeat() {
  const dispatch = useDispatch()
  const token = useSelector((s) => s.auth.token)

  useEffect(() => {
    if (!token) return undefined
    const ping = () => dispatch(sendHeartbeat(document.visibilityState === 'visible'))
    ping()
    const timer = setInterval(ping, HEARTBEAT_MS)
    const onVisible = () => dispatch(sendHeartbeat(true))
    document.addEventListener('visibilitychange', onVisible)
    // Pull the stored status/work-mode/working-on once per session.
    dispatch(fetchMyPresence())
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [dispatch, token])
}