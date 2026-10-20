import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { useOutletContext } from 'react-router-dom'
import { teamApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import useAsync from '../hooks/useAsync'
import { pushToast } from '../store/uiSlice'
import { isManager } from '../utils/roles'
import { EmptyState, ErrorState, Spinner } from '../components/ui'

export default function ProjectTeams() {
  const { project, role } = useOutletContext()
  const dispatch = useDispatch()
  const assigned = useAsync(() => teamApi.forProject(project._id), [project._id])
  const all = useAsync(() => teamApi.list(project.workspace), [project.workspace])
  const [pick, setPick] = useState('')
  const manager = isManager(role)

  async function act(fn, ok) {
    try {
      await fn()
      dispatch(pushToast(ok, 'success'))
      setPick('')
      assigned.reload()
    } catch (e) {
      dispatch(pushToast(errorMessage(e), 'error'))
    }
  }

  if (assigned.error) return <ErrorState message={assigned.error} onRetry={assigned.reload} />
  if (!assigned.data || !all.data) return <Spinner label="Loading teams…" />

  const teams = assigned.data.teams
  const taken = new Set(teams.map((t) => String(t._id)))
  const options = all.data.teams.filter((t) => !taken.has(String(t._id)))

  return (
    <div className="page">
      <h1>Teams on this project</h1>
      {teams.length === 0 && <EmptyState title="No teams assigned">{manager ? 'Assign one below.' : 'An Admin or Manager can assign teams.'}</EmptyState>}
      <ul className="list">
        {teams.map((t) => (
          <li key={t._id} className="list-row">
            <strong>{t.name}</strong>
            <span className="fs-muted">{t.members?.length || 0} members</span>
            <span style={{ flex: 1 }} />
            {manager && <button type="button" className="fs-btn small" aria-label={`Unassign ${t.name}`} onClick={() => act(() => teamApi.unassign(t._id, project._id), 'Team unassigned')}>Unassign</button>}
          </li>
        ))}
      </ul>
      {manager && options.length > 0 && (
        <div className="fs-row" style={{ marginTop: 12 }}>
          <select className="fs-select" aria-label="Team to assign" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Assign a team…</option>
            {options.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}
          </select>
          <button type="button" className="fs-btn primary" disabled={!pick} onClick={() => act(() => teamApi.assign(pick, project._id), 'Team assigned')}>Assign</button>
        </div>
      )}
    </div>
  )
}
