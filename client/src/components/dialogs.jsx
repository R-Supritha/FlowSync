import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { Modal } from './ui'
import { createWorkspace, inviteMember, selectRoleIn } from '../store/workspacesSlice'
import { createProject, fetchTemplates } from '../store/projectsSlice'
import { pushToast } from '../store/uiSlice'
import { ROLES } from '../utils/roles'

export function WorkspaceForm({ onDone, autoFocus }) {
  const dispatch = useDispatch()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) return setError('Workspace name is required')
    setBusy(true)
    setError('')
    const res = await dispatch(createWorkspace({ name: name.trim(), description: description.trim() }))
    setBusy(false)
    if (createWorkspace.fulfilled.match(res)) {
      dispatch(pushToast('Workspace created', 'success'))
      onDone?.()
    } else {
      setError(res.payload)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <label className="fs-label" htmlFor="ws-name">Name</label>
      <input id="ws-name" className="fs-input" value={name} autoFocus={autoFocus} onChange={(e) => setName(e.target.value)} />
      <label className="fs-label" htmlFor="ws-desc">Description (optional)</label>
      <textarea id="ws-desc" className="fs-textarea" value={description} onChange={(e) => setDescription(e.target.value)} />
      {error && <p className="fs-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="submit" className="fs-btn primary" disabled={busy}>
          {busy ? 'Creating…' : 'Create workspace'}
        </button>
      </div>
    </form>
  )
}

export function NewWorkspaceModal({ onClose }) {
  return (
    <Modal title="New workspace" onClose={onClose}>
      <WorkspaceForm autoFocus onDone={onClose} />
    </Modal>
  )
}

export function NewProjectModal({ workspaceId, onClose }) {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const templates = useSelector((s) => s.projects.templates)
  const [form, setForm] = useState({ name: '', description: '', template: 'blank', startDate: '', deadline: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!templates.length) dispatch(fetchTemplates())
  }, [dispatch, templates.length])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) return setError('Project name is required')
    if (form.startDate && form.deadline && form.deadline < form.startDate) {
      return setError('Deadline cannot be before the start date')
    }
    setBusy(true)
    setError('')
    const body = { workspaceId, name: form.name.trim(), description: form.description.trim(), template: form.template }
    if (form.startDate) body.startDate = form.startDate
    if (form.deadline) body.deadline = form.deadline
    const res = await dispatch(createProject(body))
    setBusy(false)
    if (createProject.fulfilled.match(res)) {
      dispatch(pushToast('Project created', 'success'))
      onClose()
      navigate(`/projects/${res.payload._id}/board`)
    } else {
      setError(res.payload)
    }
  }

  const chosen = templates.find((t) => (t.id || t.key) === form.template)

  return (
    <Modal title="New project" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label className="fs-label" htmlFor="pr-name">Name</label>
        <input id="pr-name" className="fs-input" autoFocus value={form.name} onChange={set('name')} />
        <label className="fs-label" htmlFor="pr-desc">Description (optional)</label>
        <textarea id="pr-desc" className="fs-textarea" value={form.description} onChange={set('description')} />
        <label className="fs-label" htmlFor="pr-tpl">Template</label>
        <select id="pr-tpl" className="fs-select" value={form.template} onChange={set('template')}>
          {templates.length === 0 && <option value="blank">Blank Project</option>}
          {templates.map((t) => {
            const id = t.id || t.key
            return (
              <option key={id} value={id}>
                {t.name}
              </option>
            )
          })}
        </select>
        {chosen?.description && <p className="fs-muted" style={{ margin: '4px 0 0' }}>{chosen.description}</p>}
        <div className="fs-row" style={{ marginTop: 4 }}>
          <div style={{ flex: 1 }}>
            <label className="fs-label" htmlFor="pr-start">Start date</label>
            <input id="pr-start" type="date" className="fs-input" value={form.startDate} onChange={set('startDate')} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="fs-label" htmlFor="pr-end">Deadline</label>
            <input id="pr-end" type="date" className="fs-input" value={form.deadline} onChange={set('deadline')} />
          </div>
        </div>
        {error && <p className="fs-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="fs-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="fs-btn primary" disabled={busy}>
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

export function InviteModal({ workspaceId, onClose }) {
  const dispatch = useDispatch()
  const myRole = useSelector((s) => selectRoleIn(s, workspaceId))
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('Member')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Enter a valid email address')
    setBusy(true)
    setError('')
    const res = await dispatch(inviteMember({ workspaceId, email: email.trim(), role }))
    setBusy(false)
    if (inviteMember.fulfilled.match(res)) {
      dispatch(pushToast('Member added', 'success'))
      onClose()
    } else {
      setError(res.payload)
    }
  }

  return (
    <Modal title="Invite member" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <p className="fs-muted" style={{ margin: 0 }}>The person must already have a FlowSync account.</p>
        <label className="fs-label" htmlFor="inv-email">Email</label>
        <input id="inv-email" type="email" className="fs-input" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="fs-label" htmlFor="inv-role">Role</label>
        <select id="inv-role" className="fs-select" value={role} onChange={(e) => setRole(e.target.value)}>
          {ROLES.filter((r) => r !== 'Admin' || myRole === 'Admin').map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        {error && <p className="fs-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="fs-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="fs-btn primary" disabled={busy}>
            {busy ? 'Inviting…' : 'Invite'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
