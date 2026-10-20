import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { fetchNotifications } from '../store/notificationsSlice'

const POLL_MS = 45000

// Keeps the unread count fresh. The notification feed endpoint is cheap, so a slow
// poll is fine and avoids hammering the API.
export default function useNotifications(unreadOnly = false, page = 1) {
  const dispatch = useDispatch()
  const token = useSelector((s) => s.auth.token)

  useEffect(() => {
    if (!token) return undefined
    const load = () => dispatch(fetchNotifications({ unread: unreadOnly, page, limit: 20 }))
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [dispatch, token, unreadOnly, page])
}