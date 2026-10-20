import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { notificationApi } from '../api/endpoints'
import useAsync from '../hooks/useAsync'
import { timeAgo } from '../utils/format'
import { notificationTarget } from '../utils/links'

const POLL_MS = 90000 // well inside the 100 requests / 15 minutes limit

export default function NotificationBell() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [tick, setTick] = useState(0)
  const ref = useRef(null)
  const { data, reload } = useAsync(() => notificationApi.list({ limit: 8 }), [tick])

  // Check for new notifications now and then, but not while the tab is hidden.
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setTick((t) => t + 1)
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const unread = data?.unreadCount || 0
  const items = data?.notifications || []

  async function openOne(n) {
    setOpen(false)
    if (!n.isRead) await notificationApi.read(n._id).catch(() => {})
    reload()
    navigate(notificationTarget(n))
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        type="button"
        className="fs-btn ghost"
        aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          setOpen((o) => !o)
          reload()
        }}
      >
        ♪{unread > 0 && <span className="count-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div role="menu" className="panel-card dropdown" aria-label="Recent notifications">
          {items.length === 0 && <p className="fs-muted" style={{ margin: 0 }}>You are all caught up.</p>}
          {items.map((n) => (
            <button key={n._id} type="button" role="menuitem" className={`note-item${n.isRead ? '' : ' unread'}`} onClick={() => openOne(n)}>
              <span>{n.message}</span>
              <span className="fs-muted" style={{ fontSize: '0.8em' }}>{timeAgo(n.createdAt)}</span>
            </button>
          ))}
          <div className="fs-row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
            {unread > 0 && (
              <button type="button" className="fs-btn small" onClick={async () => { await notificationApi.readAll(); reload() }}>
                Mark all read
              </button>
            )}
            <Link to="/notifications" onClick={() => setOpen(false)}>View all</Link>
          </div>
        </div>
      )}
    </div>
  )
}
