import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { useParams } from 'react-router-dom'
import { Milestone, Plus, Trash2 } from 'lucide-react'
import { projectApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { fetchProject } from '../store/projectsSlice'
import { pushToast } from '../store/uiSlice'
import useProject from '../hooks/useProject'
import { canManageMilestones } from '../utils/roles'
import { formatDate, toDateInput, isOverdue } from '../utils/format'
import { ConfirmDialog, EmptyState, ErrorState, Field, Modal, Spinner } from '../components/ui'

export default function ProjectMilestones() {
  const { projectId } = useParams()
  const dispatch = useDispatch()
  const { project, role, error } = useProject(projectId)
  const [dialog, setDialog] = useState(null) // { mode: 'add' } | { mode: 'edit', milestone }
  const [deleteTarget, setDeleteTarget] = useState(null)
  const manager = canManageMilestones(role)

  if (error && !project) return <ErrorState message={error} onRetry={() => dispatch(fetchProject(projectId))} />
  if (!project) return <Spinner label="Loading project…" />

  const milestones = project.milestones || []
  const upcoming = milestones.filter((m) => !m.completed)
  const completed = milestones.filter((m) => m.completed)

  async function toggle(milestone) {
    try {
      await projectApi.updateMilestone(projectId, milestone._id, { completed: !milestone.completed })
      dispatch(fetchProject(projectId))
      dispatch(pushToast(milestone.completed ? 'Milestone reopened' : 'Milestone completed', 'success'))
    } catch (e) {
      dispatch(pushToast(errorMessage(e), 'error'))
    }
  }

  async function del() {
    if (!deleteTarget) return
    try {
      await projectApi.deleteMilestone(projectId, deleteTarget._id)
      dispatch(fetchProject(projectId))
      dispatch(pushToast('Milestone deleted', 'success'))
    } catch (e) {
      dispatch(pushToast(errorMessage(e), 'error'))
    } finally {
      setDeleteTarget(null)
    }
  }

  return (
    <div className="page">
      <div className="fs-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <h1 style={{ marginBottom: 0 }}>Milestones</h1>
        {manager && (
          <button type="button" className="fs-btn primary" onClick={() => setDialog({ mode: 'add' })}>
            <Plus size={14} aria-hidden="true" /> New milestone
          </button>
        )}
      </div>

      {milestones.length === 0 && (
        <EmptyState title="No milestones yet">
          Milestones break a project into dated targets. Tasks can be linked to one.
        </EmptyState>
      )}

      <div className="milestone-list">
        {upcoming.map((m) => (
          <MilestoneRow key={m._id} milestone={m} open={!manager} onToggle={() => toggle(m)} onEdit={() => setDialog({ mode: 'edit', milestone: m })} onDelete={() => setDeleteTarget(m)} manager={manager} />
        ))}
        {completed.map((m) => (
          <MilestoneRow key={m._id} milestone={m} open={!manager} onToggle={() => toggle(m)} onEdit={() => setDialog({ mode: 'edit', milestone: m })} onDelete={() => setDeleteTarget(m)} manager={manager} done />
        ))}
      </div>

      {dialog && (
        <MilestoneModal
          projectId={projectId}
          milestone={dialog.milestone}
          onClose={() => setDialog(null)}
          onSaved={() => { dispatch(fetchProject(projectId)); setDialog(null) }}
        />
      )}
      {deleteTarget && (
        <ConfirmDialog
          danger
          title="Delete milestone?"
          message={`"${deleteTarget.title}" will be removed. Linked tasks stay but lose their milestone.`}
          confirmLabel="Delete milestone"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={del}
        />
      )}
    </div>
  )
}

function MilestoneRow({ milestone, manager, done, onToggle, onEdit, onDelete, open }) {
  const overdue = !milestone.completed && isOverdue(milestone.targetDate, '')
  return (
    <div className={`milestone-row${done ? ' done' : ''}`}>
      <button type="button" className="milestone-toggle" title={milestone.completed ? 'Reopen' : 'Mark complete'} onClick={onToggle}>
        <Milestone size={16} aria-hidden="true" />
      </button>
      <div className="ellipsis" onClick={open || !manager ? undefined : onEdit} style={{ flex: 1, cursor: manager ? 'pointer' : 'default' }}>
        <strong>{milestone.title}</strong>
        {milestone.description && <span className="fs-muted block-ellipsis">{milestone.description}</span>}
      </div>
      <span className={`badge ${overdue ? 'danger' : done ? 'ok' : ''}`}>
        {done ? 'completed' : overdue ? 'overdue' : formatDate(milestone.targetDate)}
      </span>
      {manager && (
        <div className="fs-row" style={{ gap: 2 }}>
          <button type="button" className="fs-btn small ghost" onClick={onEdit}>Edit</button>
          <button type="button" className="fs-btn small ghost danger" aria-label="Delete milestone" onClick={onDelete}><Trash2 size={13} aria-hidden="true" /></button>
        </div>
      )}
    </div>
  )
}

function MilestoneModal({ projectId, milestone, onClose, onSaved }) {
  const dispatch = useDispatch()
  const [form, setForm] = useState({
    title: milestone?.title || '',
    description: milestone?.description || '',
    targetDate: toDateInput(milestone?.targetDate) || '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!form.title.trim()) return setError('Title is required')
    if (!form.targetDate) return setError('A target date is required')
    setBusy(true)
    setError('')
    try {
      if (milestone) await projectApi.updateMilestone(projectId, milestone._id, { ...form, title: form.title.trim() })
      else await projectApi.addMilestone(projectId, { ...form, title: form.title.trim() })
      dispatch(pushToast(milestone ? 'Milestone updated' : 'Milestone created', 'success'))
      onSaved()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={milestone ? 'Edit milestone' : 'New milestone'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fs-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="milestone-form" className="fs-btn primary" disabled={busy}>Save</button>
        </>
      }
    >
      <form id="milestone-form" onSubmit={submit}>
        <Field label="Title" htmlFor="ms-title"><input id="ms-title" className="fs-input" autoFocus value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></Field>
        <Field label="Description (optional)" htmlFor="ms-desc"><textarea id="ms-desc" className="fs-textarea" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></Field>
        <Field label="Target date" htmlFor="ms-date"><input id="ms-date" type="date" className="fs-input" value={form.targetDate} onChange={(e) => setForm((f) => ({ ...f, targetDate: e.target.value }))} /></Field>
        {error && <p className="fs-error" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}