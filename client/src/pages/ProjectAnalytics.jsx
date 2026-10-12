import { useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'
import { useParams } from 'react-router-dom'
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from 'recharts'
import { analyticsApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { fetchProject } from '../store/projectsSlice'
import { formatDate } from '../utils/format'
import useProject from '../hooks/useProject'
import { EmptyState, ErrorState, Spinner } from '../components/ui'

const HEALTH = {
  completed: { label: 'Completed', color: 'var(--ok)' },
  on_track: { label: 'On track', color: 'var(--ok)' },
  at_risk: { label: 'At risk', color: 'var(--warn)' },
  off_track: { label: 'Off track', color: 'var(--danger)' },
}

export default function ProjectAnalytics() {
  const { projectId } = useParams()
  const dispatch = useDispatch()
  const { project, error: projectError } = useProject(projectId)
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [unit, setUnit] = useState('tasks')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!projectId) return
    let alive = true
    analyticsApi
      .project(projectId, { unit })
      .then((d) => {
        if (!alive) return
        setData(d)
        setError('')
      })
      .catch((e) => alive && setError(errorMessage(e, 'Failed to load analytics')))
      .finally(() => alive && setStatus('ready'))
    return () => {
      alive = false
    }
  }, [projectId, unit, reload])

  if (projectError && !project)
    return <ErrorState message={projectError} onRetry={() => dispatch(fetchProject(projectId))} />
  if (!project) return <Spinner label="Loading project…" />
  if (status === 'loading') return <Spinner label="Crunching numbers…" />
  if (error) return <ErrorState message={error} onRetry={() => setReload((r) => r + 1)} />
  if (!data) return null

  const health = data.health
  const t = data.totals
  const h = HEALTH[health.status] || HEALTH.on_track

  return (
    <div className="page analytics-page">
      <div className={`health-banner ${health.status}`}>
        <span className="health-pill" style={{ background: h.color }}>{h.label}</span>
        <span>{health.reasons.length ? health.reasons.join('. ') : 'Project is healthy.'}</span>
      </div>

      <div className="stat-grid">
        <Stat label="Tasks" value={t.tasks} />
        <Stat label="Completed" value={t.completed} tone="ok" />
        <Stat label="Open" value={t.open} />
        <Stat label="Overdue" value={t.overdue} tone={t.overdue ? 'danger' : ''} />
        <Stat label="At risk" value={t.atRisk} tone={t.atRisk ? 'warn' : ''} />
        <Stat label="Completion" value={`${Math.round((t.completionRate || 0) * 100)}%`} />
        <Stat label="Est. hours" value={t.estimatedHours} />
        <Stat label="Logged hours" value={t.loggedHours} />
      </div>

      <div className="dash-grid">
        <section className="panel span-2">
          <div className="panel-head">
            <h3>Burn chart</h3>
            <div className="fs-row" style={{ gap: 8 }}>
              <span className="fs-muted" style={{ fontSize: 12 }}>{data.burn.days} days</span>
              <select className="fs-select" style={{ width: 'auto' }} value={unit} onChange={(e) => setUnit(e.target.value)} aria-label="Burn unit">
                <option value="tasks">Tasks</option>
                <option value="hours">Hours (estimated)</option>
              </select>
            </div>
          </div>
          <div className="chart">
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={data.burn.series} margin={{ top: 4, right: 12, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="scopeFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="var(--accent)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--fg-muted)' }} tickFormatter={shortDate} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--fg-muted)' }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', color: 'var(--fg)' }} labelStyle={{ color: 'var(--fg)' }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="scope" name="Total scope" stroke="var(--accent)" fill="url(#scopeFill)" strokeWidth={2} />
                <Area type="monotone" dataKey="completed" name="Completed" stroke="var(--ok)" fill="transparent" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h3>Velocity per week</h3></div>
          <div className="chart">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={data.velocity} margin={{ top: 4, right: 12, left: -30, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="weekStart" tick={{ fontSize: 10, fill: 'var(--fg-muted)' }} tickFormatter={shortDate} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10, fill: 'var(--fg-muted)' }} allowDecimals={false} />
                <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', color: 'var(--fg)' }} cursor={{ fill: 'var(--bg-active)' }} />
                <Bar dataKey="completedTasks" name="Tasks completed" fill="var(--accent)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="panel-head"><h3>Forecast</h3></div>
        {data.forecast.note || !data.forecast.projectedFinish ? (
          <p className="fs-muted">{data.forecast.note || 'No open tasks.'}</p>
        ) : (
          <p style={{ margin: 0 }}>
            Finishing an estimated <strong>{data.forecast.tasksPerWeek} tasks / week</strong>, the project finishes around{' '}
            <strong>{formatDate(data.forecast.projectedFinish)}</strong>.
            {data.forecast.onTime === false && <span className="danger-text"> It would miss the deadline.</span>}
          </p>
        )}
      </section>

      <div className="dash-grid">
        <section className="panel">
          <div className="panel-head"><h3>Workload</h3></div>
          <WorkloadTable rows={data.workload} />
        </section>
        <section className="panel">
          <div className="panel-head"><h3>Deadline risk</h3></div>
          {data.deadlineRisk.length ? <RiskList rows={data.deadlineRisk} /> : <EmptyState title="All deadlines look safe" />}
        </section>
      </div>

      <section className="panel">
        <div className="panel-head"><h3>Team activity (last 7 days)</h3></div>
        {data.teamActivity.members.length === 0 ? (
          <EmptyState title="No recorded activity">People who hid their activity are not listed.</EmptyState>
        ) : (
          <>
            <TeamBarChart members={data.teamActivity.members} />
            {data.teamActivity.others.events > 0 && (
              <p className="fs-muted" style={{ fontSize: 12, marginBottom: 0 }}>
                {data.teamActivity.others.members} member(s) with {data.teamActivity.others.events} events are hidden by their privacy settings.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function Stat({ label, value, tone = '' }) {
  return (
    <div className="stat">
      <span className={`stat-value ${tone}`}>{value}</span>
      <span className="stat-label">{label}</span>
    </div>
  )
}

function WorkloadTable({ rows }) {
  if (!rows.length) return <EmptyState title="Nothing assigned" />
  const max = Math.max(...rows.map((r) => Math.max(r.openTasks, 1)))
  return (
    <table className="fs-table">
      <thead><tr><th>Person</th><th>Open</th><th>Hours</th><th>Done</th><th /></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.assignee?._id || 'unassigned'}>
            <td>{r.assignee?.name || 'Unassigned'}{r.overloaded && <span className="badge danger">overload</span>}</td>
            <td>{r.openTasks}</td>
            <td>{r.openHours}</td>
            <td>{r.completedTasks}</td>
            <td>
              <div className="progress" style={{ width: 90 }}>
                <span style={{ width: `${Math.round((r.openTasks / max) * 100)}%` }} />
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function RiskList({ rows }) {
  return (
    <ul className="risk-list">
      {rows.map((r) => (
        <li key={r._id}>
          <span className="fs-row" style={{ gap: 6 }}>
            <strong>{r.title}</strong>
            <span className={`badge ${r.overdue ? 'danger' : 'warn'}`}>{r.overdue ? 'overdue' : formatDate(r.deadline)}</span>
          </span>
          <ul>{r.reasons.map((reason, i) => <li key={i} className="fs-muted">{reason}</li>)}</ul>
        </li>
      ))}
    </ul>
  )
}

function TeamBarChart({ members }) {
  const data = members.map((m) => ({
    name: m.user.name.split(' ')[0],
    events: m.events,
    Completed: m.completed,
    Collaboration: m.collaboration,
    Planning: m.planning,
  }))
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 4, right: 12, left: -30, bottom: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="name" tick={{ fontSize: 10, fill: 'var(--fg-muted)' }} />
          <YAxis tick={{ fontSize: 10, fill: 'var(--fg-muted)' }} allowDecimals={false} />
          <Tooltip contentStyle={{ background: 'var(--bg-elev)', border: '1px solid var(--border)', color: 'var(--fg)' }} cursor={{ fill: 'var(--bg-active)' }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="Completed" stackId="a" fill="var(--ok)" />
          <Bar dataKey="Collaboration" stackId="a" fill="var(--warn)" />
          <Bar dataKey="Planning" stackId="a" fill="var(--accent)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

const shortDate = (v) => String(v).slice(5)