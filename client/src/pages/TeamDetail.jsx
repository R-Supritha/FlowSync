import { avatarSrc } from '../utils/avatar'
import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate, useParams } from 'react-router-dom'
import { Trash2, Users } from 'lucide-react'
import { teamApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { pushToast } from '../store/uiSlice'
import { selectMyRole, selectCurrentWorkspace } from '../store/workspacesSlice'
import { canManageTeams } from '../utils/roles'
import { Avatar, EmptyState, ErrorState, Field, Modal, Spinner } from '../components/ui'
import { STATUS_COLOR, isOnline, presenceByUser } from '../utils/presence'

export default function TeamDetail() {
  const { teamId } = useParams()
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const workspace = useSelector(selectCurrentWorkspace)
  const role = useSelector(selectMyRole)
  const people = useSelector((s) => s.workspaces.people[workspace?._id] || {})
  const presenceList = useSelector((s) => s.presence.team[workspace?._id] || [])
  const presence = presenceByUser(presenceList)

  const [team, setTeam] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const projects = useSelector((s) => s.projects.active)

  const manager = canManageTeams(role)

  async function load() {
    try {
      setTeam((await teamApi.get(teamId)).team)
      setStatus('ready')
    } catch (e) {
      setError(errorMessage(e, 'Failed to load the team'))
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
  }, [teamId])

  if (status === 'loading') return <Spinner label="Loading team…" />
  if (status === 'error') return <ErrorState message={error} onRetry={load} />

  const memberIds = team.members.map((m) => String(m.user))

  async function run(fn, ok) {
    try {
      await fn()
      dispatch(pushToast(ok, 'success'))
      load()
    } catch (e) {
      dispatch(pushToast(errorMessage(e), 'error'))
    }
  }

  return (
    <div className="page">
      <div className="fs-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <h1 style={{ marginBottom: 0 }}><Users size={20} aria-hidden="true" /> {team.name}</h1>
        <div className="fs-row" style={{ gap: 8 }}>
          {manager && <button type="button" className="fs-btn" onClick={() => setAddOpen(true)}>Add member</button>}
          {manager && <button type="button" className="fs-btn" onClick={() => setAssignOpen(true)}>Assign project</button>}
          {manager && (
            <button
              type="button"
              className="fs-btn danger-outline"
              onClick={async () => {
                if (!window.confirm(`Delete team "${team.name}"?`)) return
                try {
                  await teamApi.remove(teamId)
                  dispatch(pushToast('Team deleted', 'success'))
                  navigate('/teams')
                } catch (e) {
                  dispatch(pushToast(errorMessage(e), 'error'))
                }
              }}
            >
              <Trash2 size={13} aria-hidden="true" /> Delete
            </button>
          )}
        </div>
      </div>
      {team.description && <p className="fs-muted" style={{ marginTop: 4 }}>{team.description}</p>}

      <section className="panel">
        <div className="panel-head"><h3>Members ({team.members.length})</h3></div>
        {team.members.length === 0 && <EmptyState title="No members yet" />}
        <ul className="member-list">
          {team.members.map((m) => {
            const person = people[String(m.user)]
            const live = presence[String(m.user)]
            return (
              <li key={String(m.user)} className="member-list-item">
                <button type="button" className="fs-row" style={{ gap: 8, flex: 1, textAlign: 'left', background: 'none', border: 0, color: 'inherit', cursor: 'pointer' }} onClick={() => navigate(`/profile/${m.user}`)}>
                  <Avatar name={person?.name} url={avatarSrc(person?.avatarUrl)} size={26} presence={isOnline(live) ? STATUS_COLOR[live.status] : undefined} />
                  <span className="ellipsis">{person?.name || 'Member'}</span>
                </button>
                <span className="badge">{m.role}</span>
                {manager && memberIds.indexOf(String(m.user)) !== 0 && (
                  <button type="button" className="fs-btn small ghost danger" aria-label="Remove member" onClick={() => run(() => teamApi.removeMember(teamId, m.user), 'Member removed')}>
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>Assigned projects</h3></div>
        <p className="fs-muted" style={{ fontSize: 12 }}>
          Project assignments live on the project side. Use “Assign project” to attach one to this team.
        </p>
        {projects.length === 0 && <EmptyState title="No projects yet" />}
        <div className="fs-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {projects.map((p) => (
            <span key={p._id} className="unlinked-chip">
              <button type="button" className="fs-row" style={{ gap: 6, background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 0 }} onClick={() => navigate(`/projects/${p._id}/board`)}>
                {p.name}
              </button>
              <span className="badge">{p.template}</span>
            </span>
          ))}
        </div>
      </section>

      {addOpen && <AddMemberModal team={team} people={Object.values(people)} onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); load() }} />}
      {assignOpen && <AssignProjectModal teamId={teamId} projects={projects} onClose={() => setAssignOpen(false)} onDone={() => setAssignOpen(false)} />}
    </div>
  )
}

function AddMemberModal({ team, people, onClose, onAdded }) {
  const dispatch = useDispatch()
  const [userId, setUserId] = useState('')
  const [teamRole, setTeamRole] = useState('Member')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const already = new Set(team.members.map((m) => String(m.user)))
  const candidates = people.filter((p) => !already.has(String(p.id)))

  async function submit(e) {
    e.preventDefault()
    if (!userId) return setError('Choose a member')
    setBusy(true)
    setError('')
    try {
      await teamApi.addMember(team._id, { userId, role: teamRole })
      dispatch(pushToast('Member added', 'success'))
      onAdded()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Add team member"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fs-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="add-member-form" className="fs-btn primary" disabled={busy || !candidates.length}>Add</button>
        </>
      }
    >
      <form id="add-member-form" onSubmit={submit}>
        {candidates.length === 0 ? (
          <p className="fs-muted">Every workspace member is already on this team.</p>
        ) : (
          <>
            <Field label="Member" htmlFor="tm-user">
              <select id="tm-user" className="fs-select" value={userId} onChange={(e) => setUserId(e.target.value)}>
                <option value="">Choose…</option>
                {candidates.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.email})</option>)}
              </select>
            </Field>
            <Field label="Team role" htmlFor="tm-role">
              <select id="tm-role" className="fs-select" value={teamRole} onChange={(e) => setTeamRole(e.target.value)}>
                {['Admin', 'Manager', 'Member', 'Viewer'].map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          </>
        )}
        {error && <p className="fs-error" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}

function AssignProjectModal({ teamId, projects, onClose, onDone }) {
  const dispatch = useDispatch()
  const [projectId, setProjectId] = useState('')
  const [action, setAction] = useState('assign')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!projectId) return setError('Choose a project')
    setBusy(true)
    setError('')
    try {
      if (action === 'assign') await teamApi.assignProject(teamId, projectId)
      else await teamApi.unassignProject(teamId, projectId)
      dispatch(pushToast(action === 'assign' ? 'Team assigned to project' : 'Team unassigned', 'success'))
      onDone()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Update project assignment"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fs-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="assign-form" className="fs-btn primary" disabled={busy || !projects.length}>Save</button>
        </>
      }
    >
      <form id="assign-form" onSubmit={submit}>
        <Field label="Action" htmlFor="tm-action">
          <select id="tm-action" className="fs-select" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="assign">Assign team to project</option>
            <option value="unassign">Unassign team from project</option>
          </select>
        </Field>
        <Field label="Project" htmlFor="tm-project">
          <select id="tm-project" className="fs-select" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Choose…</option>
            {projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
          </select>
        </Field>
        {error && <p className="fs-error" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}