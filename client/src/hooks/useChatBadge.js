import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { fetchChannels } from '../store/chatSlice'

const POLL_MS = 30000

// Keeps the channel list (and so the unread badge on the Chat icon) fresh while you are anywhere in the app.
export default function useChatBadge() {
  const dispatch = useDispatch()
  const token = useSelector((s) => s.auth.token)
  const workspaceId = useSelector((s) => s.workspaces.currentId)

  useEffect(() => {
    if (!token || !workspaceId) return undefined
    const load = () => dispatch(fetchChannels(workspaceId))
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [dispatch, token, workspaceId])
}
