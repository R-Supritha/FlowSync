import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarDays, Flag, FolderKanban, Inbox, Timer } from 'lucide-react'
import { dashboardApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { openTask } from '../store/uiSlice'
import { formatDate, isOverdue, taskRef } from '../utils/format'
import { EmptyState, ErrorState, Skeleton } from '../components/ui'

export default function Dashboard() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading') // loading | ready
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const user = useSelector((s) => s.auth.user)

  useEffect(() => {
    let alive = true
    dashboardApi
      .get()
      .then((d) => {
        if (!alive) return
        setData(d)
        setError('')
      })
      .catch((e) => alive && setError(errorMessage(e, 'Failed to load the dashboard')))
      .finally(() => alive && setStatus('ready'))
    return () => {
      alive = false
    }
  }, [reload])

  if (status === 'loading') return <Skeleton lines={8} />
  if (error) return <ErrorState message={error} onRetry={() => setReload((r) => r + 1)} />

  return (
    <div className="page dashboard">
      <h1>Hello, {user?.name?.split(' ')[0] || 'there'}</h1>
      <p className="fs-muted" style={{ marginTop: 0 }}>Here is what needs your attention across your workspaces.</p>

      <div className="stat-grid">
        <Stat icon={FolderKanban} label="Projects" value={data.summary.projects} to="/projects" />
        <Stat icon={Inbox} label="Open tasks" value={data.summary.openTasks} />
        <Stat icon={Flag} label="Due in 7 days" value={data.summary.dueSoonTasks} />
        <Stat icon={Timer} label="Overdue" value={data.summary.overdueTasks} tone={data.summary.overdueTasks ? 'danger' : ''} />
      </div>

      <div className="dash-grid">
        <section className="panel">
          <div className="panel-head">
            <h3>My tasks</h3>
            <span className="fs-muted" style={{ fontSize: 12 }}>{data.summary.openTasks} open</span>
          </div>
          {data.myTasks.length === 0 && <EmptyState title="Nothing assigned">All clear!</EmptyState>}
          <TaskList tasks={data.myTasks} onOpen={(t) => dispatch(openTask(t._id))} />
        </section>

        <section className="panel">
          <div className="panel-head"><h3>Upcoming deadlines</h3></div>
          {data.upcomingDeadlines.length === 0 && <EmptyState title="No deadlines soon" />}
          <TaskList tasks={data.upcomingDeadlines} onOpen={(t) => dispatch(openTask(t._id))} />
        </section>
      </div>

      <section className="panel">
        <div className="panel-head"><h3>Upcoming milestones</h3></div>
        {data.upcomingMilestones.length === 0 && <EmptyState title="Nothing scheduled" />}
        <div className="milestone-list">
          {data.upcomingMilestones.map((m) => (
            <button key={m._id} type="button" className="milestone-card" onClick={() => navigate(`/projects/${m.project}/milestones`)}>
              <span className="bullet" />
              <span className="ellipsis">
                <strong>{m.title}</strong>
                <span className="fs-muted block-ellipsis">{m.projectName}</span>
              </span>
              <span className="fs-muted">{formatDate(m.targetDate)}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>Recent projects</h3></div>
        <div className="recent-grid">
          {data.recentProjects.map((p) => (
            <Link key={p._id} to={`/projects/${p._id}/board`} className="recent-card">
              <CalendarDays size={15} aria-hidden="true" />
              <span className="ellipsis">{p.name}</span>
              <span className="fs-muted" style={{ fontSize: 11 }}>{p.deadline ? `due ${formatDate(p.deadline)}` : 'no deadline'}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

function Stat({ icon: Icon, label, value, tone = '', to = '' }) {
  const inner = (
    <div className="stat">
      <span className="stat-value"><Icon size={15} aria-hidden="true" /> <span className={tone}>{value}</span></span>
      <span className="stat-label">{label}</span>
    </div>
  )
  return to ? <Link to={to} className="stat-link">{inner}</Link> : inner
}

function TaskList({ tasks, onOpen }) {
  if (!tasks.length) return null
  return (
    // The table scrolls sideways inside its card when the card is narrower than the table, instead of running over the next card.
    <div style={{ overflowX: 'auto' }}>
    <table className="fs-table">
      <thead>
        <tr><th>Ref</th><th>Title</th><th>Project</th><th>Status</th><th>Priority</th><th>Deadline</th></tr>
      </thead>
      <tbody>
        {tasks.map((t) => (
          <tr key={t._id} style={{ cursor: 'pointer' }} onClick={() => onOpen(t)}>
            <td><span className="task-ref">{taskRef(t._id)}</span></td>
            <td className="ellipsis" style={{ maxWidth: 320 }}>{t.title}</td>
            <td className="fs-muted ellipsis" style={{ maxWidth: 200 }}>{t.projectName || '—'}</td>
            <td><span className="badge">{t.status}</span></td>
            <td><span className={`badge ${String(t.priority).toLowerCase()}`}>{t.priority}</span></td>
            <td className={t.deadline && isOverdue(t.deadline, t.status) ? 'danger-text' : ''}>
              {formatDate(t.deadline) || '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}