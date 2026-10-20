import { useState } from 'react'
import { contributionApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import useAsync from '../hooks/useAsync'
import { formatDateTime } from '../utils/format'
import { Spinner } from './ui'

const MEANING = { green: 'finished work', yellow: 'collaboration', blue: 'planning', gray: 'nothing recorded' }
const today = () => new Date().toLocaleDateString('en-CA')

// Seven dots, Monday to Sunday. Click a dot to see what is behind it.
export default function ContributionDots({ userId, title = 'This week' }) {
  const { data, error, loading } = useAsync(() => contributionApi.week(userId, { date: today() }), [userId])
  const [picked, setPicked] = useState(null)
  const [detail, setDetail] = useState({ date: null, data: null, error: '' })

  async function pick(day) {
    setPicked(day.date)
    setDetail({ date: day.date, data: null, error: '' })
    try {
      const res = await contributionApi.day(userId, { date: day.date })
      setDetail({ date: day.date, data: res, error: '' })
    } catch (e) {
      setDetail({ date: day.date, data: null, error: errorMessage(e) })
    }
  }

  if (loading && !data && !error) return <Spinner label="Loading contributions…" />
  if (error) return <p className="fs-muted" role="status">{error}</p>

  return (
    <section aria-label={title}>
      <div className="fs-label">{title}</div>
      <div className="fs-row" style={{ gap: 10 }}>
        {data.days.map((d) => (
          <button
            key={d.date}
            type="button"
            className={`dot ${d.color}${picked === d.date ? ' picked' : ''}`}
            aria-label={`${d.day} ${d.date}: ${MEANING[d.color]}${d.summary ? `, ${d.summary}` : ''}`}
            title={`${d.day}: ${d.summary || MEANING[d.color]}`}
            onClick={() => pick(d)}
          >
            <span>{d.day.slice(0, 1)}</span>
          </button>
        ))}
      </div>
      <p className="fs-muted" style={{ fontSize: '0.8em', margin: '6px 0' }}>
        Green finished work · yellow collaboration · blue planning · gray nothing recorded
      </p>
      {detail.date && (
        <div className="panel-card" role="status" style={{ marginTop: 6 }}>
          <strong>{detail.date}</strong>
          {detail.error && <p className="fs-error" style={{ margin: '4px 0 0' }}>{detail.error}</p>}
          {detail.data && (
            <>
              <div className="fs-muted">{detail.data.summary || 'No activity recorded.'}</div>
              <ul className="list">
                {detail.data.events.map((e) => (
                  <li key={e._id} className="list-row">
                    <span style={{ flex: 1 }}>{e.message}</span>
                    <span className="fs-muted">{formatDateTime(e.createdAt)}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}
