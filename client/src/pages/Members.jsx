import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { changeMemberRole, deleteWorkspace, removeMember, selectCurrentWorkspace, selectMyRole, updateWorkspace } from '../store/workspacesSlice'
import { pushToast } from '../store/uiSlice'
import { isAdmin, isManager, ROLES } from '../utils/roles'
import { ConfirmDialog, EmptyState, Modal } from '../components/ui'
import { InviteModal } from '../components/dialogs'

// FR2 workspace settings: rename the workspace, change roles, delete it. The server checks every rule again.
function WorkspaceSettings({ workspace }) {
  const dispatch = useDispatch()
  const [name, setName] = useState(workspace.name)
  const [description, setDescription] = useState(workspace.description || '')
  const [busy, setBusy] = useState(false)
  const changed = name.trim() !== workspace.name || description.trim() !== (workspace.description || '')

  async function save(e) {
    e.preventDefault()
    setBusy(true)
    const res = await dispatch(updateWorkspace({ workspaceId: workspace._id, name: name.trim(), description: description.trim() }))
    setBusy(false)
    dispatch(updateWorkspace.fulfilled.match(res) ? pushToast('Workspace settings saved', 'success') : pushToast(res.payload, 'error'))
  }

  return (
    <form className="panel-card" onSubmit={save} aria-label="Workspace settings" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Workspace settings</h3>
      <label className="fs-label" htmlFor="ws-name">Name</label>
      <input id="ws-name" className="fs-input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      <label className="fs-label" htmlFor="ws-desc">Description</label>
      <input id="ws-desc" className="fs-input" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
      <div className="fs-row" style={{ marginTop: 10 }}>
        <button type="submit" className="fs-btn primary" disabled={busy || !changed || !name.trim()}>{busy ? 'Saving…' : 'Save settings'}</button>
      </div>
    </form>
  )
}

function DeleteWorkspaceDialog({ workspace, onClose }) {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const res = await dispatch(deleteWorkspace({ workspaceId: workspace._id, confirmName: typed }))
    setBusy(false)
    if (deleteWorkspace.fulfilled.match(res)) {
      dispatch(pushToast(`Workspace "${workspace.name}" was deleted`, 'success'))
      onClose()
      navigate('/')
    } else {
      setError(res.payload)
    }
  }

  return (
    <Modal title="Delete workspace" onClose={onClose}>
      <form onSubmit={submit}>
        <p style={{ marginTop: 0 }}>
          This permanently deletes <strong>{workspace.name}</strong> with all of its projects, tasks, comments, files, teams and chat.
          It cannot be undone.
        </p>
        <label className="fs-label" htmlFor="ws-confirm">Type the workspace name to confirm</label>
        <input id="ws-confirm" className="fs-input" autoFocus autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
        {error && <p className="fs-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="fs-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="fs-btn danger" disabled={busy || typed.trim() !== workspace.name}>{busy ? 'Deleting…' : 'Delete workspace'}</button>
        </div>
      </form>
    </Modal>
  )
}

export default function Members() {
  const dispatch = useDispatch()
  const workspace = useSelector(selectCurrentWorkspace)
  const role = useSelector(selectMyRole)
  const people = useSelector((s) => s.workspaces.people[s.workspaces.currentId]) || {}
  const me = useSelector((s) => s.auth.user?.id)
  const [inviting, setInviting] = useState(false)
  const [target, setTarget] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [roleBusy, setRoleBusy] = useState('')

  if (!workspace) return <EmptyState title="No workspace selected">Create a workspace from the sidebar.</EmptyState>

  async function confirmRemove() {
    setBusy(true)
    const res = await dispatch(removeMember({ workspaceId: workspace._id, userId: target.user }))
    setBusy(false)
    if (removeMember.fulfilled.match(res)) {
      dispatch(pushToast('Member removed', 'success'))
      setTarget(null)
    } else {
      dispatch(pushToast(res.payload, 'error'))
      setTarget(null)
    }
  }

  async function setRole(member, newRole) {
    setRoleBusy(member.user)
    const res = await dispatch(changeMemberRole({ workspaceId: workspace._id, userId: member.user, role: newRole }))
    setRoleBusy('')
    const who = people[member.user]?.name || 'The member'
    dispatch(changeMemberRole.fulfilled.match(res) ? pushToast(`${who} is now ${newRole}`, 'success') : pushToast(res.payload, 'error'))
  }

  return (
    <div className="page">
      <div className="fs-row" style={{ justifyContent: 'space-between' }}>
        <h1>Members of {workspace.name}</h1>
        {isManager(role) && (
          <button type="button" className="fs-btn primary" onClick={() => setInviting(true)}>+ Invite member</button>
        )}
      </div>

      {isManager(role) && <WorkspaceSettings key={`${workspace._id}-${workspace.name}-${workspace.description || ''}`} workspace={workspace} />}

      <table className="fs-table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th>{isAdmin(role) && <th aria-label="Actions" />}</tr>
        </thead>
        <tbody>
          {workspace.members.map((m) => {
            const name = people[m.user]?.name || '—'
            return (
              <tr key={m.user}>
                <td>{name}{String(m.user) === String(me) && <span className="fs-muted"> (you)</span>}</td>
                <td>{people[m.user]?.email || '—'}</td>
                <td>
                  {isAdmin(role) ? (
                    <select
                      className="fs-select"
                      style={{ width: 'auto' }}
                      aria-label={`Role of ${name}`}
                      value={m.role}
                      disabled={roleBusy === m.user}
                      onChange={(e) => setRole(m, e.target.value)}
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : (
                    <span className="badge">{m.role}</span>
                  )}
                </td>
                {isAdmin(role) && (
                  <td>
                    {String(m.user) !== String(me) && (
                      <button type="button" className="fs-btn small danger" onClick={() => setTarget(m)}>Remove</button>
                    )}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>

      {isAdmin(role) && (
        <section className="panel-card" aria-label="Danger zone" style={{ marginTop: 24 }}>
          <h3 style={{ marginTop: 0 }}>Danger zone</h3>
          <p className="fs-muted" style={{ marginTop: 0 }}>Deleting a workspace removes everything in it for everyone.</p>
          <button type="button" className="fs-btn danger" onClick={() => setDeleting(true)}>Delete this workspace</button>
        </section>
      )}

      {inviting && <InviteModal workspaceId={workspace._id} onClose={() => setInviting(false)} />}
      {deleting && <DeleteWorkspaceDialog workspace={workspace} onClose={() => setDeleting(false)} />}
      {target && (
        <ConfirmDialog
          danger
          busy={busy}
          title="Remove member?"
          message={`${people[target.user]?.name || 'This person'} will lose access to ${workspace.name}.`}
          confirmLabel="Remove"
          onCancel={() => setTarget(null)}
          onConfirm={confirmRemove}
        />
      )}
    </div>
  )
}
