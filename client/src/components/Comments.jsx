import { useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { commentApi, fileApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import useAsync from '../hooks/useAsync'
import useDownload from '../hooks/useDownload'
import { pushToast } from '../store/uiSlice'
import { isManager } from '../utils/roles'
import { formatBytes, relativeTime } from '../utils/format'
import { ConfirmDialog, Spinner } from './ui'

const EMOJIS = ['👍', '❤️', '🎉', '👀']

const MAX_FILES = 5 // per comment
const MAX_BYTES = 20 * 1024 * 1024
const ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.webp,.zip'

const authorId = (c) => String(c.author?._id || c.author)

// "@Sun" suggestions: the word being typed after the last @
function mentionMatches(text, people) {
  const m = /(?:^|\s)@(\w*)$/.exec(text)
  if (!m) return []
  const q = m[1].toLowerCase()
  return Object.values(people)
    .filter((p) => p.name && p.name.split(/\s+/)[0].toLowerCase().startsWith(q))
    .slice(0, 5)
}

function Composer({ people, placeholder, submitLabel, initial = '', onSubmit, onCancel, attachable = false }) {
  const [text, setText] = useState(initial)
  const [files, setFiles] = useState([])
  const [fileError, setFileError] = useState('')
  const [busy, setBusy] = useState(false)
  const picker = useRef(null)
  const suggestions = mentionMatches(text, people)

  const pick = (p) => setText((t) => t.replace(/@(\w*)$/, `@${p.name.split(/\s+/)[0]} `))

  async function submit(e) {
    e.preventDefault()
    if (!text.trim()) return
    setBusy(true)
    const ok = await onSubmit(text.trim(), files)
    setBusy(false)
    if (ok) {
      setText('')
      setFiles([])
    }
  }

  // Checks the chosen files before anything is sent: at most 5 per comment, each at most 20 MB.
  function pickFiles(e) {
    const chosen = Array.from(e.target.files || [])
    e.target.value = ''
    if (chosen.length === 0) return
    const tooBig = chosen.find((f) => f.size > MAX_BYTES)
    if (tooBig) return setFileError(`"${tooBig.name}" is larger than 20 MB.`)
    if (files.length + chosen.length > MAX_FILES) return setFileError(`A comment can have at most ${MAX_FILES} attachments.`)
    setFileError('')
    setFiles((current) => [...current, ...chosen])
  }

  return (
    <form onSubmit={submit} style={{ marginTop: 6 }}>
      <textarea
        className="fs-textarea"
        style={{ minHeight: 56 }}
        placeholder={placeholder}
        aria-label={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {suggestions.length > 0 && (
        <div className="fs-row" role="listbox" aria-label="Mention suggestions" style={{ flexWrap: 'wrap', marginBottom: 4 }}>
          {suggestions.map((p) => (
            <button key={p.id} type="button" role="option" className="fs-btn small" onClick={() => pick(p)}>
              @{p.name.split(/\s+/)[0]}
            </button>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <ul aria-label="Files to attach" style={{ listStyle: 'none', margin: '0 0 6px', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="fs-row" style={{ gap: 4, border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px' }}>
              <span>{f.name} <span className="fs-muted">({formatBytes(f.size)})</span></span>
              <button type="button" className="fs-btn small ghost" aria-label={`Do not attach ${f.name}`} onClick={() => setFiles((current) => current.filter((_, at) => at !== i))}>×</button>
            </li>
          ))}
        </ul>
      )}
      {fileError && <p className="fs-error" role="alert" style={{ margin: '0 0 6px' }}>{fileError}</p>}
      <div className="fs-row">
        {attachable && (
          <>
            <input ref={picker} type="file" multiple accept={ACCEPT} aria-label="Choose files to attach" hidden onChange={pickFiles} />
            <button type="button" className="fs-btn small" aria-label="Attach files" disabled={busy} onClick={() => picker.current && picker.current.click()}>Attach</button>
          </>
        )}
        <button type="submit" className="fs-btn small primary" disabled={busy || !text.trim()}>{submitLabel}</button>
        {onCancel && <button type="button" className="fs-btn small" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  )
}

function Comment({ comment, replies, depth, ctx }) {
  const { me, role, people, canWrite, act, post } = ctx
  const download = useDownload()
  const [mode, setMode] = useState(null) // 'reply' | 'edit'
  const [confirm, setConfirm] = useState(false)
  const mine = authorId(comment) === String(me)
  const name = comment.author?.name || people[authorId(comment)]?.name || 'Someone'

  return (
    <div style={{ marginLeft: depth ? 18 : 0, marginTop: 10 }}>
      <div className="fs-row" style={{ gap: 8 }}>
        <strong>{name}</strong>
        <span className="fs-muted" style={{ fontSize: '0.8em' }}>
          {relativeTime(comment.createdAt)}{comment.editedAt ? ' · edited' : ''}
        </span>
      </div>

      {mode === 'edit' ? (
        <Composer
          people={people}
          placeholder="Edit comment"
          submitLabel="Save"
          initial={comment.text}
          onCancel={() => setMode(null)}
          onSubmit={async (text) => {
            const ok = await act(() => commentApi.update(comment._id, text), 'Comment updated')
            if (ok) setMode(null)
            return false
          }}
        />
      ) : (
        <p style={{ margin: '2px 0 4px', whiteSpace: 'pre-wrap' }}>{comment.text}</p>
      )}

      {(comment.files || []).length > 0 && (
        <ul aria-label="Attachments" style={{ listStyle: 'none', margin: '2px 0 4px', padding: 0, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {comment.files.map((f) => {
            const mineFile = String(f.uploadedBy?._id || f.uploadedBy) === String(me)
            return (
              <li key={f._id} className="fs-row" style={{ gap: 2 }}>
                <button type="button" className="fs-btn small" aria-label={`Download ${f.originalName}`} onClick={() => download(f)}>
                  {f.originalName} <span className="fs-muted">({formatBytes(f.size)})</span>
                </button>
                {((mineFile && canWrite) || isManager(role)) && (
                  <button type="button" className="fs-btn small ghost" aria-label={`Remove ${f.originalName}`} onClick={() => act(() => fileApi.remove(f._id), 'Attachment removed')}>×</button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="fs-row" style={{ flexWrap: 'wrap', gap: 4 }}>
        {EMOJIS.map((emoji) => {
          const r = (comment.reactions || []).find((x) => x.emoji === emoji)
          const count = r?.users?.length || 0
          const active = !!r?.users?.some((u) => String(u?._id || u) === String(me))
          return (
            <button
              key={emoji}
              type="button"
              className="fs-btn small ghost"
              disabled={!canWrite}
              aria-pressed={active}
              aria-label={`React ${emoji}${count ? `, ${count}` : ''}`}
              style={active ? { outline: '1px solid var(--accent)' } : undefined}
              onClick={() => act(() => commentApi.react(comment._id, emoji))}
            >
              {emoji}{count > 0 ? ` ${count}` : ''}
            </button>
          )
        })}
        {canWrite && depth === 0 && <button type="button" className="fs-btn small ghost" onClick={() => setMode('reply')}>Reply</button>}
        {mine && <button type="button" className="fs-btn small ghost" onClick={() => setMode('edit')}>Edit</button>}
        {(mine || isManager(role)) && <button type="button" className="fs-btn small ghost" onClick={() => setConfirm(true)}>Delete</button>}
      </div>

      {mode === 'reply' && (
        <Composer
          people={people}
          placeholder={`Reply to ${name}`}
          submitLabel="Reply"
          attachable
          onCancel={() => setMode(null)}
          onSubmit={async (text, files) => {
            const ok = await post({ text, parentComment: comment._id }, files)
            if (ok) setMode(null)
            return ok
          }}
        />
      )}
      {replies.map((r) => (
        <Comment key={r._id} comment={r} replies={[]} depth={1} ctx={ctx} />
      ))}

      {confirm && (
        <ConfirmDialog
          danger
          title="Delete comment?"
          message={depth === 0 && replies.length > 0 ? 'This comment and its replies will be deleted.' : 'This comment will be deleted.'}
          confirmLabel="Delete"
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            if (await act(() => commentApi.remove(comment._id), 'Comment deleted')) setConfirm(false)
          }}
        />
      )}
    </div>
  )
}

export default function Comments({ taskId, people, role, me, canWrite }) {
  const dispatch = useDispatch()
  const { data, error, loading, reload } = useAsync(() => commentApi.list(taskId), [taskId])

  // Runs a change, shows the result, and reloads the thread.
  async function act(fn, okMessage) {
    try {
      await fn()
      if (okMessage) dispatch(pushToast(okMessage, 'success'))
      reload()
      return true
    } catch (e) {
      dispatch(pushToast(errorMessage(e), 'error'))
      return false
    }
  }

  // Posts a comment, then attaches each chosen file to it. A file that fails does not undo the comment.
  async function post(body, files = []) {
    try {
      const res = await commentApi.create(taskId, body)
      const failed = []
      for (const file of files) {
        try {
          await fileApi.uploadToComment(res.comment._id, file)
        } catch (e) {
          failed.push(`${file.name} (${errorMessage(e, 'upload failed')})`)
        }
      }
      if (failed.length) dispatch(pushToast(`Comment posted, but these attachments failed: ${failed.join('; ')}`, 'error'))
      else dispatch(pushToast(files.length ? 'Comment posted with attachments' : body.parentComment ? 'Reply posted' : 'Comment posted', 'success'))
      reload()
      return true
    } catch (e) {
      dispatch(pushToast(errorMessage(e), 'error'))
      return false
    }
  }

  const comments = data?.comments || []
  const top = comments.filter((c) => !c.parentComment)
  const repliesOf = (id) => comments.filter((c) => String(c.parentComment) === String(id))
  const ctx = { me, role, people, canWrite, act, post, taskId }

  return (
    <section aria-label="Comments" style={{ marginTop: 16 }}>
      <div className="fs-label">Comments{comments.length ? ` (${comments.length})` : ''}</div>
      {loading && !data && <Spinner label="Loading comments…" />}
      {error && <p className="fs-error" role="alert">{error}</p>}
      {!loading && !error && comments.length === 0 && <p className="fs-muted" style={{ margin: '4px 0' }}>No comments yet.</p>}
      {top.map((c) => (
        <Comment key={c._id} comment={c} replies={repliesOf(c._id)} depth={0} ctx={ctx} />
      ))}
      {canWrite ? (
        <Composer
          people={people}
          placeholder="Add a comment (type @ to mention someone)"
          submitLabel="Comment"
          attachable
          onSubmit={(text, files) => post({ text }, files)}
        />
      ) : (
        <p className="readonly-note">Viewers can read comments but not write them.</p>
      )}
    </section>
  )
}
