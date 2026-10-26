import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useParams } from 'react-router-dom'
import { fetchProject } from '../store/projectsSlice'
import { createTask, fetchBoard, moveTask, resetBoard, saveColumns } from '../store/boardSlice'
import { activityApi } from '../api/endpoints'
import { selectRoleIn, setCurrentWorkspace } from '../store/workspacesSlice'
import { pushToast } from '../store/uiSlice'
import { canWrite, isManager } from '../utils/roles'
import { formatDate, initials, isOverdue, taskRef } from '../utils/format'
import { EmptyState, ErrorState, Modal, Spinner } from '../components/ui'
import TaskDrawer from '../components/TaskDrawer'

const EMPTY = {}
const PAGE_SIZE = 20

function TaskCard({ task, draggable, onOpen, onDragStart, onDragEnd, onDrop, dragging }) {
  const done = task.checklist?.filter((c) => c.done).length || 0
  const total = task.checklist?.length || 0
  return (
    <div
      className={`task-card${dragging ? ' dragging' : ''}`}
      role="button"
      tabIndex={0}
      draggable={draggable}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => draggable && e.preventDefault()}
      onDrop={onDrop}
    >
      <p className="title">{task.title}</p>
      <div className="meta">
        <span className="task-ref">{taskRef(task._id)}</span>
        <span className={`badge ${String(task.priority).toLowerCase()}`}>{task.priority}</span>
        {task.deadline && (
          <span className={`badge${isOverdue(task.deadline, task.status) ? ' overdue' : ''}`}>
            {formatDate(task.deadline)}
          </span>
        )}
        {task.labels?.map((l) => <span key={l} className="badge">{l}</span>)}
        {task.assignee && (
          <span className="avatar" title={task.assignee.name}>{initials(task.assignee.name)}</span>
        )}
      </div>
      {total > 0 && (
        <>
          <div className="fs-muted" style={{ fontSize: '0.75em', marginTop: 4 }}>{done}/{total} done</div>
          <div className="progress"><span style={{ width: `${(done / total) * 100}%` }} /></div>
        </>
      )}
    </div>
  )
}

