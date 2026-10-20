import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { useOutletContext } from 'react-router-dom'
import { milestoneApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { pushToast } from '../store/uiSlice'
import { isManager } from '../utils/roles'
import { formatDate, toDateInput } from '../utils/format'
import { ConfirmDialog, EmptyState, Modal } from '../components/ui'

function MilestoneForm({ initial, onSubmit, onClose, title }) {
  const [form, setForm] = useState({ title: initial?.title || '', description: initial?.description || '', targetDate: toDateInput(initial?.targetDate) })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    if (!form.title.trim()) return setError('Give the milestone a title')
    if (!form.targetDate) return setError('Choose a target date')
    setBusy(true)
    const err = await onSubmit({ title: form.title.trim(), description: form.description, targetDate: form.targetDate })
    setBusy(false)
    if (err) setError(err)
    else onClose()
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label className="fs-label" htmlFor="ms-title">Title</label>
        <input id="ms-title" className="fs-input" autoFocus value={form.title} onChange={set('title')} />
        <label className="fs-label" htmlFor="ms-date">Target date</label>
        <input id="ms-date" type="date" className="fs-input" value={form.targetDate} onChange={set('targetDate')} />
        <label className="fs-label" htmlFor="ms-desc">Description (optional)</label>
        <textarea id="ms-desc" className="fs-textarea" value={form.description} onChange={set('description')} />
        {error && <p className="fs-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="fs-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="fs-btn primary" disabled={busy}>Save</button>
        </div>
      </form>
    </Modal>
  )
}

export default function Milestones() {
  const { project, role, reload } = useOutletContext()
  const dispatch = useDispatch()
  const [dialog, setDialog] = useState(null) // { type: 'add' | 'edit' | 'delete', milestone? }
  const manager = isManager(role)
  const list = [...(project.milestones || [])].sort((a, b) => new Date(a.targetDate) - new Date(b.targetDate))
  const done = list.filter((m) => m.completed).length

  async function run(fn, ok) {
    try {
      await fn()
      if (ok) dispatch(pushToast(ok, 'success'))
      reload()
      return ''
    } catch (e) {
      return errorMessage(e)
    }
  }

  return (
    <div className="page">
      <div className="fs-row" style={{ justifyContent: 'space-between' }}>
        <h1>Milestones</h1>
        {manager && <button type="button" className="fs-btn primary" onClick={() => setDialog({ type: 'add' })}>+ Add milestone</button>}
      </div>
      {list.length > 0 && (
        <>
          <div className="fs-muted">{done} of {list.length} complete</div>
          <div className="progress" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={list.length}><span style={{ width: `${(done / list.length) * 100}%` }} /></div>
        </>
      )}
      {list.length === 0 && <EmptyState title="No milestones yet">{manager ? 'Add one to track a goal with a date.' : 'An Admin or Manager can add milestones.'}</EmptyState>}
      <ul className="list" style={{ marginTop: 12 }}>
        {list.map((m) => (
          <li key={m._id} className="list-row">
            <input type="checkbox" aria-label={`Mark ${m.title} complete`} checked={!!m.completed} disabled={!manager}
              onChange={async (e) => {
                const err = await run(() => milestoneApi.update(project._id, m._id, { completed: e.target.checked }))
                if (err) dispatch(pushToast(err, 'error'))
              }} />
            <span style={{ flex: 1, textDecoration: m.completed ? 'line-through' : 'none' }}>
              <strong>{m.title}</strong>{m.description && <span className="fs-muted"> {m.description}</span>}
            </span>
            <span className="badge">{formatDate(m.targetDate)}</span>
            {manager && <button type="button" className="fs-btn small" onClick={() => setDialog({ type: 'edit', milestone: m })}>Edit</button>}
            {manager && <button type="button" className="fs-btn small danger" onClick={() => setDialog({ type: 'delete', milestone: m })}>Delete</button>}
          </li>
        ))}
      </ul>

      {dialog?.type === 'add' && (
        <MilestoneForm title="Add milestone" onClose={() => setDialog(null)} onSubmit={(body) => run(() => milestoneApi.add(project._id, body), 'Milestone added')} />
      )}
      {dialog?.type === 'edit' && (
        <MilestoneForm title="Edit milestone" initial={dialog.milestone} onClose={() => setDialog(null)}
          onSubmit={(body) => run(() => milestoneApi.update(project._id, dialog.milestone._id, body), 'Milestone updated')} />
      )}
      {dialog?.type === 'delete' && (
        <ConfirmDialog danger title="Delete milestone?" message={`“${dialog.milestone.title}” will be deleted.`} confirmLabel="Delete" onCancel={() => setDialog(null)}
          onConfirm={async () => {
            const err = await run(() => milestoneApi.remove(project._id, dialog.milestone._id), 'Milestone deleted')
            if (err) dispatch(pushToast(err, 'error'))
            setDialog(null)
          }} />
      )}
    </div>
  )
}
