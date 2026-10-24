import { useState } from 'react'
import { chatApi } from '../../api/endpoints'
import { errorMessage } from '../../api/client'
import { Modal } from '../ui'

// Admin or Manager: make a channel (FR26).
export default function NewChannelDialog({ workspaceId, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await chatApi.createChannel(workspaceId, { name, description })
      onCreated(res.channel)
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Could not create the channel'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="New channel" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="fs-label" htmlFor="ch-name">Name</label>
        <input id="ch-name" className="fs-input" placeholder="for example: design-team" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
        <p className="fs-muted" style={{ margin: '4px 0 10px' }}>Lowercase letters, numbers and dashes.</p>
        <label className="fs-label" htmlFor="ch-desc">Description (optional)</label>
        <input id="ch-desc" className="fs-input" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
        {error && <p className="fs-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="fs-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="fs-btn primary" disabled={busy || !name.trim()}>{busy ? 'Creating…' : 'Create channel'}</button>
        </div>
      </form>
    </Modal>
  )
}
