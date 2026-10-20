import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Bell, CheckCheck, Trash2 } from 'lucide-react'
import {
  deleteNotification,
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  setUnreadOnly,
} from '../store/notificationsSlice'
import { openTask, pushToast } from '../store/uiSlice'
import { useNavigate } from 'react-router-dom'
import { errorMessage } from '../api/client'
import { formatDateTime } from '../utils/format'
import { EmptyState, ErrorState, Pagination, Spinner } from '../components/ui'

const TYPE_LABEL = {
  task_assigned: 'Assigned',
  mention: 'Mentioned',
  comment_reply: 'Reply',
  deadline_approaching: 'Deadline',
  status_changed: 'Status',
}

export default function Notifications() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const { items, unreadCount, page, pages, status, error, unreadOnly } = useSelector((s) => s.notifications)

  useEffect(() => {
    if (status === 'idle') dispatch(fetchNotifications({ unread: unreadOnly, page, limit: 20 }))
  }, [dispatch, status, unreadOnly, page])

  function open(n) {
    if (!n.isRead) dispatch(markNotificationRead(n._id))
    const link = n.link || {}
    if (link.task) {
      dispatch(openTask(link.task))
    } else if (link.project) {
      navigate(`/projects/${link.project}/board`)
    } else {
      navigate('/notifications')
    }
  }

  async function clearAll() {
    try {
      await dispatch(markAllNotificationsRead()).unwrap()
      dispatch(pushToast('All notifications marked read', 'success'))
    } catch (e) {
      dispatch(pushToast(errorMessage(e), 'error'))
    }
  }

  if (status === 'loading' && items.length === 0) return <Spinner label="Loading notifications…" />
  if (status === 'error' && items.length === 0) {
    return <ErrorState message={error} onRetry={() => dispatch(fetchNotifications({ unread: unreadOnly, page, limit: 20 }))} />
  }

  return (
    <div className="page">
      <div className="fs-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <h1 style={{ marginBottom: 0 }}><Bell size={20} aria-hidden="true" /> Notifications</h1>
        <div className="fs-row" style={{ gap: 8 }}>
          <button type="button" className="fs-btn small" disabled={unreadCount === 0} onClick={clearAll}>
            <CheckCheck size={13} aria-hidden="true" /> Mark all read
          </button>
          <label className="fs-row" style={{ gap: 4, fontSize: 13 }}>
            <input type="checkbox" checked={unreadOnly} onChange={(e) => dispatch(setUnreadOnly(e.target.checked))} />
            Unread only
          </label>
        </div>
      </div>

      {items.length === 0 && <EmptyState title={unreadOnly ? 'No unread notifications' : 'Nothing here yet'} />}

      <ul className="notif-page-list">
        {items.map((n) => (
          <li key={n._id} className={`notif-page-item${n.isRead ? ' read' : ''}`}>
            <button type="button" className="notif-main" onClick={() => open(n)}>
              <span className="notif-type">{TYPE_LABEL[n.type] || 'Update'}</span>
              <span className="activity-line">
                <p>{n.message}</p>
                <span className="fs-muted">{formatDateTime(n.createdAt)}</span>
              </span>
              {!n.isRead && <span className="unread-mark" aria-label="Unread" />}
            </button>
            <button
              type="button"
              className="fs-btn small ghost"
              aria-label="Delete notification"
              onClick={async () => {
                try {
                  await dispatch(deleteNotification(n._id)).unwrap()
                } catch (e) {
                  dispatch(pushToast(errorMessage(e), 'error'))
                }
              }}
            >
              <Trash2 size={13} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      <Pagination page={page} pages={pages} onChange={(p) => dispatch(fetchNotifications({ unread: unreadOnly, page: p, limit: 20 }))} />
    </div>
  )
}