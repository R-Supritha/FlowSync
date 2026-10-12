import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { Users } from 'lucide-react'
import { teamApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { pushToast } from '../store/uiSlice'
import { selectMyRole } from '../store/workspacesSlice'
import { canManageTeams } from '../utils/roles'
import { EmptyState, ErrorState, Field, Modal, Spinner } from '../components/ui'

export default function TeamsPage() {
  const navigate = useNavigate()
  const workspaceId = useSelector((s) => s.workspaces.currentId)
  const role = useSelector(selectMyRole)
  const [teams, setTeams] = useState([])
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [showNew, setShowNew] = useState(false)

  async function load() {
    if (!workspaceId) return
    try {
      setTeams((await teamApi.list(workspaceId)).teams)
      setStatus('ready')
    } catch (e) {
      setError(errorMessage(e, 'Failed to load teams'))
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

  if (status === 'loading') return <Spinner label="Loading teams…" />
  if (status === 'error') return <ErrorState message={error} onRetry={load} />

  return (
    <div className="page">
      <div className="fs-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <h1 style={{ marginBottom: 0 }}><Users size={20} aria-hidden="true" /> Teams</h1>
        {canManageTeams(role) && (
          <button type="button" className="fs-btn primary" onClick={() => setShowNew(true)}>New team</button>
        )}
      </div>

      {teams.length === 0 && <EmptyState title="No teams yet">Teams group workspace members around a project or initiative.</EmptyState>}

      <div className="project-grid">
        {teams.map((t) => (
          <button key={t._id} type="button" className="project-card" onClick={() => navigate(`/teams/${t._id}`)}>
            <strong className="ellipsis">{t.name}</strong>
            <p className="fs-muted ellipsis">{t.description || 'No description'}</p>
            <div className="fs-muted" style={{ fontSize: 12 }}>
              {t.members.length} member{t.members.length === 1 ? '' : 's'}
            </div>
          </button>
        ))}
      </div>

      {showNew && <NewTeamModal workspaceId={workspaceId} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load() }} />}
    </div>
  )
}

function NewTeamModal({ workspaceId, onClose, onCreated }) {
  const dispatch = useDispatch()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) return setError('Team name is required')
    setBusy(true)
    setError('')
    try {
      await teamApi.create(workspaceId, { name: name.trim(), description: description.trim() })
      dispatch(pushToast('Team created', 'success'))
      onCreated()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New team"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fs-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="team-form" className="fs-btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create team'}</button>
        </>
      }
    >
      <form id="team-form" onSubmit={submit}>
        <Field label="Name" htmlFor="team-name"><input id="team-name" className="fs-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Description (optional)" htmlFor="team-desc"><textarea id="team-desc" className="fs-textarea" value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        {error && <p className="fs-error" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}