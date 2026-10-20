import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { teamApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import useAsync from '../hooks/useAsync'
import { pushToast } from '../store/uiSlice'
import { selectCurrentWorkspace, selectMyRole } from '../store/workspacesSlice'
import { isManager, ROLES } from '../utils/roles'
import { ConfirmDialog, EmptyState, ErrorState, Spinner } from '../components/ui'

const idOf = (m) => String(m.user?._id || m.user)

function TeamCard({ team, people, manager, act }) {
  const [adding, setAdding] = useState({ userId: '', role: 'Member' })
  const [confirm, setConfirm] = useState(false)
  const inTeam = new Set(team.members.map(idOf))
  const candidates = Object.values(people).filter((p) => !inTeam.has(String(p.id)))
  const nameOf = (m) => people[idOf(m)]?.name || m.user?.name || 'Someone'

  return (
    <section className="panel-card" aria-label={`Team ${team.name}`}>
      <div className="fs-row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>{team.name}</h3>
        {manager && <button type="button" className="fs-btn small danger" onClick={() => setConfirm(true)}>Delete team</button>}
      </div>
      {team.description && <p className="fs-muted" style={{ margin: '4px 0 8px' }}>{team.description}</p>}
      <ul className="list">
        {team.members.map((m) => (
          <li key={idOf(m)} className="list-row">
            <span style={{ flex: 1 }}>{nameOf(m)}</span>
            {manager ? (
              <select className="fs-select" style={{ width: 'auto' }} aria-label={`Role of ${nameOf(m)}`} value={m.role}
                onChange={(e) => act(() => teamApi.setRole(team._id, idOf(m), e.target.value), 'Role updated')}>
                {ROLES.map((r) => <option key={r}>{r}</option>)}
              </select>
            ) : <span className="badge">{m.role}</span>}
            {manager && <button type="button" className="fs-btn small" aria-label={`Remove ${nameOf(m)} from ${team.name}`} onClick={() => act(() => teamApi.removeMember(team._id, idOf(m)), 'Member removed')}>Remove</button>}
          </li>
        ))}
        {team.members.length === 0 && <li className="fs-muted">No members yet.</li>}
      </ul>
      {manager && candidates.length > 0 && (
        <div className="fs-row" style={{ marginTop: 8 }}>
          <select className="fs-select" aria-label={`Add a member to ${team.name}`} value={adding.userId} onChange={(e) => setAdding((a) => ({ ...a, userId: e.target.value }))}>
            <option value="">Add a member…</option>
            {candidates.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select className="fs-select" style={{ width: 'auto' }} aria-label="Team role" value={adding.role} onChange={(e) => setAdding((a) => ({ ...a, role: e.target.value }))}>
            {ROLES.map((r) => <option key={r}>{r}</option>)}
          </select>
          <button type="button" className="fs-btn small primary" disabled={!adding.userId}
            onClick={async () => { if (await act(() => teamApi.addMember(team._id, { userId: adding.userId, role: adding.role }), 'Member added')) setAdding({ userId: '', role: 'Member' }) }}>
            Add
          </button>
        </div>
      )}
      {confirm && (
        <ConfirmDialog danger title="Delete team?" message={`“${team.name}” will be deleted and unassigned from its projects.`} confirmLabel="Delete team"
          onCancel={() => setConfirm(false)} onConfirm={async () => { await act(() => teamApi.remove(team._id), 'Team deleted'); setConfirm(false) }} />
      )}
    </section>
  )
}

export default function Teams() {
  const dispatch = useDispatch()
  const workspace = useSelector(selectCurrentWorkspace)
  const role = useSelector(selectMyRole)
  const people = useSelector((s) => s.workspaces.people[s.workspaces.currentId]) || {}
  const { data, error, loading, reload } = useAsync(() => (workspace ? teamApi.list(workspace._id) : Promise.resolve({ teams: [] })), [workspace?._id])
  const [form, setForm] = useState({ name: '', description: '' })
  const [formError, setFormError] = useState('')
  const manager = isManager(role)

  async function act(fn, ok) {
    try {
      await fn()
      if (ok) dispatch(pushToast(ok, 'success'))
      reload()
      return true
    } catch (e) {
      dispatch(pushToast(errorMessage(e), 'error'))
      return false
    }
  }

  async function create(e) {
    e.preventDefault()
    if (!form.name.trim()) return setFormError('Give the team a name')
    setFormError('')
    if (await act(() => teamApi.create(workspace._id, { name: form.name.trim(), description: form.description.trim() }), 'Team created')) setForm({ name: '', description: '' })
  }

  if (!workspace) return <EmptyState title="No workspace selected">Create a workspace from the sidebar.</EmptyState>
  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading && !data) return <Spinner label="Loading teams…" />

  return (
    <div className="page">
      <h1>Teams in {workspace.name}</h1>
      {manager && (
        <form onSubmit={create} noValidate className="panel-card" style={{ maxWidth: 480, marginBottom: 16 }}>
          <h3>Create a team</h3>
          <label className="fs-label" htmlFor="team-name">Name</label>
          <input id="team-name" className="fs-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          <label className="fs-label" htmlFor="team-desc">Description (optional)</label>
          <input id="team-desc" className="fs-input" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          {formError && <p className="fs-error" role="alert">{formError}</p>}
          <button type="submit" className="fs-btn primary" style={{ marginTop: 10 }}>Create team</button>
        </form>
      )}
      {data.teams.length === 0 && <EmptyState title="No teams yet">{manager ? 'Create one above, then assign it to a project.' : 'An Admin or Manager can create teams.'}</EmptyState>}
      <div className="card-grid">
        {data.teams.map((t) => <TeamCard key={t._id} team={t} people={people} manager={manager} act={act} />)}
      </div>
    </div>
  )
}
