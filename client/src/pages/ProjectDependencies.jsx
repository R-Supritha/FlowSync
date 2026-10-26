import { useEffect, useMemo, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useParams } from 'react-router-dom'
import { taskApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import useProject from '../hooks/useProject'
import { openTask } from '../store/uiSlice'
import { formatDate, taskRef } from '../utils/format'
import { buildGraph, edgePaths, isDone, layoutGraph } from '../utils/dependencyGraph'
import { EmptyState, ErrorState, Spinner } from '../components/ui'

const LIMIT = 200 // the most tasks the server sends at once
const WAITING = ['Backlog', 'To Do']
const STRIPE = { done: 'var(--ok)', working: 'var(--warn)', waiting: '#8a8f98' }
const EDGE = '#8a8f98'

const groupOf = (task) => (isDone(task) ? 'done' : WAITING.includes(task.status) ? 'waiting' : 'working')
const plural = (n, word) => `${n} ${n === 1 ? word : `${word}s`}`

// One task as a box. The coloured stripe shows progress: green done, orange in progress, grey waiting.
function TaskNode({ task, placed, onOpen }) {
  const group = groupOf(task)
  return (
    <button
      type="button"
      data-task-id={task._id}
      data-group={group}
      aria-label={`${task.title}, ${task.status}. Open task details`}
      onClick={() => onOpen(task._id)}
      style={{
        ...(placed ? { position: 'absolute', left: placed.x, top: placed.y, width: placed.w, height: placed.h } : { position: 'relative', width: 210, minHeight: 74 }),
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '6px 8px 6px 14px',
        textAlign: 'left',
        cursor: 'pointer',
        color: 'var(--fg)',
        background: 'var(--bg-elev)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        overflow: 'hidden',
      }}
    >
      <span aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 7, background: STRIPE[group] }} />
      <span style={{ fontSize: 11, opacity: 0.7, fontFamily: 'monospace' }}>{taskRef(task._id)}</span>
      <span style={{ fontWeight: 600, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{task.title}</span>
      <span className="fs-muted" style={{ fontSize: 11 }}>
        {task.status}
        {task.assignee ? ` · ${String(task.assignee.name || '').split(' ')[0]}` : ''}
        {task.deadline ? ` · ${formatDate(task.deadline)}` : ''}
      </span>
    </button>
  )
}

function Legend() {
  const chip = (color, text) => (
    <span className="fs-row" style={{ gap: 5, fontSize: 12 }}>
      <span style={{ width: 12, height: 12, background: color, display: 'inline-block', borderRadius: 2 }} aria-hidden="true" />
      {text}
    </span>
  )
  return (
    <div className="fs-row" aria-label="Legend" style={{ gap: 14, flexWrap: 'wrap', margin: '8px 0' }}>
      {chip('var(--ok)', 'Done')}
      {chip('var(--warn)', 'In progress')}
      {chip('#8a8f98', 'Backlog or To Do')}
    </div>
  )
}

// The project's tasks as a top-down graph. An arrow runs from the task that must finish first to the task that waits for it.
export default function ProjectDependencies() {
  const { projectId } = useParams()
  const dispatch = useDispatch()
  const { project, error: projectError } = useProject(projectId)
  const [state, setState] = useState({ status: 'loading', tasks: [], total: 0, error: '' })

  const [attempt, setAttempt] = useState(0)
  const openTaskId = useSelector((s) => s.ui.openTaskId) // looking again whenever the task details open or close, so a change made there shows up

  useEffect(() => {
    let alive = true
    taskApi
      .list(projectId, { limit: LIMIT })
      .then((res) => {
        const tasks = res.tasks || []
        if (alive) setState({ status: 'ready', tasks, total: res.total ?? tasks.length, error: '' })
      })
      .catch((e) => alive && setState({ status: 'error', tasks: [], total: 0, error: errorMessage(e, 'Could not load the tasks') }))
    return () => {
      alive = false
    }
  }, [projectId, attempt, openTaskId])

  const retry = () => {
    setState((s) => ({ ...s, status: 'loading' }))
    setAttempt((n) => n + 1)
  }

  const graph = useMemo(() => buildGraph(state.tasks), [state.tasks])
  const layout = useMemo(() => layoutGraph(graph), [graph])
  const edges = useMemo(() => edgePaths(graph, layout), [graph, layout])

  if (projectError) return <ErrorState message={projectError} />
  if (!project) return <Spinner label="Loading project…" />
  if (state.status === 'loading') return <Spinner label="Loading the graph…" />
  if (state.status === 'error') return <ErrorState message={state.error} onRetry={retry} />

  const open = (id) => dispatch(openTask(id))
  const node = (id, placed) => <TaskNode key={id} task={graph.byId.get(id)} placed={placed} onOpen={open} />
  const hasLinks = layout.nodes.size > 0

  return (
    <div className="page">
      <h1>Dependency graph</h1>
      <p className="fs-muted" style={{ marginTop: 0 }}>
        Each box is a task. An arrow means the task above must finish before the task below can start. Click a task to open its details.
      </p>
      <div className="fs-row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className="fs-muted">{plural(state.tasks.length, 'task')} · {plural(edges.length, 'dependency').replace('dependencys', 'dependencies')}</span>
      </div>
      <Legend />
      {state.total > LIMIT && <p className="fs-muted">Showing the first {LIMIT} of {state.total} tasks.</p>}

      {state.tasks.length === 0 ? (
        <EmptyState title="No tasks yet">Add tasks on the Board, then open a task and use &quot;Add dependency&quot; to say which ones must finish first.</EmptyState>
      ) : (
        <>
          {hasLinks ? (
            <div style={{ overflow: 'auto', maxHeight: '70vh', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg)' }}>
              <div style={{ position: 'relative', width: layout.width, height: layout.height }}>
                <svg width={layout.width} height={layout.height} aria-hidden="true" style={{ position: 'absolute', left: 0, top: 0 }}>
                  <defs>
                    <marker id="dep-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M 0 0 L 10 5 L 0 10 z" style={{ fill: EDGE }} />
                    </marker>
                  </defs>
                  {edges.map((e) => (
                    <path key={`${e.from}>${e.to}`} d={e.d} data-edge={`${e.from}>${e.to}`} fill="none" style={{ stroke: EDGE, strokeWidth: 1.8 }} markerEnd="url(#dep-arrow)" />
                  ))}
                </svg>
                {[...layout.nodes.keys()].map((id) => node(id, { ...layout.nodes.get(id), w: layout.nodeW, h: layout.nodeH }))}
              </div>
            </div>
          ) : (
            <p className="fs-muted">No dependencies yet. Open a task and click &quot;Add dependency&quot; to pick a task it must wait for. Projects made with the AI generator get them automatically. They appear here as arrows.</p>
          )}

          {layout.isolated.length > 0 && (
            <section aria-label="Tasks without dependencies" style={{ marginTop: 16 }}>
              <h2 style={{ fontSize: 15 }}>Not linked to other tasks ({layout.isolated.length})</h2>
              <div className="fs-row" style={{ flexWrap: 'wrap', gap: 12 }}>{layout.isolated.map((id) => node(id, null))}</div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
