import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { Link, useParams } from 'react-router-dom'
import { aiAssistApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import useProject from '../hooks/useProject'
import { pushToast } from '../store/uiSlice'
import { isManager, canWrite } from '../utils/roles'
import { formatDate, taskRef } from '../utils/format'
import { ConfirmDialog, EmptyState, ErrorState, PriorityBadge, Spinner } from '../components/ui'

const DEFAULTS = { sprintDays: '14', people: '', hoursPerPerson: '30', useAi: true }

// FR24: proposes which Backlog tasks fit the next sprint. The plan comes from rules (priority, deadlines,
// dependencies, capacity); the AI only adds a goal and the risks. "Start sprint" moves the tasks to To Do.
export default function ProjectSprint() {
  const { projectId } = useParams()
  const dispatch = useDispatch()
  const { project, role, error: projectError } = useProject(projectId)
  const [form, setForm] = useState(DEFAULTS)
  const [state, setState] = useState({ status: 'idle', result: null, error: '' })
  const [confirm, setConfirm] = useState(false)
  const [starting, setStarting] = useState(false)
  const [started, setStarted] = useState(null)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  async function plan() {
    setStarted(null)
    setState({ status: 'loading', result: null, error: '' })
    const body = { sprintDays: Number(form.sprintDays), hoursPerPerson: Number(form.hoursPerPerson), useAi: form.useAi }
    if (String(form.people).trim()) body.people = Number(form.people)
    try {
      const res = await aiAssistApi.sprintPlan(projectId, body)
      setState({ status: 'done', result: res, error: '' })
    } catch (e) {
      setState({ status: 'error', result: null, error: errorMessage(e, 'Could not plan the sprint') })
    }
  }

  async function start() {
    setStarting(true)
    try {
      const res = await aiAssistApi.applySprint(projectId, { taskIds: state.result.sprint.tasks.map((t) => t._id) })
      setStarted(res)
      setState({ status: 'idle', result: null, error: '' })
      setConfirm(false)
      dispatch(pushToast(`${res.moved.length} task${res.moved.length === 1 ? '' : 's'} moved to ${res.target}`, 'success'))
    } catch (e) {
      setConfirm(false)
      dispatch(pushToast(errorMessage(e, 'Could not start the sprint'), 'error'))
    } finally {
      setStarting(false)
    }
  }

  if (projectError && !project) return <ErrorState message={projectError} />
  if (!project) return <Spinner label="Loading project…" />

  const { result } = state
  const allowed = canWrite(role) && !project.isArchived
  const sprint = result && result.sprint

  return (
    <div className="page">
      <h1>Sprint planning</h1>
      <p className="fs-muted" style={{ marginTop: 0 }}>
        Picks tasks from the Backlog that fit your team's hours, highest priority first and never before the tasks they depend on.
      </p>
      {!allowed && <p className="readonly-note">{project.isArchived ? 'This project is archived.' : 'Viewers cannot plan sprints.'}</p>}

      <div className="fs-row" style={{ flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}>
        <div>
          <label className="fs-label" htmlFor="sp-days">Sprint length (days)</label>
          <input id="sp-days" className="fs-input" type="number" min="1" max="60" style={{ width: 110 }} value={form.sprintDays} onChange={set('sprintDays')} />
        </div>
        <div>
          <label className="fs-label" htmlFor="sp-people">People</label>
          <input id="sp-people" className="fs-input" type="number" min="1" max="50" placeholder="all members" style={{ width: 130 }} value={form.people} onChange={set('people')} />
        </div>
        <div>
          <label className="fs-label" htmlFor="sp-hours">Hours per person</label>
          <input id="sp-hours" className="fs-input" type="number" min="0.5" max="200" step="0.5" style={{ width: 130 }} value={form.hoursPerPerson} onChange={set('hoursPerPerson')} />
        </div>
        <label className="fs-row fs-muted">
          <input type="checkbox" checked={form.useAi} onChange={set('useAi')} />
          Add an AI-written goal
        </label>
        <button type="button" className="fs-btn primary" disabled={!allowed || state.status === 'loading'} onClick={plan}>
          {state.status === 'loading' ? 'Planning…' : 'Plan sprint'}
        </button>
      </div>

      {state.status === 'loading' && <Spinner label={form.useAi ? 'Planning… the AI goal can take up to a minute.' : 'Planning…'} />}
      {state.status === 'error' && <p className="fs-error" role="alert">{state.error}</p>}
      {state.status === 'idle' && !started && <EmptyState title="No plan yet">Set the sprint length and the team's hours, then click Plan sprint.</EmptyState>}

      {started && (
        <section className="panel-card" aria-label="Sprint started">
          <h3>Sprint started</h3>
          <p style={{ margin: 0 }}>
            {started.moved.length} task{started.moved.length === 1 ? '' : 's'} moved to <strong>{started.target}</strong>.{' '}
            <Link to={`/projects/${projectId}/board`}>Open the board</Link>
          </p>
          {started.skipped.length > 0 && (
            <ul>{started.skipped.map((s) => <li key={s._id} className="fs-muted">{s.title || s._id}: {s.reason}</li>)}</ul>
          )}
        </section>
      )}

      {result && (
        <section aria-label="Sprint plan">
          {result.warnings.map((w) => <p key={w} className="fs-muted" role="status">{w}</p>)}

          <div className="stat-grid">
            {[['Capacity', `${sprint.capacityHours} h`], ['Planned', `${sprint.plannedHours} h`], ['Left over', `${sprint.remainingHours} h`], ['Tasks', sprint.tasks.length], ['Deferred', result.deferred.length]].map(([label, value]) => (
              <div key={label} className="stat"><div className="stat-value">{value}</div><div className="fs-muted">{label}</div></div>
            ))}
          </div>
          <div className="progress" role="progressbar" aria-label="Capacity used" aria-valuenow={Math.round(sprint.utilisation * 100)} aria-valuemin={0} aria-valuemax={100} style={{ margin: '8px 0 16px' }}>
            <span style={{ width: `${sprint.utilisation * 100}%` }} />
          </div>

          {result.ai.used && (
            <div className="panel-card" aria-label="AI summary" style={{ marginBottom: 12 }}>
              <h3>Sprint goal</h3>
              <p style={{ margin: '0 0 6px' }}><strong>{result.ai.goal}</strong></p>
              <p style={{ margin: 0 }}>{result.ai.summary}</p>
              {result.ai.risks.length > 0 && <ul>{result.ai.risks.map((r) => <li key={r}>{r}</li>)}</ul>}
            </div>
          )}
          {!result.ai.used && result.ai.error && (
            <p className="fs-muted" role="status">The AI goal is not available ({result.ai.error}). The plan itself does not depend on it.</p>
          )}

          <h2>Proposed sprint ({sprint.tasks.length})</h2>
          {sprint.tasks.length === 0 ? <p className="fs-muted">Nothing fits. See the deferred tasks below for why.</p> : (
            <table className="fs-table">
              <thead><tr><th>Task</th><th>Priority</th><th>Hours</th><th>Deadline</th><th>After</th></tr></thead>
              <tbody>
                {sprint.tasks.map((t) => (
                  <tr key={t._id}>
                    <td><span className="task-ref">{taskRef(t._id)}</span> {t.title}</td>
                    <td><PriorityBadge priority={t.priority} /></td>
                    <td>{t.estimatedHours}{t.assumedEstimate ? ' (assumed)' : ''}</td>
                    <td>{t.deadline ? formatDate(t.deadline) : '–'}</td>
                    <td>{t.dependsOn.length ? t.dependsOn.join(', ') : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2>Deferred to a later sprint ({result.deferred.length})</h2>
          {result.deferred.length === 0 ? <p className="fs-muted">Nothing was left out.</p> : (
            <table className="fs-table">
              <thead><tr><th>Task</th><th>Priority</th><th>Hours</th><th>Why not now</th></tr></thead>
              <tbody>
                {result.deferred.map((t) => (
                  <tr key={t._id}>
                    <td><span className="task-ref">{taskRef(t._id)}</span> {t.title}</td>
                    <td><PriorityBadge priority={t.priority} /></td>
                    <td>{t.estimatedHours}{t.assumedEstimate ? ' (assumed)' : ''}</td>
                    <td>{t.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="fs-row" style={{ marginTop: 16 }}>
            {isManager(role) ? (
              <button type="button" className="fs-btn primary" disabled={sprint.tasks.length === 0} onClick={() => setConfirm(true)}>
                Start sprint ({sprint.tasks.length} task{sprint.tasks.length === 1 ? '' : 's'})
              </button>
            ) : (
              <span className="fs-muted">Only an Admin or Manager can start the sprint.</span>
            )}
          </div>
        </section>
      )}

      {confirm && (
        <ConfirmDialog
          title="Start this sprint?"
          message={`${sprint.tasks.length} task${sprint.tasks.length === 1 ? '' : 's'} will be moved from Backlog to To Do.`}
          confirmLabel="Start sprint"
          busy={starting}
          onCancel={() => setConfirm(false)}
          onConfirm={start}
        />
      )}
    </div>
  )
}
