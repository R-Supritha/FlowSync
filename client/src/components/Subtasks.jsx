import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { taskApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { pushToast } from '../store/uiSlice'
import BreakdownDialog from './BreakdownDialog'

// The subtasks of one task: tick them off, add your own, or let the AI suggest some (FR25).
// Every change is saved straight away with the normal task update.
export default function Subtasks({ task, editable, onTaskChange }) {
  const dispatch = useDispatch()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [ai, setAi] = useState(false)
  const list = task.subtasks || []
  const done = list.filter((s) => s.done).length

  async function save(next, okMessage) {
    setBusy(true)
    try {
      const res = await taskApi.update(task._id, { subtasks: next.map((s) => ({ title: s.title, done: !!s.done })) })
      onTaskChange(res.task)
      if (okMessage) dispatch(pushToast(okMessage, 'success'))
      return true
    } catch (e) {
      dispatch(pushToast(errorMessage(e, 'Could not save the subtasks'), 'error'))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function addOwn(e) {
    e.preventDefault()
    const t = title.trim()
    if (!t) return
    if (await save([...list, { title: t, done: false }])) setTitle('')
  }

  const addSuggested = (titles) =>
    save([...list, ...titles.map((t) => ({ title: t, done: false }))], `${titles.length} subtask${titles.length === 1 ? '' : 's'} added`)

  return (
    <section aria-label="Subtasks" style={{ marginTop: 16 }}>
      <div className="fs-row" style={{ justifyContent: 'space-between' }}>
        <div className="fs-label">Subtasks{list.length ? ` (${done}/${list.length} done)` : ''}</div>
        {editable && !task.isArchived && (
          <button type="button" className="fs-btn small" onClick={() => setAi(true)}>Break into subtasks (AI)</button>
        )}
      </div>

      {list.length === 0 && <p className="fs-muted" style={{ margin: '4px 0' }}>No subtasks yet.</p>}
      {list.length > 0 && (
        <div className="progress" role="progressbar" aria-label="Subtasks done" aria-valuenow={done} aria-valuemin={0} aria-valuemax={list.length}>
          <span style={{ width: `${(done / list.length) * 100}%` }} />
        </div>
      )}
      <ul className="list">
        {list.map((s, i) => (
          <li key={s._id || i} className="list-row">
            <input
              type="checkbox"
              aria-label={`Mark "${s.title}" done`}
              checked={!!s.done}
              disabled={!editable || busy}
              onChange={(e) => save(list.map((x, n) => (n === i ? { ...x, done: e.target.checked } : x)))}
            />
            <span style={{ flex: 1, textDecoration: s.done ? 'line-through' : 'none' }}>{s.title}</span>
            {editable && (
              <button
                type="button"
                className="fs-btn small ghost"
                aria-label={`Remove "${s.title}"`}
                disabled={busy}
                onClick={() => save(list.filter((_, n) => n !== i))}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>

      {editable && (
        <form onSubmit={addOwn} className="fs-row" style={{ marginTop: 6 }}>
          <input className="fs-input" aria-label="New subtask" placeholder="Add a subtask" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          <button type="submit" className="fs-btn small" disabled={busy || !title.trim()}>Add</button>
        </form>
      )}

      {ai && <BreakdownDialog task={task} onClose={() => setAi(false)} onAdd={addSuggested} />}
    </section>
  )
}
