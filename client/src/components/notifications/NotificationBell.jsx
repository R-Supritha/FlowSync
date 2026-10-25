import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { Bell, CheckCheck, Inbox } from 'lucide-react'
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from '../../store/notificationsSlice'
import useNotifications from '../../hooks/useNotifications'
import { relativeTime } from '../../utils/format'
import { Dropdown, EmptyState } from '../ui'

const TYPE_ICON = {
  task_assigned: 'Assigned',
  mention: 'Mentioned',
  comment_reply: 'Reply',
  deadline_approaching: 'Deadline',
  deadline_overdue: 'Overdue',
  status_changed: 'Status',
  pr_opened: 'Pull request',
  pr_merged: 'Merged',
}

export default function NotificationBell() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const unreadCount = useSelector((s) => s.notifications.unreadCount)
  const items = useSelector((s) => s.notifications.items)
  const status = useSelector((s) => s.notifications.status)

  useNotifications(false, 1)

  useEffect(() => {
    if (status === 'idle') dispatch(fetchNotifications({ limit: 8 }))
  }, [dispatch, status])

  function go(notification) {
    const link = notification.link || {}
    dispatch(markNotificationRead(notification._id)).then(() => {
      if (link.task) {
        const target = link.project ? `/projects/${link.project}/board` : '/'
        navigate(target)
        dispatch(fetchNotifications({ limit: 8 }))
      } else {
        navigate('/notifications')
      }
    })
  }

  return (
    <Dropdown
      label="Notifications"
      width={340}
      button={<span className="bell-wrap"><Bell size={17} aria-hidden="true" />{unreadCount > 0 && <span className="badge-dot">{unreadCount}</span>}</span>}
    >
      {({ close }) => (
        <>
          <div className="dropdown-head">
            <strong>Notifications</strong>
            <button
              type="button"
              className="fs-btn small ghost"
              disabled={unreadCount === 0}
              onClick={() => dispatch(markAllNotificationsRead())}
            >
              <CheckCheck size={13} aria-hidden="true" /> Mark all read
            </button>
          </div>
          <div className="dropdown-scroll">
            {items.length === 0 && (
              <EmptyState title="Nothing here yet">
                Notifications about your tasks and mentions will show up here.
              </EmptyState>
            )}
            {items.slice(0, 8).map((n) => (
              <button
                type="button"
                key={n._id}
                className={`notif-item${n.isRead ? ' read' : ''}`}
                onClick={() => go(n)}
              >
                <span className="notif-type">{TYPE_ICON[n.type] || 'Update'}</span>
                <span className="notif-body">
                  <span>{n.message}</span>
                  <span className="fs-muted">{relativeTime(n.createdAt)}</span>
                </span>
                {!n.isRead && <span className="unread-mark" aria-label="Unread" />}
              </button>
            ))}
          </div>
          <div className="dropdown-foot">
            <button type="button" className="fs-btn small" onClick={() => { go({}); close() }}>
              <Inbox size={13} aria-hidden="true" /> View all
            </button>
          </div>
        </>
      )}
    </Dropdown>
  )
}