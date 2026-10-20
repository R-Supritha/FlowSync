import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { searchApi, taskApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import useAsync from '../hooks/useAsync'
import useDownload from '../hooks/useDownload'
import { pushToast } from '../store/uiSlice'
import { Modal, Spinner } from './ui'

const GROUPS = [['projects', 'Projects'], ['tasks', 'Tasks'], ['comments', 'Comments'], ['files', 'Files'], ['users', 'People']]

export default function SearchPalette({ onClose }) {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const download = useDownload()
  const workspaceId = useSelector((s) => s.workspaces.currentId)
  const [text, setText] = useState('')
  const [term, setTerm] = useState('')
  const [everywhere, setEverywhere] = useState(false)

  useEffect(() => {
    const t = setTimeout(() => setTerm(text.trim()), 300)
    return () => clearTimeout(t)
  }, [text])

  const searching = term.length >= 2
  const { data, error, loading } = useAsync(
    () => (searching ? searchApi.query(term, everywhere ? null : workspaceId) : Promise.resolve(null)),
    [term, everywhere, workspaceId],
  )

  const go = (path) => {
    onClose()
    navigate(path)
  }

  async function openComment(c) {
    try {
      const { task } = await taskApi.get(c.task)
      go(`/projects/${task.project}/board?task=${task._id}`)
    } catch (e) {
      dispatch(pushToast(errorMessage(e), 'error'))
    }
  }

  const results = data?.results
  const total = results ? Object.values(results).reduce((n, list) => n + list.length, 0) : 0

  return (
    <Modal title="Search" onClose={onClose}>
      <input
        className="fs-input"
        placeholder="Search projects, tasks, comments, files and people"
        aria-label="Search text"
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <label className="fs-row fs-muted" style={{ marginTop: 6 }}>
        <input type="checkbox" checked={everywhere} onChange={(e) => setEverywhere(e.target.checked)} />
        Search all my workspaces
      </label>
      <div style={{ maxHeight: 340, overflow: 'auto', marginTop: 8 }}>
        {!searching && <p className="fs-muted">Type at least 2 characters.</p>}
        {searching && loading && <Spinner label="Searching…" />}
        {error && <p className="fs-error" role="alert">{error}</p>}
        {searching && !loading && !error && total === 0 && <p className="fs-muted">Nothing found for “{term}”.</p>}
        {results && GROUPS.map(([key, label]) => results[key]?.length > 0 && (
          <div key={key} role="group" aria-label={label}>
            <div className="fs-label">{label} ({results[key].length})</div>
            {results[key].map((item) => {
              if (key === 'projects') return <button key={item._id} type="button" className="note-item" onClick={() => go(`/projects/${item._id}/board`)}>{item.name}</button>
              if (key === 'tasks') return <button key={item._id} type="button" className="note-item" onClick={() => go(`/projects/${item.project}/board?task=${item._id}`)}>{item.title} <span className="badge">{item.status}</span></button>
              if (key === 'comments') return <button key={item._id} type="button" className="note-item" onClick={() => openComment(item)}>{item.text} <span className="fs-muted">on {item.taskTitle || 'a task'}</span></button>
              if (key === 'files') return <button key={item._id} type="button" className="note-item" onClick={() => download(item)}>{item.originalName} <span className="fs-muted">download</span></button>
              return <button key={item._id} type="button" className="note-item" onClick={() => go(`/users/${item._id}`)}>{item.name} <span className="fs-muted">{item.email}</span></button>
            })}
          </div>
        ))}
      </div>
    </Modal>
  )
}
