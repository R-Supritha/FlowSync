import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { useParams } from 'react-router-dom'
import { aiAssistApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import useProject from '../hooks/useProject'
import { pushToast } from '../store/uiSlice'
import { EmptyState, ErrorState, Spinner } from '../components/ui'

const WINDOWS = [
  [24, 'Last 24 hours'],
  [48, 'Last 2 days'],
  [72, 'Last 3 days'],
  [168, 'Last 7 days'],
]

// [key, singular, plural] so "1 task done" and "3 tasks done" both read correctly.
const COUNT_LABELS = [
  ['commits', 'commit', 'commits'], ['prsOpened', 'PR opened', 'PRs opened'], ['prsMerged', 'PR merged', 'PRs merged'],
  ['tasksCompleted', 'task done', 'tasks done'], ['tasksCreated', 'task created', 'tasks created'],
  ['tasksMoved', 'card moved', 'cards moved'], ['comments', 'comment', 'comments'], ['files', 'file', 'files'],
]

function toPlainText(project, windowLabel, report) {
  const lines = [`Stand-up: ${project.name} (${windowLabel.toLowerCase()})`, '', report.summary, '']
  for (const p of report.people) {
    lines.push(`- ${p.name}: ${p.text}`)
    if (p.inProgress.length) lines.push(`    Working on: ${p.inProgress.join('; ')}`)
    if (p.blockers.length) lines.push(`    Blockers: ${p.blockers.join('; ')}`)
  }
  if (report.team.unassignedBlockers.length) lines.push('', `Unassigned problems: ${report.team.unassignedBlockers.join('; ')}`)
  return lines.join('\n')
}

// FR23: a stand-up report built from what really happened in the project (the activity feed and the board).
export default function ProjectStandup() {
  const { projectId } = useParams()
  const dispatch = useDispatch()
  const { project, error: projectError } = useProject(projectId)
  const [windowHours, setWindowHours] = useState(24)
  const [useAi, setUseAi] = useState(true)
  const [state, setState] = useState({ status: 'idle', report: null, error: '' })

  async function generate() {
    setState({ status: 'loading', report: null, error: '' })
    try {
      const res = await aiAssistApi.standup(projectId, { windowHours, useAi })
      setState({ status: 'done', report: res.report, error: '' })
    } catch (e) {
      setState({ status: 'error', report: null, error: errorMessage(e, 'Could not build the report') })
    }
  }

  async function copy() {
    const label = WINDOWS.find(([h]) => h === state.report.windowHours)?.[1] || `Last ${state.report.windowHours} hours`
    try {
      await navigator.clipboard.writeText(toPlainText(project, label, state.report))
      dispatch(pushToast('Report copied', 'success'))
    } catch {
      dispatch(pushToast('Could not copy to the clipboard', 'error'))
    }
  }

  if (projectError && !project) return <ErrorState message={projectError} />
  if (!project) return <Spinner label="Loading project…" />

  const { report } = state
  return (
    <div className="page">
      <h1>Stand-up report</h1>
      <p className="fs-muted" style={{ marginTop: 0 }}>
        Built from the project's activity feed and board, so nobody has to type "what I did yesterday".
      </p>

      <div className="fs-row" style={{ flexWrap: 'wrap', marginBottom: 12 }}>
        <label htmlFor="su-window" className="fs-muted">Period</label>
        <select id="su-window" className="fs-select" style={{ width: 'auto' }} value={windowHours} onChange={(e) => setWindowHours(Number(e.target.value))}>
          {WINDOWS.map(([h, label]) => <option key={h} value={h}>{label}</option>)}
        </select>
        <label className="fs-row fs-muted">
          <input type="checkbox" checked={useAi} onChange={(e) => setUseAi(e.target.checked)} />
          Write it with AI
        </label>
        <button type="button" className="fs-btn primary" disabled={state.status === 'loading'} onClick={generate}>
          {state.status === 'loading' ? 'Generating…' : 'Generate report'}
        </button>
      </div>

      {state.status === 'loading' && <Spinner label={useAi ? 'Writing the report… up to a minute on the free AI service.' : 'Building the report…'} />}
      {state.status === 'error' && <p className="fs-error" role="alert">{state.error}</p>}
      {state.status === 'idle' && <EmptyState title="No report yet">Pick a period and click Generate report.</EmptyState>}

      {report && (
        <section aria-label="Stand-up report">
          <div className="fs-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span className={`badge${report.source === 'ai' ? ' low' : ''}`} title={report.aiError || ''}>
              {report.source === 'ai' ? 'Written by AI' : 'Plain report'}
            </span>
            <button type="button" className="fs-btn small" onClick={copy}>Copy as text</button>
          </div>
          {report.source === 'rules' && report.aiError && (
            <p className="fs-muted" role="status">The AI was not available ({report.aiError}), so this report was built directly from the activity data.</p>
          )}

          <p style={{ fontSize: '1.05em' }}>{report.summary}</p>
          <div className="stat-grid" style={{ marginBottom: 12 }}>
            {[['Events', report.team.events], ['Tasks done', report.team.tasksCompleted], ['Open', report.team.openTasks], ['Overdue', report.team.overdue], ['Blocked', report.team.blocked]].map(([label, value]) => (
              <div key={label} className="stat"><div className="stat-value">{value}</div><div className="fs-muted">{label}</div></div>
            ))}
          </div>

          {report.people.length === 0 && <EmptyState title="Nothing to report">No activity and no work in progress in this period.</EmptyState>}
          <div className="card-grid">
            {report.people.map((p) => (
              <article key={p.userId} className="panel-card" aria-label={p.name}>
                <h3>{p.name}</h3>
                <p style={{ margin: '0 0 8px' }}>{p.text}</p>
                <div className="fs-row" style={{ flexWrap: 'wrap', gap: 4 }}>
                  {COUNT_LABELS.filter(([k]) => p.counts[k] > 0).map(([k, one, many]) => <span key={k} className="badge">{p.counts[k]} {p.counts[k] === 1 ? one : many}</span>)}
                </div>
                {p.inProgress.length > 0 && <p className="fs-muted" style={{ marginBottom: 0 }}><strong>Working on:</strong> {p.inProgress.join('; ')}</p>}
                {p.blockers.length > 0 && <p className="fs-error" style={{ marginBottom: 0 }}><strong>Blockers:</strong> {p.blockers.join('; ')}</p>}
              </article>
            ))}
          </div>
          {report.team.unassignedBlockers.length > 0 && (
            <p className="fs-error"><strong>Unassigned problems:</strong> {report.team.unassignedBlockers.join('; ')}</p>
          )}
        </section>
      )}
    </div>
  )
}
