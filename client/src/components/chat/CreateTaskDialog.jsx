import { useState } from 'react'
import { chatApi, taskApi } from '../../api/endpoints'
import { errorMessage } from '../../api/client'
import { taskRef } from '../../utils/format'
import { Modal } from '../ui'

const MAX_TITLE = 120

// FR29: "Turn this message into a task" (project channels). The task is made in the channel's project; optionally a
// message with its FS-xxxxxx reference is posted, which shows up as a task chip for everybody.
export default function CreateTaskDialog({ message, channel, onClose, onCreated }) {
  const firstLine = String(message.text || '').split('\n')[0].trim().slice(0, MAX_TITLE)
  const [title, setTitle] = useState(firstLine)
  const [description, setDescription] = useState(String(message.text || '').slice(0, 2000))
  const [post, setPost] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!title.trim()) return setError('The task needs a title')
    setBusy(true)
    setError('')
    try {
      const res = await taskApi.create(channel.project, { title: title.trim(), description: description.trim() })
      let sent = null
      if (post) {
        try {
          sent = (await chatApi.send(channel._id, `📌 Task ${taskRef(res.task._id).toUpperCase()} created from a message`)).message
        } catch {
          sent = null // the task exists; only the chat note failed
        }
      }
      onCreated(res.task, sent)
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Could not create the task'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Create task from message" onClose={onClose}>
      <form onSubmit={submit}>
        <label className="fs-label" htmlFor="ctm-title">Title</label>
        <input id="ctm-title" className="fs-input" value={title} maxLength={MAX_TITLE} autoFocus onChange={(e) => setTitle(e.target.value)} />
        <label className="fs-label" htmlFor="ctm-desc">Description</label>
        <textarea id="ctm-desc" className="fs-textarea" rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
        <label className="fs-row" style={{ gap: 6, marginTop: 8 }}>
          <input type="checkbox" checked={post} onChange={(e) => setPost(e.target.checked)} /> Post the task link in this channel
        </label>
        {error && <p className="fs-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="fs-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="fs-btn primary" disabled={busy || !title.trim()}>{busy ? 'Creating…' : 'Create task'}</button>
        </div>
      </form>
    </Modal>
  )
}
