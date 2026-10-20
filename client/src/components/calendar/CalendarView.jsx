import { useEffect, useMemo, useState } from 'react'
import { useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Milestone } from 'lucide-react'
import { calendarApi } from '../../api/endpoints'
import { errorMessage } from '../../api/client'
import { openTask } from '../../store/uiSlice'
import { dayKey, startOfDay, addDays, weekStart } from '../../utils/format'
import { EmptyState, ErrorState, Spinner } from '../ui'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// Shared calendar for a project or a whole workspace.
// scope: { type: 'project' | 'workspace', id }
export default function CalendarView({ scope }) {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [view, setView] = useState('week')
  const [cursor, setCursor] = useState(() => dayKey(new Date()))
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')

  async function load() {
    if (!scope?.id) return
    try {
      const params = { view, date: cursor }
      const res =
        scope.type === 'project'
          ? await calendarApi.project(scope.id, params)
          : await calendarApi.workspace(scope.id, params)
      setData(res)
      setStatus('ready')
    } catch (e) {
      setError(errorMessage(e, 'Failed to load the calendar'))
      setStatus('error')
    }
  }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope?.id, view, cursor])

  const days = useMemo(() => {
    if (!data?.range?.start) return []
    const start = startOfDay(new Date(data.range.start))
    const n = view === 'week' ? 7 : new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate()
    return Array.from({ length: n }, (_, i) => {
      const date = addDays(start, i)
      const key = dayKey(date)
      return {
        key,
        date,
        isToday: key === dayKey(new Date()),
        events: (data.events || []).filter((e) => dayKey(e.date) === key),
      }
    })
  }, [data, view])

  if (!scope?.id) return <EmptyState title="Nothing to show" />

  return (
    <div className="page calendar-page">
      <div className="fs-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div className="fs-row" style={{ gap: 4 }}>
          <button type="button" className="fs-btn small ghost" aria-label="Previous period" onClick={() => setCursor(dayKey(view === 'week' ? addDays(startOfDay(new Date(cursor)), -7) : new Date(new Date(cursor).getFullYear(), new Date(cursor).getMonth() - 1, 1)))}>
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          <button type="button" className="fs-btn small" onClick={() => setCursor(dayKey(new Date()))}>Today</button>
          <button type="button" className="fs-btn small ghost" aria-label="Next period" onClick={() => setCursor(dayKey(view === 'week' ? addDays(startOfDay(new Date(cursor)), 7) : new Date(new Date(cursor).getFullYear(), new Date(cursor).getMonth() + 1, 1)))}>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
          <span className="fs-muted">{view === 'week' ? weekTitle(cursor) : monthTitle(cursor)}</span>
        </div>
        <div className="fs-row" role="tablist" aria-label="Calendar period">
          <button type="button" role="tab" aria-selected={view === 'week'} className={`fs-btn small${view === 'week' ? ' primary' : ''}`} onClick={() => setView('week')}>Week</button>
          <button type="button" role="tab" aria-selected={view === 'month'} className={`fs-btn small${view === 'month' ? ' primary' : ''}`} onClick={() => setView('month')}>Month</button>
        </div>
      </div>

      {status === 'loading' && <Spinner label="Loading calendar…" />}
      {status === 'error' && <ErrorState message={error} onRetry={load} />}
      {status === 'ready' && (
        <>
          {data.events.length === 0 && <EmptyState title="Nothing scheduled here" />}
          <div className={`calendar ${view}`}>
            {days.map((d) => (
              <div key={d.key} className={`cal-col${d.isToday ? ' today' : ''}`}>
                <div className="cal-head">
                  <span className="fs-muted">{view === 'week' ? DAY_LABELS[d.date.getDay() === 0 ? 6 : d.date.getDay() - 1] : formatDay(d.date)}</span>
                  <span className="cal-num">{d.date.getDate()}</span>
                </div>
                {d.events.map((e) => (
                  <EventChip key={e._id} event={e} onClick={() => (e.type === 'task' ? dispatch(openTask(e._id)) : navigate(`/projects/${e.project}/milestones`))} />
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function EventChip({ event, onClick }) {
  return (
    <button type="button" className="event-chip" onClick={onClick}>
      {event.type === 'milestone' ? <Milestone size={11} aria-hidden="true" /> : <span className="dot" style={{ background: priColor(event.priority) }} />}
      <span className="ellipsis">{event.title}</span>
      {event.type === 'milestone' && event.completed && <span className="badge">done</span>}
    </button>
  )
}

const priColor = (p) =>
  ({ High: 'var(--danger)', Medium: 'var(--warn)', Low: 'var(--ok)' })[p] || 'var(--fg-muted)'
const weekTitle = (cursor) => {
  const d = new Date(cursor)
  const start = weekStart(d)
  const end = addDays(start, 6)
  return `${formatDay(start)} – ${formatDay(end)}`
}
const monthTitle = (cursor) => {
  const d = new Date(cursor)
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}
const formatDay = (d) =>
  d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })