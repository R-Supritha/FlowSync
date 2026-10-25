import { useState } from 'react'
import { Avatar } from '../ui'
import { avatarSrc } from '../../utils/avatar'
import { formatDate } from '../../utils/format'

export const MAX_TEXT = 4000
const REACTIONS = ['👍', '❤️', '🎉', '👀']

function chatTime(value) {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString() ? time : `${formatDate(d)}, ${time}`
}

// One message. The text is shown as plain text (React never turns it into HTML).
export default function MessageItem({ message, mine, me, canEdit, canDelete, canReact = false, onEdit, onDelete, onReact }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  function startEdit() {
    setDraft(message.text)
    setEditing(true)
  }

  async function save() {
    const text = draft.trim()
    if (!text || text.length > MAX_TEXT || busy) return
    setBusy(true)
    const ok = await onEdit(message, text)
    setBusy(false)
    if (ok) setEditing(false)
  }

  function onKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      save()
    } else if (e.key === 'Escape') {
      e.stopPropagation()
      setEditing(false)
    }
  }

  return (
    <li className="chat-msg" aria-label={`Message from ${message.author.name}`}>
      <Avatar name={message.author.name} url={avatarSrc(message.author.avatarUrl)} size={30} />
      <div className="chat-msg-body">
        <div className="chat-msg-head">
          <strong>{message.author.name}</strong>
          {message.bot && <span className="badge" title="Posted by FlowSync, not by a person">BOT</span>}
          <span className="fs-muted">{chatTime(message.createdAt)}</span>
          {message.editedAt && !message.deleted && <span className="fs-muted">(edited)</span>}
        </div>

        {message.deleted ? (
          <div className="chat-text fs-muted"><em>This message was deleted</em></div>
        ) : editing ? (
          <div>
            <textarea
              className="fs-textarea"
              aria-label="Edit message"
              value={draft}
              maxLength={MAX_TEXT}
              rows={2}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
            <div className="fs-row" style={{ marginTop: 4 }}>
              <button type="button" className="fs-btn small primary" disabled={busy || !draft.trim()} onClick={save}>Save</button>
              <button type="button" className="fs-btn small ghost" onClick={() => setEditing(false)}>Cancel</button>
              <span className="fs-muted">Enter to save, Esc to cancel</span>
            </div>
          </div>
        ) : (
          <div className="chat-text">{message.text}</div>
        )}

        {!message.deleted && (message.reactions || []).length > 0 && (
          <div className="fs-row" role="group" aria-label="Reactions" style={{ gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
            {message.reactions.map((r) => {
              const active = r.users.includes(me)
              return (
                <button
                  key={r.emoji}
                  type="button"
                  className="fs-btn small ghost"
                  aria-pressed={active}
                  aria-label={`${r.emoji} ${r.users.length}${active ? ', you reacted' : ''}`}
                  disabled={!canReact}
                  style={active ? { outline: '1px solid var(--accent)' } : undefined}
                  onClick={() => onReact(message, r.emoji)}
                >
                  {r.emoji} {r.users.length}
                </button>
              )
            })}
          </div>
        )}

        {!message.deleted && !editing && (canEdit || canDelete || canReact) && (
          <div className="chat-msg-actions">
            {canReact && REACTIONS.map((emoji) => (
              <button key={emoji} type="button" className="fs-btn small ghost" aria-label={`Add reaction ${emoji}`} onClick={() => onReact(message, emoji)}>{emoji}</button>
            ))}
            {mine && canEdit && <button type="button" className="fs-btn small ghost" aria-label="Edit message" onClick={startEdit}>Edit</button>}
            {canDelete && <button type="button" className="fs-btn small ghost" aria-label="Delete message" onClick={() => onDelete(message)}>Delete</button>}
          </div>
        )}
      </div>
    </li>
  )
}
