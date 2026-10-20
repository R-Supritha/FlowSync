import { useState } from 'react'
import { Link } from 'react-router-dom'
import { calendarApi } from '../api/endpoints'
import useAsync from '../hooks/useAsync'
import { ErrorState, Spinner } from './ui'

const dayKey = (d) => d.toLocaleDateString('en-CA')
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function mondayOf(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7))
  return x
}

function Event({ e }) {
  const to = e.type === 'milestone' ? `/projects/${e.project}/milestones` : `/projects/${e.project}/board?task=${e._id}`
  return (
    <Link to={to} className={`cal-event ${e.type}${e.completed ? ' done' : ''}`} title={`${e.type === 'milestone' ? 'Milestone' : 'Task'}: ${e.title}${e.projectName ? ` (${e.projectName})` : ''}`}>
      {e.type === 'milestone' ? '◆ ' : ''}{e.title}
    </Link>
  )
}

// Week or month view of task deadlines and milestones, for one project or a whole workspace.
export default function CalendarView({ scope, id }) {
  const [view, setView] = useState('month')
  const [cursor, setCursor] = useState(() => new Date())
  const date = dayKey(cursor)
  const { data, error, loading, reload } = useAsync(
    () => (scope === 'project' ? calendarApi.project(id, { view, date }) : calendarApi.workspace(id, { view, date })),
    [scope, id, view, date],
  )

  const shift = (dir) =>
    setCursor((c) => {
      const n = new Date(c)
      if (view === 'week') n.setDate(n.getDate() + dir * 7)
      else n.setMonth(n.getMonth() + dir, 1)
      return n
    })

  const byDay = {}
  for (const e of data?.events || []) (byDay[dayKey(new Date(e.date))] ||= []).push(e)

  let cells
  if (view === 'week') {
    const start = mondayOf(cursor)
    cells = Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  } else {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const offset = (first.getDay() + 6) % 7
    const count = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
    const total = Math.ceil((offset + count) / 7) * 7
    cells = Array.from({ length: total }, (_, i) => (i < offset || i >= offset + count ? null : new Date(cursor.getFullYear(), cursor.getMonth(), i - offset + 1)))
  }
  const title = view === 'week'
    ? `Week of ${mondayOf(cursor).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="fs-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <h1>Calendar</h1>
        <div className="fs-row">
          <button type="button" className="fs-btn small" aria-label="Previous" onClick={() => shift(-1)}>←</button>
          <strong aria-live="polite">{title}</strong>
          <button type="button" className="fs-btn small" aria-label="Next" onClick={() => shift(1)}>→</button>
          <button type="button" className="fs-btn small" onClick={() => setCursor(new Date())}>Today</button>
          <select className="fs-select" aria-label="Calendar view" style={{ width: 'auto' }} value={view} onChange={(e) => setView(e.target.value)}>
            <option value="month">Month</option>
            <option value="week">Week</option>
          </select>
        </div>
      </div>
      {error && <ErrorState message={error} onRetry={reload} />}
      {loading && !data && <Spinner label="Loading calendar…" />}
      <div className="cal-grid" role="grid" aria-label={title}>
        {DAY_NAMES.map((n) => <div key={n} className="cal-head" role="columnheader">{n}</div>)}
        {cells.map((d, i) => (
          <div key={d ? dayKey(d) : `blank-${i}`} className={`cal-cell${d && dayKey(d) === dayKey(new Date()) ? ' today' : ''}${d ? '' : ' blank'}`} role="gridcell">
            {d && <div className="cal-num">{d.getDate()}</div>}
            {d && (byDay[dayKey(d)] || []).map((e) => <Event key={`${e.type}-${e._id}`} e={e} />)}
          </div>
        ))}
      </div>
      {data && data.events.length === 0 && <p className="fs-muted">No deadlines or milestones in this {view}.</p>}
    </div>
  )
}
