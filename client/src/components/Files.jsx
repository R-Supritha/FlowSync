import { useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { fileApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import useAsync from '../hooks/useAsync'
import useDownload from '../hooks/useDownload'
import { pushToast } from '../store/uiSlice'
import { isManager } from '../utils/roles'
import { formatBytes, relativeTime } from '../utils/format'
import { ConfirmDialog, Spinner } from './ui'

const MAX_BYTES = 20 * 1024 * 1024

// Lists, uploads, downloads and deletes the files of one task or one project.
export default function Files({ scope, id, role, me, canUpload }) {
  const dispatch = useDispatch()
  const download = useDownload()
  const input = useRef(null)
  const { data, error, loading, reload } = useAsync(
    () => (scope === 'task' ? fileApi.listTask(id) : fileApi.listProject(id)),
    [scope, id],
  )
  const [progress, setProgress] = useState(null)
  const [target, setTarget] = useState(null)
  const [busy, setBusy] = useState(false)

  async function onPick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_BYTES) {
      dispatch(pushToast('That file is larger than 20 MB.', 'error'))
      return
    }
    setProgress(0)
    try {
      await fileApi.upload(scope, id, file, setProgress)
      dispatch(pushToast('File uploaded', 'success'))
      reload()
    } catch (err) {
      dispatch(pushToast(errorMessage(err, 'Upload failed'), 'error'))
    } finally {
      setProgress(null)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await fileApi.remove(target._id)
      dispatch(pushToast('File deleted', 'success'))
      setTarget(null)
      reload()
    } catch (err) {
      dispatch(pushToast(errorMessage(err, 'Could not delete the file'), 'error'))
    } finally {
      setBusy(false)
    }
  }

  const files = data?.files || []
  return (
    <section aria-label="Files" style={{ marginTop: 16 }}>
      <div className="fs-label">Files{files.length ? ` (${files.length})` : ''}</div>
      {loading && !data && <Spinner label="Loading files…" />}
      {error && <p className="fs-error" role="alert">{error}</p>}
      {!loading && !error && files.length === 0 && <p className="fs-muted" style={{ margin: '4px 0' }}>No files yet.</p>}
      {files.map((f) => {
        const mine = String(f.uploadedBy?._id || f.uploadedBy) === String(me)
        return (
          <div key={f._id} className="fs-row" style={{ marginBottom: 4 }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.originalName}>
              {f.originalName}
            </span>
            <span className="fs-muted" style={{ fontSize: '0.8em' }}>
              {formatBytes(f.size)} · {f.uploadedBy?.name || 'someone'} · {relativeTime(f.createdAt)}
            </span>
            <button type="button" className="fs-btn small" aria-label={`Download ${f.originalName}`} onClick={() => download(f)}>Download</button>
            {(mine || isManager(role)) && (
              <button type="button" className="fs-btn small danger" aria-label={`Delete ${f.originalName}`} onClick={() => setTarget(f)}>Delete</button>
            )}
          </div>
        )
      })}
      {canUpload ? (
        <div style={{ marginTop: 8 }}>
          <input ref={input} type="file" hidden aria-label="Choose a file to upload" onChange={onPick} />
          <button type="button" className="fs-btn small" disabled={progress !== null} onClick={() => input.current.click()}>
            {progress !== null ? `Uploading… ${progress}%` : 'Upload a file'}
          </button>
          {progress !== null && <div className="progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>}
          <p className="fs-muted" style={{ margin: '4px 0 0', fontSize: '0.8em' }}>PDF, Word, PowerPoint, images or ZIP, up to 20 MB.</p>
        </div>
      ) : (
        <p className="readonly-note">Viewers can download files but not upload them.</p>
      )}
      {target && (
        <ConfirmDialog
          danger
          busy={busy}
          title="Delete file?"
          message={`"${target.originalName}" will be permanently deleted.`}
          confirmLabel="Delete"
          onCancel={() => setTarget(null)}
          onConfirm={remove}
        />
      )}
    </section>
  )
}
