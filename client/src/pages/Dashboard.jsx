import { useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import { dashboardApi } from '../api/endpoints'
import useAsync from '../hooks/useAsync'
import { formatDate, isOverdue } from '../utils/format'
import { EmptyState, ErrorState, Spinner } from '../components/ui'
import { WorkspaceForm } from '../components/dialogs'

const projectOf = (t) => t.project?._id || t.project
const projectName = (t) => t.projectName || t.project?.name || ''

function TaskRow({ task }) {
  return (
    <li className="list-row">
      <Link to={`/projects/${projectOf(task)}/board?task=${task._id}`}>{task.title}</Link>
      <span className="fs-muted"> {projectName(task)}</span>
      <span style={{ flex: 1 }} />
      <span className={`badge ${String(task.priority).toLowerCase()}`}>{task.priority}</span>
      {task.deadline && (
        <span className={`badge${isOverdue(task.deadline, task.status) ? ' overdue' : ''}`}>{formatDate(task.deadline)}</span>
      )}
    </li>
  )
}

function Card({ title, empty, children, count }) {
  return (
    <section className="panel-card" aria-label={title}>
      <h3>{title}</h3>
      {count === 0 ? <p className="fs-muted" style={{ margin: 0 }}>{empty}</p> : <ul className="list">{children}</ul>}
    </section>
  )
}

export default function Dashboard() {
  const workspaces = useSelector((s) => s.workspaces.items)
  const wsStatus = useSelector((s) => s.workspaces.status)
  const { data, error, loading, reload } = useAsync(() => dashboardApi.get(), [])

  if (wsStatus === 'ready' && workspaces.length === 0) {
    return (
      <div className="page" style={{ maxWidth: 460 }}>
        <EmptyState title="Create your first workspace">A workspace holds your projects, teams and members.</EmptyState>
        <div className="panel-card"><WorkspaceForm autoFocus /></div>
      </div>
    )
  }
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading || !data) return <Spinner label="Loading your dashboard…" />

  const { summary: s } = data
  const stats = [
    ['Workspaces', s.workspaces], ['Projects', s.projects], ['Open tasks', s.openTasks],
    ['Overdue', s.overdueTasks, s.overdueTasks > 0], ['Due soon', s.dueSoonTasks], ['Unread', s.unreadNotifications],
  ]

  return (
    <div className="page">
      <h1>Dashboard</h1>
      <div className="stat-grid">
        {stats.map(([label, value, bad]) => (
          <div key={label} className="stat">
            <div className="stat-value" style={bad ? { color: 'var(--danger)' } : undefined}>{value}</div>
            <div className="fs-muted">{label}</div>
          </div>
        ))}
      </div>
      <div className="card-grid" style={{ marginTop: 16 }}>
        <Card title="My tasks" empty="No open tasks assigned to you." count={data.myTasks.length}>
          {data.myTasks.map((t) => <TaskRow key={t._id} task={t} />)}
        </Card>
        <Card title="Upcoming deadlines" empty="Nothing due in the next 7 days." count={data.upcomingDeadlines.length}>
          {data.upcomingDeadlines.map((t) => <TaskRow key={t._id} task={t} />)}
        </Card>
        <Card title="Upcoming milestones" empty="No upcoming milestones." count={data.upcomingMilestones.length}>
          {data.upcomingMilestones.map((m) => (
            <li key={m._id} className="list-row">
              <Link to={`/projects/${m.project}/milestones`}>{m.title}</Link>
              <span className="fs-muted"> {m.projectName}</span>
              <span style={{ flex: 1 }} />
              <span className="badge">{formatDate(m.targetDate)}</span>
            </li>
          ))}
        </Card>
        <Card title="Recent projects" empty="No projects yet." count={data.recentProjects.length}>
          {data.recentProjects.map((p) => (
            <li key={p._id} className="list-row">
              <Link to={`/projects/${p._id}/board`}>{p.name}</Link>
              <span style={{ flex: 1 }} />
              {p.deadline && <span className="badge">{formatDate(p.deadline)}</span>}
            </li>
          ))}
        </Card>
      </div>
    </div>
  )
}
