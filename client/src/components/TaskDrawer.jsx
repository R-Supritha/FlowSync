import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { projectApi, taskApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { pushToast } from '../store/uiSlice'
import { canModifyTask, canWrite } from '../utils/roles'
import { taskRef, toDateInput } from '../utils/format'
import { fetchPeople, selectRoleIn } from '../store/workspacesSlice'
import { ConfirmDialog, ErrorState, Modal, Spinner } from './ui'
import Comments from './Comments'
import Subtasks from './Subtasks'
import Files from './Files'

const PRIORITIES = ['Low', 'Medium', 'High']
const EMPTY = {}

const toForm = (task) => ({
  title: task.title || '',
  description: task.description || '',
  priority: task.priority || 'Medium',
  labels: (task.labels || []).join(', '),
  deadline: toDateInput(task.deadline),
  estimatedHours: task.estimatedHours ?? 0,
  actualHours: task.actualHours ?? 0,
  assignee: task.assignee?._id || '',
  checklist: (task.checklist || []).map((c) => ({ text: c.text, done: !!c.done })),
})

// When project/role/people are not passed (e.g. opened from global search), the
// drawer resolves them itself from the task's project and workspace.
export default function TaskDrawer({ taskId, project: propProject, role: propRole, people: propPeople, onClose, onChanged }) {
  const dispatch = useDispatch()
  const me = useSelector((s) => s.auth.user?.id)
  const [task, setTask] = useState(null)
  const [blocks, setBlocks] = useState([])
  const [project, setProject] = useState(propProject || null)
  const [form, setForm] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [newItem, setNewItem] = useState('')

  const workspaceId = project?.workspace
  const storeRole = useSelector((s) => (workspaceId ? selectRoleIn(s, workspaceId) : null))
  const role = propRole !== undefined && propRole !== null ? propRole : storeRole
  const storePeople = useSelector((s) => (workspaceId ? s.workspaces.people[workspaceId] : null))
  const people = propPeople || storePeople || EMPTY

  useEffect(() => {
    let alive = true
    taskApi
      .get(taskId)
      .then((res) => {
        if (!alive) return
        setTask(res.task)
        setBlocks(res.blocks || [])
        setForm(toForm(res.task))
        if (!propProject && res.task.project) {
          projectApi
            .get(res.task.project)
            .then((p) => alive && setProject(p.project))
            .catch(() => alive && setLoadError('Could not load the task project'))
        }
      })
      .catch((e) => alive && setLoadError(errorMessage(e, 'Failed to load the task')))
    return () => {
      alive = false
    }
  }, [taskId, propProject])

  useEffect(() => {
    if (workspaceId && !storePeople) dispatch(fetchPeople(workspaceId))
  }, [workspaceId, storePeople, dispatch])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const editable = !!task && canModifyTask(role, task, me)
  const canMove = canWrite(role)

  async function run(fn, okMessage) {
    setBusy(true)
    setError('')
    try {
      const res = await fn()
      if (okMessage) dispatch(pushToast(okMessage, 'success'))
      return res
    } catch (e) {
      setError(errorMessage(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  async function save(e) {
    e.preventDefault()
    if (!form.title.trim()) return setError('Title is required')
    const fields = {
      title: form.title.trim(),
      description: form.description,
      priority: form.priority,
      labels: form.labels.split(',').map((l) => l.trim()).filter(Boolean),
      deadline: form.deadline || null,
      estimatedHours: Number(form.estimatedHours) || 0,
      actualHours: Number(form.actualHours) || 0,
      checklist: form.checklist.filter((c) => c.text.trim()),
    }
    // The assignee goes through the dedicated assign call: only that one notifies the new
    // assignee and writes the "assigned" line in the activity feed.
    const assigneeChanged = (form.assignee || '') !== (task.assignee?._id || '')
    const res = await run(async () => {
      let saved = await taskApi.update(taskId, fields)
      if (assigneeChanged) saved = await taskApi.assign(taskId, form.assignee || null)
      return saved
    }, 'Task saved')
    if (res) {
      setTask(res.task)
      onChanged()
    }
  }

  async function changeStatus(status) {
    const res = await run(() => taskApi.move(taskId, { status }), `Moved to ${status}`)
    if (res) {
      setTask((t) => ({ ...t, status: res.task.status }))
      onChanged()
    }
  }

  async function archive() {
    const res = await run(() => taskApi.archive(taskId), 'Task archived')
    if (res) {
      onChanged()
      onClose()
    }
  }

  async function remove() {
    const res = await run(() => taskApi.remove(taskId), 'Task deleted')
    if (res) {
      onChanged()
      onClose()
    }
  }

  async function copyRef() {
    try {
      await navigator.clipboard.writeText(taskRef(taskId))
      dispatch(pushToast(`Copied ${taskRef(taskId)}`, 'success'))
    } catch {
      dispatch(pushToast('Could not copy to the clipboard', 'error'))
    }
  }

  const toggleItem = (i) =>
    setForm((f) => ({ ...f, checklist: f.checklist.map((c, n) => (n === i ? { ...c, done: !c.done } : c)) }))
  const removeItem = (i) => setForm((f) => ({ ...f, checklist: f.checklist.filter((_, n) => n !== i) }))
  const addItem = () => {
    if (!newItem.trim()) return
    setForm((f) => ({ ...f, checklist: [...f.checklist, { text: newItem.trim(), done: false }] }))
    setNewItem('')
  }

  return (
    <Modal side title="Task details" onClose={onClose}>
      {!task && !loadError && <Spinner label="Loading task…" />}
      {loadError && <ErrorState message={loadError} />}
      {task && !project && !loadError && <Spinner label="Loading project…" />}
      {task && form && project && (
        <form onSubmit={save} noValidate>
          <div className="fs-row" style={{ justifyContent: 'space-between' }}>
            <button type="button" className="fs-btn small" onClick={copyRef} title="Copy the GitHub reference">
              <span className="task-ref">{taskRef(taskId)}</span> ⧉
            </button>
            <button type="button" className="fs-btn small ghost" onClick={onClose} aria-label="Close">✕</button>
          </div>
          {!editable && (
            <p className="readonly-note">
              {role === 'Viewer'
                ? 'Viewers have read-only access.'
                : 'You can move this card, but only its reporter, assignee or a manager can edit it.'}
            </p>
          )}

          <label className="fs-label" htmlFor="td-title">Title</label>
          <input id="td-title" className="fs-input" disabled={!editable} value={form.title} onChange={set('title')} />

          <label className="fs-label" htmlFor="td-status">Status</label>
          <select id="td-status" className="fs-select" disabled={!canMove || busy} value={task.status} onChange={(e) => changeStatus(e.target.value)}>
            {project.columns.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          <label className="fs-label" htmlFor="td-desc">Description</label>
          <textarea id="td-desc" className="fs-textarea" disabled={!editable} value={form.description} onChange={set('description')} />

          <div className="fs-row">
            <div style={{ flex: 1 }}>
              <label className="fs-label" htmlFor="td-pri">Priority</label>
              <select id="td-pri" className="fs-select" disabled={!editable} value={form.priority} onChange={set('priority')}>
                {PRIORITIES.map((p) => <option key={p}>{p}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label className="fs-label" htmlFor="td-due">Deadline</label>
              <input id="td-due" type="date" className="fs-input" disabled={!editable} value={form.deadline} onChange={set('deadline')} />
            </div>
          </div>

          <label className="fs-label" htmlFor="td-assignee">Assignee</label>
          <select id="td-assignee" className="fs-select" disabled={!editable} value={form.assignee} onChange={set('assignee')}>
            <option value="">Unassigned</option>
            {Object.values(people).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <label className="fs-label" htmlFor="td-labels">Labels (comma separated)</label>
          <input id="td-labels" className="fs-input" disabled={!editable} value={form.labels} onChange={set('labels')} list="td-label-options" />
          <datalist id="td-label-options">
            {(project.labels || []).map((l) => <option key={l} value={l} />)}
          </datalist>

          <div className="fs-row">
            <div style={{ flex: 1 }}>
              <label className="fs-label" htmlFor="td-est">Estimated hours</label>
              <input id="td-est" type="number" min="0" step="0.5" className="fs-input" disabled={!editable} value={form.estimatedHours} onChange={set('estimatedHours')} />
            </div>
            <div style={{ flex: 1 }}>
              <label className="fs-label" htmlFor="td-act">Actual hours</label>
              <input id="td-act" type="number" min="0" step="0.5" className="fs-input" disabled={!editable} value={form.actualHours} onChange={set('actualHours')} />
            </div>
          </div>

          <div className="fs-label">Checklist</div>
          {form.checklist.map((c, i) => (
            <div key={i} className="fs-row" style={{ marginBottom: 4 }}>
              <input type="checkbox" aria-label={`Done: ${c.text}`} disabled={!editable} checked={c.done} onChange={() => toggleItem(i)} />
              <span style={{ flex: 1, textDecoration: c.done ? 'line-through' : 'none' }}>{c.text}</span>
              {editable && <button type="button" className="fs-btn small ghost" aria-label={`Remove ${c.text}`} onClick={() => removeItem(i)}>✕</button>}
            </div>
          ))}
          {editable && (
            <div className="fs-row">
              <input
                className="fs-input"
                placeholder="Add a checklist item"
                aria-label="New checklist item"
                value={newItem}
                onChange={(e) => setNewItem(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addItem()
                  }
                }}
              />
              <button type="button" className="fs-btn" onClick={addItem}>Add</button>
            </div>
          )}

          {(task.dependencies?.length > 0 || blocks.length > 0) && (
            <>
              <div className="fs-label">Dependencies</div>
              {task.dependencies?.map((d) => (
                <div key={d._id} className="fs-muted">Blocked by: {d.title} <span className="badge">{d.status}</span></div>
              ))}
              {blocks.map((b) => (
                <div key={b._id} className="fs-muted">Blocks: {b.title} <span className="badge">{b.status}</span></div>
              ))}
            </>
          )}

          {error && <p className="fs-error" role="alert">{error}</p>}
          <div className="modal-actions" style={{ justifyContent: 'space-between' }}>
            <div className="fs-row">
              {editable && <button type="button" className="fs-btn" disabled={busy} onClick={archive}>Archive</button>}
              {editable && <button type="button" className="fs-btn danger" disabled={busy} onClick={() => setConfirmDelete(true)}>Delete</button>}
            </div>
            {editable && <button type="submit" className="fs-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>}
          </div>
        </form>
      )}

      {task && form && (
        <>
          <Subtasks task={task} editable={editable && !task.isArchived} onTaskChange={(t) => { setTask(t); if (onChanged) onChanged() }} />
          <Comments taskId={taskId} people={people} role={role} me={me} canWrite={canWrite(role)} />
          <Files scope="task" id={taskId} role={role} me={me} canUpload={canWrite(role)} />
        </>
      )}

      {confirmDelete && (
        <ConfirmDialog
          danger
          busy={busy}
          title="Delete task?"
          message="This task will be permanently deleted."
          confirmLabel="Delete task"
          onCancel={() => setConfirmDelete(false)}
          onConfirm={remove}
        />
      )}
    </Modal>
  )
}
