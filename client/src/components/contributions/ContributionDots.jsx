import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { contributionApi } from '../../api/endpoints'
import { errorMessage } from '../../api/client'
import { dayKey, weekStart, addDays } from '../../utils/format'
import { DOT_VAR, CATEGORY_COLOR } from '../../utils/activity'
import { EmptyState, ErrorState, Spinner } from '../ui'

function Dot({ day, active, size = 34, onClick }) {
  const color = day.total > 0 ? DOT_VAR[day.color] || DOT_VAR.gray : DOT_VAR.gray
  return (
    <button
      type="button"
      className={`contribution-dot${active ? ' active' : ''}`}
      title={`${day.date} — ${day.total} events\n${day.summary}`}
      onClick={onClick}
      style={{ width: size, height: size, background: color }}
      aria-label={`${day.date}: ${day.summary || 'no activity'}`}
    />
  )
}

export default function ContributionDots({ userId, workspaceId }) {
  const team = useSelector((s) => s.presence.team[workspaceId])
  const member = team?.find((m) => String(m.user?._id) === String(userId))
  const [cursor, setCursor] = useState(() => dayKey(new Date()))
  const [week, setWeek] = useState(null)
  const [status, setStatus] = useState('loading')
  const [dayInfo, setDayInfo] = useState(null)
  const [dayStatus, setDayStatus] = useState('idle')
  const [error, setError] = useState('')

  async function loadWeek(date) {
    try {
      const res = await contributionApi.week(userId, { date, workspaceId })
      setWeek(res)
      setDayInfo(null)
      setDayStatus('idle')
    } catch (e) {
      setError(errorMessage(e, 'Could not load contributions'))
      setStatus('error')
    } finally {
      setStatus('ready')
    }
  }

  useEffect(() => {
    let alive = true
    ;(async () => {
      await Promise.resolve()
      if (!alive) return
      await loadWeek(cursor)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, workspaceId, cursor])

  async function selectDay(date) {
    if (dayInfo?.date === date) return
    setDayStatus('loading')
    try {
      const res = await contributionApi.day(userId, { date })
      setDayInfo(res)
    } catch (e) {
      setDayInfo({ error: errorMessage(e, 'Could not load this day') })
    } finally {
      setDayStatus('ready')
    }
  }

  const title = member?.status || week?.user?.name || 'This member'
  const visible = week?.days?.filter((d) => d.total > 0).length ?? 0
  const totalEvents = week?.totals?.total ?? 0

  return (
    <section className={`panel${status === 'error' ? ' danger' : ''}`}>
      <div className="panel-head">
        <h3>{title}</h3>
        <div className="fs-row" style={{ gap: 4 }}>
          <button type="button" className="fs-btn small ghost" aria-label="Previous week" onClick={() => setCursor(dayKey(addDays(new Date(cursor), -7)))}>
            <ChevronLeft size={14} aria-hidden="true" />
          </button>
          <span className="fs-muted" style={{ fontSize: 12 }}>
            {week?.weekStart} – {week?.weekEnd}
          </span>
          <button type="button" className="fs-btn small ghost" aria-label="Next week" disabled={week?.weekStart === dayKey(weekStart(new Date()))} onClick={() => setCursor(dayKey(addDays(new Date(cursor), 7)))}>
            <ChevronRight size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {status === 'loading' && <Spinner label="Loading contributions…" />}
      {status === 'error' && <ErrorState message={error} onRetry={() => loadWeek(cursor)} />}

      {status === 'ready' && week && (
        <>
          <div className="contribution-row">
            {week.days.map((d) => (
              <Dot key={d.date} day={d} active={dayInfo?.date === d.date} onClick={() => selectDay(d.date)} />
            ))}
          </div>
          <p className="fs-muted" style={{ fontSize: 12 }}>
            {totalEvents} events this week · {visible} active {visible === 1 ? 'day' : 'days'}
          </p>

          <div className="fs-row" style={{ gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
            {Object.entries(CATEGORY_COLOR).map(([k, name]) => (
              <span key={k} className="fs-row" style={{ gap: 4, fontSize: 11, color: 'var(--fg-muted)' }}>
                <span className="contribution-dot sm" style={{ background: DOT_VAR[name] }} />
                {week.totals[k]} {k}
              </span>
            ))}
          </div>

          {dayStatus === 'loading' && <Spinner label="Loading day…" />}
          {dayStatus === 'ready' && dayInfo && !dayInfo.error && (
            <div className="day-detail">
              <p><strong>{dayInfo.summary}</strong></p>
              <ul className="activity-list">
                {dayInfo.events.slice(0, 8).map((e) => (
                  <li key={e._id}>
                    <div className="activity-line">
                      <p><span>{e.message}</span></p>
                      <span className="fs-muted">{e.project?.name || topicName(e)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {dayStatus === 'ready' && dayInfo?.error && <p className="fs-error">{dayInfo.error}</p>}

          {!week.totals.total && (
            <EmptyState title="No activity yet">Completed tasks, comments and planning for {title} appear here.</EmptyState>
          )}
        </>
      )}
    </section>
  )
}

function topicName(e) {
  if (e.taskTitle) return e.taskTitle
  return ''
}