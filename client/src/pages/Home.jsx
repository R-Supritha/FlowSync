import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link } from 'react-router-dom'
import { selectCurrentWorkspace, selectMyRole } from '../store/workspacesSlice'
import {
  archiveProject,
  deleteProject,
  fetchProjects,
  unarchiveProject,
  updateProject,
} from '../store/projectsSlice'
import { pushToast } from '../store/uiSlice'
import { isManager } from '../utils/roles'
import { formatDate, toDateInput } from '../utils/format'
import { ConfirmDialog, EmptyState, ErrorState, Modal, Spinner } from '../components/ui'
import { NewProjectModal, WorkspaceForm } from '../components/dialogs'

function EditProjectModal({ project, onClose }) {
  const dispatch = useDispatch()
  const [form, setForm] = useState({
    name: project.name,
    description: project.description || '',
    startDate: toDateInput(project.startDate),
    deadline: toDateInput(project.deadline),
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    if (!form.name.trim()) return setError('Project name is required')
    if (form.startDate && form.deadline && form.deadline < form.startDate) {
      return setError('Deadline cannot be before the start date')
    }
    setBusy(true)
    const res = await dispatch(
      updateProject({
        id: project._id,
        name: form.name.trim(),
        description: form.description,
        startDate: form.startDate || null,
        deadline: form.deadline || null,
      }),
    )
    setBusy(false)
    if (updateProject.fulfilled.match(res)) {
      dispatch(pushToast('Project updated', 'success'))
      onClose()
    } else {
      setError(res.payload)
    }
  }

  return (
    <Modal title="Edit project" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label className="fs-label" htmlFor="ep-name">Name</label>
        <input id="ep-name" className="fs-input" value={form.name} onChange={set('name')} />
        <label className="fs-label" htmlFor="ep-desc">Description</label>
        <textarea id="ep-desc" className="fs-textarea" value={form.description} onChange={set('description')} />
        <div className="fs-row">
          <div style={{ flex: 1 }}>
            <label className="fs-label" htmlFor="ep-start">Start date</label>
            <input id="ep-start" type="date" className="fs-input" value={form.startDate} onChange={set('startDate')} />
          </div>
          <div style={{ flex: 1 }}>
            <label className="fs-label" htmlFor="ep-end">Deadline</label>
            <input id="ep-end" type="date" className="fs-input" value={form.deadline} onChange={set('deadline')} />
          </div>
        </div>
        {error && <p className="fs-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="fs-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="fs-btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  )
}

export default function Home() {
  const dispatch = useDispatch()
  const workspaces = useSelector((s) => s.workspaces.items)
  const workspace = useSelector(selectCurrentWorkspace)
  const role = useSelector(selectMyRole)
  const { active, archived, status, error } = useSelector((s) => s.projects)
  const [showArchived, setShowArchived] = useState(false)
  const [dialog, setDialog] = useState(null) // { type, project? }
  const [busy, setBusy] = useState(false)

  const workspaceId = workspace?._id
  useEffect(() => {
    if (workspaceId && showArchived) dispatch(fetchProjects({ workspaceId, archived: true }))
  }, [workspaceId, showArchived, dispatch])

  if (workspaces.length === 0) {
    return (
      <div className="page" style={{ maxWidth: 460 }}>
        <EmptyState title="Create your first workspace">
          A workspace holds your projects, teams and members.
        </EmptyState>
        <div className="panel-card">
          <WorkspaceForm autoFocus />
        </div>
      </div>
    )
  }

  const list = showArchived ? archived : active
  const manager = isManager(role)

  async function run(thunk, arg, okMessage) {
    setBusy(true)
    const res = await dispatch(thunk(arg))
    setBusy(false)
    if (thunk.fulfilled.match(res)) dispatch(pushToast(okMessage, 'success'))
    else dispatch(pushToast(res.payload, 'error'))
    return thunk.fulfilled.match(res)
  }

  return (
    <div className="page">
      <div className="fs-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <h1>{workspace?.name}</h1>
        <div className="fs-row">
          <label className="fs-row fs-muted">
            <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            Show archived
          </label>
          {manager && (
            <button type="button" className="fs-btn primary" onClick={() => setDialog({ type: 'new' })}>
              + New project
            </button>
          )}
        </div>
      </div>
      {workspace?.description && <p className="fs-muted">{workspace.description}</p>}

      {status === 'loading' && list.length === 0 && <Spinner label="Loading projects…" />}
      {status === 'error' && (
        <ErrorState message={error} onRetry={() => dispatch(fetchProjects({ workspaceId, archived: showArchived }))} />
      )}
      {status !== 'loading' && status !== 'error' && list.length === 0 && (
        <EmptyState title={showArchived ? 'No archived projects' : 'No projects yet'}>
          {manager && !showArchived ? 'Create a project to start planning.' : 'Ask an Admin or Manager to create one.'}
        </EmptyState>
      )}

      <div className="card-grid">
        {list.map((p) => (
          <div key={p._id} className="panel-card">
            <h3>
              {showArchived ? p.name : <Link to={`/projects/${p._id}/board`}>{p.name}</Link>}
            </h3>
            {p.description && <p className="fs-muted" style={{ margin: '0 0 8px' }}>{p.description}</p>}
            <div className="fs-muted" style={{ fontSize: '0.85em' }}>
              {p.deadline ? `Deadline ${formatDate(p.deadline)}` : 'No deadline'} · {p.milestones?.length || 0} milestones
            </div>
            {manager && (
              <div className="fs-row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                <button type="button" className="fs-btn small" onClick={() => setDialog({ type: 'edit', project: p })}>Edit</button>
                {showArchived ? (
                  <button type="button" className="fs-btn small" disabled={busy} onClick={() => run(unarchiveProject, p._id, 'Project restored')}>
                    Restore
                  </button>
                ) : (
                  <button type="button" className="fs-btn small" disabled={busy} onClick={() => run(archiveProject, p._id, 'Project archived')}>
                    Archive
                  </button>
                )}
                <button type="button" className="fs-btn small danger" onClick={() => setDialog({ type: 'delete', project: p })}>Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {dialog?.type === 'new' && <NewProjectModal workspaceId={workspaceId} onClose={() => setDialog(null)} />}
      {dialog?.type === 'edit' && <EditProjectModal project={dialog.project} onClose={() => setDialog(null)} />}
      {dialog?.type === 'delete' && (
        <ConfirmDialog
          danger
          busy={busy}
          title="Delete project?"
          message={`"${dialog.project.name}" and all of its tasks will be permanently deleted. This cannot be undone.`}
          confirmLabel="Delete project"
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            if (await run(deleteProject, dialog.project._id, 'Project deleted')) setDialog(null)
          }}
        />
      )}
    </div>
  )
}
