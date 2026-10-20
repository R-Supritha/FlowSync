import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { analyticsApi } from '../../api/endpoints'
import { errorMessage } from '../../api/client'
import { formatDate } from '../../utils/format'
import { EmptyState, ErrorState, Spinner } from '../ui'

const HEALTH_DOT = {
  completed: 'var(--ok)',
  on_track: 'var(--ok)',
  at_risk: 'var(--warn)',
  off_track: 'var(--danger)',
}

const HEALTH_LABEL = {
  completed: 'Completed',
  on_track: 'On track',
  at_risk: 'At risk',
  off_track: 'Off track',
}

// Health summary for the workspace (used on /analytics and the bottom panel).
export default function WorkspaceAnalytics({ compact = false }) {
  const navigate = useNavigate()
  const workspaceId = useSelector((s) => s.workspaces.currentId)
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')

  async function load() {
    if (!workspaceId) return
    try {
      setData(await analyticsApi.workspace(workspaceId))
      setStatus('ready')
    } catch (e) {
      setError(errorMessage(e, 'Failed to load workspace analytics'))
      setStatus('error')
    }
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      await Promise.resolve()
      if (!alive) return
      await load()
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  if (status === 'loading') return <Spinner label="Crunching workspace health…" />
  if (status === 'error') return <ErrorState message={error} onRetry={load} />
  if (!data?.totals.projects) return <EmptyState title="No data yet">Create projects and tasks to see analytics.</EmptyState>

  const t = data.totals

  return (
    <div className={compact ? 'ws-analytics compact' : 'ws-analytics'}>
      <div className="stat-grid">
        <Stat label="Projects" value={t.projects} />
        <Stat label="Tasks" value={t.tasks} />
        <Stat label="Done" value={t.completed} />
        <Stat label="Open" value={t.open} />
        <Stat label="Overdue" value={t.overdue} tone={t.overdue ? 'danger' : ''} />
        <Stat label="At risk" value={t.atRisk} tone={t.atRisk ? 'warn' : ''} />
      </div>

      <div className="panel-head"><h3>Health by project</h3></div>
      <div className="health-row">
        {Object.entries(HEALTH_LABEL).map(([k, label]) => (
          <span key={k} className="health-chip">
            <span className="health-dot" style={{ background: HEALTH_DOT[k] }} />
            {label}: {data.healthCounts[k] || 0}
          </span>
        ))}
      </div>

      <div className="repo-table-wrap">
        <table className="repo-table">
          <thead><tr><th>Project</th><th>Health</th><th>Open</th><th>Done</th><th>Overdue</th><th>Velocity</th><th>Projected finish</th></tr></thead>
          <tbody>
            {data.projects.slice(0, compact ? 6 : 30).map((p) => (
              <tr key={p._id} onClick={() => navigate(`/projects/${p._id}/analytics`)} style={{ cursor: 'pointer' }}>
                <td className="ellipsis">{p.name}</td>
                <td>
                  <span className="fs-row" style={{ gap: 4 }}>
                    <span className="health-dot" style={{ background: HEALTH_DOT[p.health.status] }} />
                    {HEALTH_LABEL[p.health.status]}
                  </span>
                </td>
                <td>{p.totals.open}</td>
                <td>{p.totals.completed}</td>
                <td className={p.totals.overdue ? 'danger-text' : ''}>{p.totals.overdue}</td>
                <td>{p.tasksPerWeek}</td>
                <td>{p.projectedFinish ? formatDate(p.projectedFinish) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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