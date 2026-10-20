import { analyticsApi } from '../api/endpoints'
import useAsync from '../hooks/useAsync'
import { formatDate } from '../utils/format'
import { BarChart, LineChart } from './charts'
import { ErrorState, Spinner } from './ui'

const HEALTH = { on_track: ['On track', 'var(--ok)'], at_risk: ['At risk', 'var(--warn)'], off_track: ['Off track', 'var(--danger)'] }
const pct = (n) => `${Math.round((n || 0) * 100)}%`

export default function AnalyticsView({ projectId }) {
  const { data, error, loading, reload } = useAsync(() => analyticsApi.project(projectId), [projectId])
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading || !data) return <Spinner label="Crunching the numbers…" />

  const { health, totals: t, velocity, burn, forecast, workload, deadlineRisk, teamActivity, averageCompletionTime: avg } = data
  const [healthLabel, healthColor] = HEALTH[health.status] || [health.status, 'var(--fg)']
  const stats = [
    ['Tasks', t.tasks], ['Completed', t.completed], ['Open', t.open], ['Overdue', t.overdue, t.overdue > 0],
    ['At risk', t.atRisk], ['Completion', pct(t.completionRate)], ['Estimated hours', t.estimatedHours], ['Logged hours', t.loggedHours],
  ]

  return (
    <div className="page">
      <h1>Analytics: {data.project.name}</h1>
      <section className="panel-card" aria-label="Project health">
        <h3>Health: <span style={{ color: healthColor }}>{healthLabel}</span></h3>
        {health.reasons.length === 0 ? <p className="fs-muted" style={{ margin: 0 }}>No problems found.</p> : <ul>{health.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      </section>

      <div className="stat-grid" style={{ marginTop: 12 }}>
        {stats.map(([label, value, bad]) => (
          <div key={label} className="stat">
            <div className="stat-value" style={bad ? { color: 'var(--danger)' } : undefined}>{value}</div>
            <div className="fs-muted">{label}</div>
          </div>
        ))}
      </div>

      <div className="card-grid" style={{ marginTop: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
        <section className="panel-card" aria-label="Velocity">
          <h3>Tasks finished per week</h3>
          <BarChart label="Tasks finished per week" data={velocity.map((v) => ({ label: formatDate(v.weekStart), value: v.completedTasks }))} />
        </section>
        <section className="panel-card" aria-label="Burn chart">
          <h3>Burn chart</h3>
          <LineChart
            label="Scope, completed, remaining and ideal tasks per day"
            series={[
              { name: 'Scope', points: burn.series.map((p) => p.scope) },
              { name: 'Completed', points: burn.series.map((p) => p.completed) },
              { name: 'Remaining', points: burn.series.map((p) => p.remaining) },
              { name: 'Ideal', points: burn.series.map((p) => p.ideal), dashed: true },
            ]}
          />
        </section>
        <section className="panel-card" aria-label="By status">
          <h3>Tasks by status</h3>
          <BarChart label="Tasks by status" data={Object.entries(t.byStatus).map(([label, value]) => ({ label, value }))} />
        </section>
        <section className="panel-card" aria-label="Forecast">
          <h3>Forecast</h3>
          {forecast.projectedFinish
            ? <p style={{ margin: 0 }}>At the current pace the project finishes around <strong>{formatDate(forecast.projectedFinish)}</strong> ({forecast.tasksPerWeek} tasks per week){forecast.onTime === false ? ', after the deadline.' : '.'}</p>
            : <p className="fs-muted" style={{ margin: 0 }}>{forecast.note || 'Not enough finished tasks to forecast yet.'}</p>}
          <p className="fs-muted" style={{ marginBottom: 0 }}>
            {avg.completedTasks > 0 ? `Average time to finish a task: ${avg.averageDays} days.` : 'No finished tasks yet.'}
          </p>
        </section>
      </div>

      <section className="panel-card" style={{ marginTop: 12 }} aria-label="Workload">
        <h3>Workload</h3>
        <table className="fs-table">
          <thead><tr><th>Person</th><th>Open</th><th>Open hours</th><th>Overdue</th><th>Done</th><th /></tr></thead>
          <tbody>
            {workload.map((w, i) => (
              <tr key={w.assignee?._id || `none-${i}`}>
                <td>{w.assignee ? w.assignee.name || 'Someone' : 'Unassigned'}</td>
                <td>{w.openTasks}</td><td>{w.openHours}</td><td>{w.overdueTasks}</td><td>{w.completedTasks}</td>
                <td>{w.overloaded && <span className="badge overdue">Overloaded</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel-card" style={{ marginTop: 12 }} aria-label="Deadline risks">
        <h3>Deadline risks</h3>
        {deadlineRisk.length === 0 ? <p className="fs-muted" style={{ margin: 0 }}>No tasks at risk.</p> : (
          <table className="fs-table">
            <thead><tr><th>Task</th><th>Status</th><th>Deadline</th><th>Why</th></tr></thead>
            <tbody>
              {deadlineRisk.map((r) => (
                <tr key={r._id}><td>{r.title}</td><td>{r.status}</td><td>{formatDate(r.deadline)}</td><td>{r.reasons.join(', ')}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="panel-card" style={{ marginTop: 12 }} aria-label="Team activity">
        <h3>Team activity, last 7 days</h3>
        {teamActivity.members.length === 0 ? <p className="fs-muted" style={{ margin: 0 }}>No shared activity.</p> : (
          <table className="fs-table">
            <thead><tr><th>Person</th><th>Events</th><th>Finished</th><th>Collaboration</th><th>Planning</th></tr></thead>
            <tbody>
              {teamActivity.members.map((m) => (
                <tr key={m.user._id}><td>{m.user.name}</td><td>{m.events}</td><td>{m.completed}</td><td>{m.collaboration}</td><td>{m.planning}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        {teamActivity.others?.members > 0 && <p className="fs-muted">Plus {teamActivity.others.members} {teamActivity.others.members === 1 ? 'person' : 'people'} who chose not to share their activity.</p>}
      </section>
    </div>
  )
}
