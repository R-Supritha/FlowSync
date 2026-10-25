import { useState } from 'react'
import { aiAssistApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { Modal, Spinner } from './ui'

// FR25: asks the AI for subtasks of one task. Nothing is saved until the person picks some and confirms.
export default function BreakdownDialog({ task, onClose, onAdd }) {
  const [hint, setHint] = useState('')
  const [state, setState] = useState({ status: 'idle', error: '', items: [] })
  const [adding, setAdding] = useState(false)

  async function suggest() {
    setState({ status: 'loading', error: '', items: [] })
    try {
      const res = await aiAssistApi.breakdown(task._id, { hint: hint.trim() })
      setState({ status: 'ready', error: '', items: res.subtasks.map((s) => ({ title: s.title, picked: true })) })
    } catch (e) {
      setState({ status: 'error', error: errorMessage(e, 'The AI could not suggest subtasks'), items: [] })
    }
  }

  const setItem = (i, patch) => setState((s) => ({ ...s, items: s.items.map((it, n) => (n === i ? { ...it, ...patch } : it)) }))
  const chosen = state.items.filter((it) => it.picked && it.title.trim())

  async function add() {
    setAdding(true)
    const ok = await onAdd(chosen.map((it) => it.title.trim()))
    setAdding(false)
    if (ok) onClose()
  }

  return (
    <Modal title="Break into subtasks with AI" onClose={onClose}>
      <p className="fs-muted" style={{ marginTop: 0 }}>
        The AI suggests smaller steps for <strong>{task.title}</strong>. You choose which ones to add.
      </p>

      {state.status !== 'ready' && (
        <>
          <label className="fs-label" htmlFor="bd-hint">Anything the AI should know? (optional)</label>
          <input
            id="bd-hint"
            className="fs-input"
            placeholder="For example: use React and Express, keep it to 5 steps"
            value={hint}
            maxLength={300}
            onChange={(e) => setHint(e.target.value)}
            disabled={state.status === 'loading'}
          />
        </>
      )}

      {state.status === 'loading' && (
        <div style={{ marginTop: 12 }}>
          <Spinner label="Thinking… this can take up to a minute on the free AI service." />
        </div>
      )}
      {state.status === 'error' && <p className="fs-error" role="alert">{state.error}</p>}

      {state.status === 'ready' && (
        <ul className="list" aria-label="Suggested subtasks">
          {state.items.map((it, i) => (
            <li key={i} className="list-row">
              <input type="checkbox" aria-label={`Add subtask ${i + 1}`} checked={it.picked} onChange={(e) => setItem(i, { picked: e.target.checked })} />
              <input className="fs-input" aria-label={`Subtask ${i + 1} title`} value={it.title} maxLength={120} onChange={(e) => setItem(i, { title: e.target.value })} />
            </li>
          ))}
        </ul>
      )}

      <div className="modal-actions">
        <button type="button" className="fs-btn" onClick={onClose}>Cancel</button>
        {state.status === 'ready' ? (
          <>
            <button type="button" className="fs-btn" disabled={adding} onClick={suggest}>Suggest again</button>
            <button type="button" className="fs-btn primary" disabled={adding || chosen.length === 0} onClick={add}>
              {adding ? 'Adding…' : `Add ${chosen.length} subtask${chosen.length === 1 ? '' : 's'}`}
            </button>
          </>
        ) : (
          <button type="button" className="fs-btn primary" disabled={state.status === 'loading'} onClick={suggest}>
            {state.status === 'error' ? 'Try again' : 'Suggest subtasks'}
          </button>
        )}
      </div>
    </Modal>
  )
}
