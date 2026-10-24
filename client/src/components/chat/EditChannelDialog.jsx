import { useState } from 'react'
import { chatApi } from '../../api/endpoints'
import { errorMessage } from '../../api/client'
import { Modal } from '../ui'

// Admin or Manager: rename a channel you made, or change its description (FR26).
export default function EditChannelDialog({ channel, onClose, onSaved }) {
  const [name, setName] = useState(channel.name)
  const [description, setDescription] = useState(channel.description || '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await chatApi.updateChannel(channel._id, { name, description })
      onSaved(res.channel)
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Could not save the channel'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Edit channel" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="fs-label" htmlFor="ech-name">Name</label>
        <input id="ech-name" className="fs-input" value={name} maxLength={40} autoFocus onChange={(e) => setName(e.target.value)} />
        <p className="fs-muted" style={{ margin: '4px 0 10px' }}>Lowercase letters, numbers and dashes.</p>
        <label className="fs-label" htmlFor="ech-desc">Description</label>
        <input id="ech-desc" className="fs-input" value={description} maxLength={200} onChange={(e) => setDescription(e.target.value)} />
        {error && <p className="fs-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="fs-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="fs-btn primary" disabled={busy || !name.trim()}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </form>
    </Modal>
  )
}
