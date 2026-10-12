import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { activityApi } from '../../api/endpoints'
import { errorMessage } from '../../api/client'
import { ACTIVITY_LABELS } from '../../utils/activity'
import { openTask } from '../../store/uiSlice'
import { Avatar, EmptyState, ErrorState } from '../ui'
import { formatting } from './activityHelpers'

const POLL_MS = 45000

// Reads an SSE stream over fetch() so the JWT can stay in the Authorization header
// instead of the URL. Pushes live events until the component unmounts.
async function streamProjectActivity(projectId, token, onActivity, onState) {
  const controller = new AbortController()
  async function run() {
    let res
    try {
      res = await fetch(activityApi.streamUrl(projectId), {
        headers: { Authorization: `Bearer ${token}` },
        signal: controller.signal,
      })
      if (!res.ok || !res.body) throw new Error(`Stream failed (${res.status})`)
      onState('live')
    } catch {
      onState('polling')
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
            const data = JSON.parse(line.slice(6))
            if (data && data.category) onActivity(data)
          } catch {
            /* ignore malformed frames */
          }
        }
      }
    } catch {
      /* connection closed */
    }
    onState('polling')
  }
  run()
  return controller
}

// Renders a chronological activity feed. `scope` is 'project' or 'workspace'.
export default function ActivityFeed({ scope, id, compact = false }) {
  const token = useSelector((s) => s.auth.token)
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [items, setItems] = useState([])
  const [status, setStatus] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')
  const [nextBefore, setNextBefore] = useState(null)
  const [live, setLive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [typeFilter, setTypeFilter] = useState('')
  const controllerRef = useRef(null)

  const load = useCallback(
    async (before) => {
      try {
        const params = { limit: compact ? 20 : 30 }
        if (before) params.before = before
        if (typeFilter) params.type = typeFilter
        const res =
          scope === 'project'
            ? await activityApi.project(id, params)
            : await activityApi.workspace(id, params)
        setItems((prev) => (before ? [...prev, ...res.activities] : res.activities))
        setNextBefore(res.nextBefore)
        setStatus('ready')
      } catch (e) {
        setError(errorMessage(e, 'Failed to load activity'))
        setStatus('error')
      }
    },
    [scope, id, typeFilter, compact],
  )

  useEffect(() => {
    let alive = true
    ;(async () => {
      await Promise.resolve()
      if (!alive) return
      await load()
    })()
    return () => {
      alive = false
    }
  }, [load])

  // Live updates only for project feeds (the backend exposes the SSE stream there).
  useEffect(() => {
    if (scope !== 'project') return undefined
    const controller = streamProjectActivity(id, token, (activity) => {
      setItems((prev) =>
        prev.some((a) => a._id === activity._id) ? prev : [activity, ...prev].slice(0, 200),
      )
    }, setLive)
    controllerRef.current = controller
    const poll = setInterval(() => load(), POLL_MS)
    return () => {
      controller.abort()
      clearInterval(poll)
    }
  }, [scope, id, token, load])

  if (status === 'loading' && items.length === 0) return <ActivityLoading compact={compact} />
  if (status === 'error' && items.length === 0) {
    return <ErrorState message={error} onRetry={() => load()} />
  }

  const filtered = typeFilter ? items.filter((a) => a.type === typeFilter) : items

  return (
    <div className={compact ? 'activity-feed compact' : 'activity-feed'}>
      <div className="fs-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span className="fs-muted" style={{ fontSize: 12 }}>
          {scope === 'project'
            ? live
              ? '● Live — updates stream in as they happen'
              : '○ Live stream unavailable — polling every 45s'
            : 'Workspace activity'}
        </span>
        <select
          className="fs-select"
          style={{ width: 'auto' }}
          aria-label="Filter activity by type"
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
        >
          <option value="">All activity</option>
          {Object.entries(ACTIVITY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      {filtered.length === 0 && (
        <EmptyState title={typeFilter ? 'Nothing matches this type' : 'No activity yet'}>
          Actions like creating tasks, moving cards and commenting will appear here.
        </EmptyState>
      )}

      <ul className="activity-list">
        {filtered.map((a) => (
          <li key={a._id}>
            <Avatar name={a.actor?.name} size={24} />
            <div className="activity-line">
              <p>
                <strong>{a.actor?.name || 'Someone'}</strong>{' '}
                <span>{formatting.message(a)}</span>
              </p>
              <span className="fs-muted">{formatting.time(a)}</span>
            </div>
            {a.task && !compact && (
              <button
                type="button"
                className="fs-btn small ghost"
                onClick={() => {
                  if (a.project) navigate(`/projects/${a.project}/board`)
                  dispatch(openTask(a.task))
                }}
              >
                Open
              </button>
            )}
          </li>
        ))}
      </ul>

      {nextBefore && (
        <div className="fs-row" style={{ justifyContent: 'center' }}>
          <button
            type="button"
            className="fs-btn small"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await load(nextBefore)
              setBusy(false)
            }}
          >
            {busy ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}
    </div>
  )
}

function ActivityLoading({ compact }) {
  return (
    <div className="state-box" style={{ padding: compact ? 16 : 32 }}>
      <div className="spinner" />
      Loading activity…
    </div>
  )
}