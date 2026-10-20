import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { removeMember, selectCurrentWorkspace, selectMyRole } from '../store/workspacesSlice'
import { pushToast } from '../store/uiSlice'
import { isAdmin, isManager } from '../utils/roles'
import { ConfirmDialog, EmptyState } from '../components/ui'
import { InviteModal } from '../components/dialogs'

export default function Members() {
  const dispatch = useDispatch()
  const workspace = useSelector(selectCurrentWorkspace)
  const role = useSelector(selectMyRole)
  const people = useSelector((s) => s.workspaces.people[s.workspaces.currentId]) || {}
  const me = useSelector((s) => s.auth.user?.id)
  const [inviting, setInviting] = useState(false)
  const [target, setTarget] = useState(null)
  const [busy, setBusy] = useState(false)

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
    }
  }

  return (
    <div className="page">
      <div className="fs-row" style={{ justifyContent: 'space-between' }}>
        <h1>Members of {workspace.name}</h1>
        {isManager(role) && (
          <button type="button" className="fs-btn primary" onClick={() => setInviting(true)}>+ Invite member</button>
        )}
      </div>
      <table className="fs-table">
        <thead>
          <tr><th>Name</th><th>Email</th><th>Role</th>{isAdmin(role) && <th aria-label="Actions" />}</tr>
        </thead>
        <tbody>
          {workspace.members.map((m) => (
            <tr key={m.user}>
              <td>{people[m.user]?.name || '—'}{String(m.user) === String(me) && <span className="fs-muted"> (you)</span>}</td>
              <td>{people[m.user]?.email || '—'}</td>
              <td><span className="badge">{m.role}</span></td>
              {isAdmin(role) && (
                <td>
                  {String(m.user) !== String(me) && (
                    <button type="button" className="fs-btn small danger" onClick={() => setTarget(m)}>Remove</button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="fs-muted">Renaming or deleting a workspace and changing a member's role need backend support that doesn't exist yet.</p>

      {inviting && <InviteModal workspaceId={workspace._id} onClose={() => setInviting(false)} />}
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
