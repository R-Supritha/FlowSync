import { useState } from 'react'
import { activityApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import useAsync from '../hooks/useAsync'
import { timeAgo } from '../utils/format'
import { EmptyState, ErrorState, Spinner } from './ui'

const PAGE = 30

// The timeline of a project (scope="project") or a whole workspace (scope="workspace").
export default function ActivityFeed({ scope, id, compact = false }) {
  const fetchPage = (params) => (scope === 'project' ? activityApi.project(id, params) : activityApi.workspace(id, params))
  const first = useAsync(() => fetchPage({ limit: PAGE }), [scope, id])
  const [more, setMore] = useState({ for: null, items: [], next: null, error: '', busy: false })

  const head = first.data?.activities?.[0]?._id
  const key = `${scope}:${id}:${head}`
  const mine = more.for === key
  const items = [...(first.data?.activities || []), ...(mine ? more.items : [])]
  const next = mine ? more.next : first.data?.nextBefore

  async function loadMore() {
    setMore((m) => ({ ...(m.for === key ? m : { for: key, items: [], next }), busy: true, error: '' }))
    try {
      const res = await fetchPage({ limit: PAGE, before: next })
      setMore((m) => ({ for: key, items: [...(m.for === key ? m.items : []), ...res.activities], next: res.nextBefore, error: '', busy: false }))
    } catch (e) {
      setMore((m) => ({ ...m, for: key, busy: false, error: errorMessage(e) }))
    }
  }

  if (first.error) return <ErrorState message={first.error} onRetry={first.reload} />
  if (first.loading && !first.data) return <Spinner label="Loading activity…" />
  if (items.length === 0) return <EmptyState title="No activity yet">Changes to tasks, comments, files and GitHub will appear here.</EmptyState>

  return (
    <div>
      <div className="fs-row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="fs-btn small" onClick={first.reload}>Refresh</button>
      </div>
      <ul className="list">
        {items.map((a) => (
          <li key={a._id} className="list-row">
            <span className={`dot-sm ${a.category || 'none'}`} role="img" aria-label={a.category || 'activity'} />
            <span style={{ flex: 1 }}>
              <strong>{a.actor?.name || 'Someone'}</strong> {a.message}
              {scope === 'workspace' && a.project?.name && <span className="fs-muted"> in {a.project.name}</span>}
            </span>
            {!compact && a.category && <span className="badge">{a.category}</span>}
            <span className="fs-muted" style={{ fontSize: '0.8em' }}>{timeAgo(a.createdAt)}</span>
          </li>
        ))}
      </ul>
      {more.error && <p className="fs-error" role="alert">{more.error}</p>}
      {next && <button type="button" className="fs-btn small" disabled={more.busy} onClick={loadMore}>{more.busy ? 'Loading…' : 'Load more'}</button>}
    </div>
  )
}