function NewTaskModal({ project, people, defaultStatus, filters, onClose }) {
  const dispatch = useDispatch()
  const [form, setForm] = useState({
    title: '', description: '', priority: 'Medium', status: defaultStatus || project.columns[0],
    assignee: '', deadline: '', labels: '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    if (!form.title.trim()) return setError('Title is required')
    setBusy(true)
    const body = {
      projectId: project._id,
      filters,
      title: form.title.trim(),
      description: form.description,
      priority: form.priority,
      status: form.status,
      labels: form.labels.split(',').map((l) => l.trim()).filter(Boolean),
    }
    if (form.assignee) body.assignee = form.assignee
    if (form.deadline) body.deadline = form.deadline
    const res = await dispatch(createTask(body))
    setBusy(false)
    if (createTask.fulfilled.match(res)) {
      dispatch(pushToast('Task created', 'success'))
      onClose()
    } else {
      setError(res.payload)
    }
  }

  return (
    <Modal title="New task" onClose={onClose}>
      <form onSubmit={submit} noValidate>
        <label className="fs-label" htmlFor="nt-title">Title</label>
        <input id="nt-title" className="fs-input" autoFocus value={form.title} onChange={set('title')} />
        <label className="fs-label" htmlFor="nt-desc">Description</label>
        <textarea id="nt-desc" className="fs-textarea" value={form.description} onChange={set('description')} />
        <div className="fs-row">
          <div style={{ flex: 1 }}>
            <label className="fs-label" htmlFor="nt-pri">Priority</label>
            <select id="nt-pri" className="fs-select" value={form.priority} onChange={set('priority')}>
              {['Low', 'Medium', 'High'].map((p) => <option key={p}>{p}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label className="fs-label" htmlFor="nt-status">Column</label>
            <select id="nt-status" className="fs-select" value={form.status} onChange={set('status')}>
              {project.columns.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
        </div>
        <div className="fs-row">
          <div style={{ flex: 1 }}>
            <label className="fs-label" htmlFor="nt-assignee">Assignee</label>
            <select id="nt-assignee" className="fs-select" value={form.assignee} onChange={set('assignee')}>
              <option value="">Unassigned</option>
              {Object.values(people).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label className="fs-label" htmlFor="nt-due">Deadline</label>
            <input id="nt-due" type="date" className="fs-input" value={form.deadline} onChange={set('deadline')} />
          </div>
        </div>
        <label className="fs-label" htmlFor="nt-labels">Labels (comma separated)</label>
        <input id="nt-labels" className="fs-input" list="nt-label-options" value={form.labels} onChange={set('labels')} />
        <datalist id="nt-label-options">
          {(project.labels || []).map((l) => <option key={l} value={l} />)}
        </datalist>
        {error && <p className="fs-error" role="alert">{error}</p>}
        <div className="modal-actions">
          <button type="button" className="fs-btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="fs-btn primary" disabled={busy}>{busy ? 'Creating…' : 'Create task'}</button>
        </div>
      </form>
    </Modal>
  )
}

function ColumnsModal({ project, filters, onClose }) {
  const dispatch = useDispatch()
  const [columns, setColumns] = useState(project.columns)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const rename = (i, value) => setColumns((c) => c.map((x, n) => (n === i ? value : x)))
  const remove = (i) => setColumns((c) => c.filter((_, n) => n !== i))
  const move = (i, delta) =>
    setColumns((c) => {
      const next = [...c]
      const j = i + delta
      if (j < 0 || j >= next.length) return c
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  async function save() {
    const trimmed = columns.map((c) => c.trim())
    if (trimmed.some((c) => !c)) return setError('Column names cannot be empty')
    if (new Set(trimmed).size !== trimmed.length) return setError('Column names must be unique')
    setBusy(true)
    const res = await dispatch(saveColumns({ projectId: project._id, columns: trimmed, filters }))
    setBusy(false)
    if (saveColumns.fulfilled.match(res)) {
      dispatch(fetchProject(project._id))
      dispatch(pushToast('Columns updated', 'success'))
      onClose()
    } else {
      setError(res.payload)
    }
  }

  return (
    <Modal title="Manage columns" onClose={onClose}>
      <p className="fs-muted" style={{ marginTop: 0 }}>
        A column that still has tasks can be reordered but not renamed or removed — move its tasks first.
      </p>
      {columns.map((c, i) => (
        <div key={i} className="fs-row" style={{ marginBottom: 6 }}>
          <input className="fs-input" aria-label={`Column ${i + 1} name`} value={c} onChange={(e) => rename(i, e.target.value)} />
          <button type="button" className="fs-btn small" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
          <button type="button" className="fs-btn small" aria-label="Move down" disabled={i === columns.length - 1} onClick={() => move(i, 1)}>↓</button>
          <button type="button" className="fs-btn small danger" aria-label={`Remove ${c}`} disabled={columns.length === 1} onClick={() => remove(i)}>✕</button>
        </div>
      ))}
      <button type="button" className="fs-btn small" onClick={() => setColumns((c) => [...c, ''])}>+ Add column</button>
      {error && <p className="fs-error" role="alert">{error}</p>}
      <div className="modal-actions">
        <button type="button" className="fs-btn" onClick={onClose}>Cancel</button>
        <button type="button" className="fs-btn primary" disabled={busy} onClick={save}>Save columns</button>
      </div>
    </Modal>
  )
}

export default function Board() {
  const { projectId } = useParams()
  const dispatch = useDispatch()
  const project = useSelector((s) => (s.projects.current?._id === projectId ? s.projects.current : null))
  const projectError = useSelector((s) => s.projects.error)
  const board = useSelector((s) => s.board)
  const token = useSelector((s) => s.auth.token)
  const workspaceId = project?.workspace
  const role = useSelector((s) => (workspaceId ? selectRoleIn(s, workspaceId) : null))
  const people = useSelector((s) => (workspaceId ? s.workspaces.people[workspaceId] : null)) || EMPTY
  const currentWorkspaceId = useSelector((s) => s.workspaces.currentId)

  const [filters, setFilters] = useState({ priority: '', label: '', assignee: '' })
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [view, setView] = useState('board')
  const [page, setPage] = useState(1)
  const [openTaskId, setOpenTaskId] = useState(null)
  const [dialog, setDialog] = useState(null) // { type: 'task' | 'columns', status? }
  const [drag, setDrag] = useState(null)
  const [overColumn, setOverColumn] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const activeFilters = useMemo(
    () => ({ ...filters, search: debouncedSearch }),
    [filters, debouncedSearch],
  )
  const filtered = Object.values(activeFilters).some(Boolean)

  useEffect(() => {
    dispatch(fetchProject(projectId))
    return () => {
      dispatch(resetBoard())
    }
  }, [projectId, dispatch])

  useEffect(() => {
    if (workspaceId && workspaceId !== currentWorkspaceId) dispatch(setCurrentWorkspace(workspaceId))
  }, [workspaceId, currentWorkspaceId, dispatch])

  useEffect(() => {
    if (project) dispatch(fetchBoard({ projectId, filters: activeFilters }))
  }, [project, projectId, activeFilters, dispatch])

  // A GitHub webhook can move a card while this board is open. Listen to the existing project
  // activity stream (the JWT stays in the Authorization header) and reload only when a status
  // change was made by the automation, so manual edits are never interrupted.
  useEffect(() => {
    if (!projectId || !token) return undefined
    const controller = new AbortController()
    let timer = null
    let cancelled = false

    const refreshFromGithub = (activity) => {
      if (!activity || !activity.meta || activity.meta.auto !== true) return
      if (!['task_status_changed', 'task_completed'].includes(activity.type)) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        if (cancelled) return
        dispatch(fetchBoard({ projectId, filters: activeFilters }))
        const from = activity.meta.from
        const to = activity.meta.to
        const title = activity.taskTitle || 'A task'
        dispatch(pushToast(
          from && to ? `${title} moved from ${from} to ${to} on GitHub` : `${title} was updated on GitHub`,
          'success',
        ))
      }, 250)
    }

    ;(async () => {
      let res
      try {
        res = await fetch(activityApi.streamUrl(projectId), {
          headers: { Authorization: `Bearer ${token}` },
          signal: controller.signal,
        })
        if (!res.ok || !res.body) return
      } catch {
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const chunks = buffer.split('\n\n')
          buffer = chunks.pop() || ''
          for (const chunk of chunks) {
            const line = chunk.split('\n').find((l) => l.startsWith('data: '))
            if (!line) continue
            try {
              refreshFromGithub(JSON.parse(line.slice(6)))
            } catch {
              /* ignore malformed frames */
            }
          }
        }
      } catch {
        /* connection closed */
      }
    })()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      controller.abort()
    }
  }, [projectId, token, activeFilters, dispatch])

  const refresh = useCallback(
    () => dispatch(fetchBoard({ projectId, filters: activeFilters })),
    [dispatch, projectId, activeFilters],
  )

  if (projectError && !project) return <ErrorState message={projectError} onRetry={() => dispatch(fetchProject(projectId))} />
  if (!project) return <Spinner label="Loading project…" />

  const writer = canWrite(role)
  const manager = isManager(role)
  // Reordering sends the full column order, so it only works on an unfiltered board.
  const canDrag = writer && !filtered && !project.isArchived

  function dropOn(column, index) {
    if (!drag) return
    const { taskId, from } = drag
    const position = board.tasksByColumn[from]?.findIndex((t) => t._id === taskId)
    setDrag(null)
    setOverColumn(null)
    if (from === column && (index === position || index === position + 1)) return
    dispatch(moveTask({ projectId, taskId, from, to: column, index })).then((res) => {
      if (moveTask.rejected.match(res)) dispatch(pushToast(res.payload || 'Could not move the task', 'error'))
    })
  }

  const setFilter = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }))
    setPage(1)
  }

  const allTasks = board.columns.flatMap((c) => board.tasksByColumn[c] || [])
  const pages = Math.max(1, Math.ceil(allTasks.length / PAGE_SIZE))
  const pageTasks = allTasks.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="board-toolbar">
        <strong>{project.name}</strong>
        {project.isArchived && <span className="badge">Archived</span>}
        <span style={{ flex: 1 }} />
        <input className="fs-input" placeholder="Search tasks" aria-label="Search tasks" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} />
        <select className="fs-select" aria-label="Filter by priority" value={filters.priority} onChange={setFilter('priority')}>
          <option value="">Any priority</option>
          {['High', 'Medium', 'Low'].map((p) => <option key={p}>{p}</option>)}
        </select>
        <select className="fs-select" aria-label="Filter by label" value={filters.label} onChange={setFilter('label')}>
          <option value="">Any label</option>
          {(project.labels || []).map((l) => <option key={l}>{l}</option>)}
        </select>
        <select className="fs-select" aria-label="Filter by assignee" value={filters.assignee} onChange={setFilter('assignee')}>
          <option value="">Anyone</option>
          <option value="unassigned">Unassigned</option>
          {Object.values(people).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="fs-select" aria-label="View" value={view} onChange={(e) => setView(e.target.value)}>
          <option value="board">Board</option>
          <option value="list">List</option>
        </select>
        {manager && <button type="button" className="fs-btn" onClick={() => setDialog({ type: 'columns' })}>Columns</button>}
        {writer && !project.isArchived && (
          <button type="button" className="fs-btn primary" onClick={() => setDialog({ type: 'task' })}>+ New task</button>
        )}
      </div>
      {!writer && <p className="readonly-note" style={{ padding: '6px 12px', margin: 0 }}>You have read-only access to this project.</p>}
      {writer && filtered && <p className="readonly-note" style={{ padding: '6px 12px', margin: 0 }}>Clear the filters to drag cards.</p>}

      <div className="main-body">
        {board.status === 'error' && <ErrorState message={board.error} onRetry={refresh} />}
        {board.status === 'loading' && <Spinner label="Loading board…" />}

        {board.status === 'ready' && view === 'board' && (
          <div className="board">
            {board.columns.map((column) => {
              const tasks = board.tasksByColumn[column] || []
              return (
                <section
                  key={column}
                  className={`column${overColumn === column ? ' over' : ''}`}
                  aria-label={column}
                  onDragOver={(e) => {
                    if (!canDrag || !drag) return
                    e.preventDefault()
                    setOverColumn(column)
                  }}
                  onDragLeave={() => setOverColumn((c) => (c === column ? null : c))}
                  onDrop={(e) => {
                    e.preventDefault()
                    dropOn(column, tasks.length)
                  }}
                >
                  <div className="column-head">
                    <span>{column}</span>
                    <span className="fs-muted">{tasks.length}</span>
                  </div>
                  <div className="column-body">
                    {tasks.length === 0 && <div className="fs-muted" style={{ padding: 8 }}>No tasks</div>}
                    {tasks.map((task, index) => (
                      <TaskCard
                        key={task._id}
                        task={task}
                        draggable={canDrag}
                        dragging={drag?.taskId === task._id}
                        onOpen={() => setOpenTaskId(task._id)}
                        onDragStart={(e) => {
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', task._id)
                          setDrag({ taskId: task._id, from: column })
                        }}
                        onDragEnd={() => {
                          setDrag(null)
                          setOverColumn(null)
                        }}
                        onDrop={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          dropOn(column, index)
                        }}
                      />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}

        {board.status === 'ready' && view === 'list' && (
          <div className="page" style={{ maxWidth: 'none' }}>
            {allTasks.length === 0 ? (
              <EmptyState title="No tasks match">Try clearing the filters.</EmptyState>
            ) : (
              <>
                <table className="fs-table">
                  <thead>
                    <tr><th>Ref</th><th>Title</th><th>Status</th><th>Priority</th><th>Assignee</th><th>Deadline</th></tr>
                  </thead>
                  <tbody>
                    {pageTasks.map((t) => (
                      <tr key={t._id} style={{ cursor: 'pointer' }} onClick={() => setOpenTaskId(t._id)}>
                        <td><span className="task-ref">{taskRef(t._id)}</span></td>
                        <td>{t.title}</td>
                        <td>{t.status}</td>
                        <td><span className={`badge ${String(t.priority).toLowerCase()}`}>{t.priority}</span></td>
                        <td>{t.assignee?.name || '—'}</td>
                        <td>{formatDate(t.deadline) || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="fs-row" style={{ marginTop: 10 }}>
                  <button type="button" className="fs-btn small" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                  <span className="fs-muted">Page {page} of {pages}</span>
                  <button type="button" className="fs-btn small" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>Next</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {openTaskId && (
        <TaskDrawer
          key={openTaskId}
          taskId={openTaskId}
          project={project}
          role={role}
          people={people}
          onClose={() => setOpenTaskId(null)}
          onChanged={refresh}
        />
      )}
      {dialog?.type === 'task' && (
        <NewTaskModal project={project} people={people} filters={activeFilters} onClose={() => setDialog(null)} />
      )}
      {dialog?.type === 'columns' && (
        <ColumnsModal project={project} filters={activeFilters} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}
