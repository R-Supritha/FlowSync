import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { notificationApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import useAsync from '../hooks/useAsync'
import { pushToast } from '../store/uiSlice'
import { timeAgo } from '../utils/format'
import { notificationTarget } from '../utils/links'
import { EmptyState, ErrorState, Spinner } from '../components/ui'

const LABELS = { task_assigned: 'Assigned', mention: 'Mention', comment_reply: 'Reply', deadline_approaching: 'Deadline', status_changed: 'Status' }

export default function Notifications() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [page, setPage] = useState(1)
  const { data, error, loading, reload } = useAsync(
    () => notificationApi.list({ page, limit: 15, ...(unreadOnly ? { unread: true } : {}) }),
    [page, unreadOnly],
  )

  async function act(fn, ok) {
    try {
      await fn()
      if (ok) dispatch(pushToast(ok, 'success'))
      reload()
    } catch (e) {
      dispatch(pushToast(errorMessage(e), 'error'))
    }
  }

  const items = data?.notifications || []
  return (
    <div className="page">
      <div className="fs-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <h1>Notifications</h1>
        <div className="fs-row">
          <label className="fs-row fs-muted">
            <input type="checkbox" checked={unreadOnly} onChange={(e) => { setUnreadOnly(e.target.checked); setPage(1) }} />
            Unread only
          </label>
          <button type="button" className="fs-btn" disabled={!data?.unreadCount} onClick={() => act(() => notificationApi.readAll(), 'All marked as read')}>
            Mark all read{data?.unreadCount ? ` (${data.unreadCount})` : ''}
          </button>
        </div>
      </div>
      {error && <ErrorState message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Loading notifications…" />}
      {data && items.length === 0 && <EmptyState title={unreadOnly ? 'No unread notifications' : 'No notifications yet'}>Assignments, mentions and replies will show up here.</EmptyState>}
      <ul className="list">
        {items.map((n) => (
          <li key={n._id} className={`list-row${n.isRead ? '' : ' unread'}`}>
            <span className="badge">{LABELS[n.type] || n.type}</span>
            <button type="button" className="link-btn" style={{ flex: 1, textAlign: 'left' }}
              onClick={async () => {
                if (!n.isRead) await notificationApi.read(n._id).catch(() => {})
                navigate(notificationTarget(n))
              }}>
              {n.message}
            </button>
            <span className="fs-muted">{timeAgo(n.createdAt)}</span>
            {!n.isRead && <button type="button" className="fs-btn small" onClick={() => act(() => notificationApi.read(n._id))}>Mark read</button>}
            <button type="button" className="fs-btn small danger" aria-label={`Delete notification: ${n.message}`} onClick={() => act(() => notificationApi.remove(n._id), 'Notification deleted')}>Delete</button>
          </li>
        ))}
      </ul>
      {data && data.pages > 1 && (
        <div className="fs-row" style={{ marginTop: 10 }}>
          <button type="button" className="fs-btn small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
          <span className="fs-muted">Page {page} of {data.pages}</span>
          <button type="button" className="fs-btn small" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
        </div>
      )}
    </div>
  )
}
