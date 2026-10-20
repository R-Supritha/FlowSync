import { useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'
import { presenceApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import useAsync from '../hooks/useAsync'
import { pushToast } from '../store/uiSlice'

const HEARTBEAT_MS = 120000 // the server treats 3 minutes of silence as offline
const STATUSES = ['auto', 'Active', 'Idle', 'Do Not Disturb', 'Offline']
const MODES = ['', 'Coding', 'Reviewing', 'Testing', 'Designing']

// Tells the server we are here, and lets the person pick a status and what they are working on.
export default function PresenceControl() {
  const dispatch = useDispatch()
  const { data, reload } = useAsync(() => presenceApi.me(), [])
  const [choice, setChoice] = useState(null) // what the person just picked, until the server confirms

  useEffect(() => {
    const beat = () => presenceApi.heartbeat(!document.hidden).catch(() => {})
    beat()
    const timer = setInterval(beat, HEARTBEAT_MS)
    return () => clearInterval(timer)
  }, [])

  const p = data?.presence
  const status = choice?.status ?? (p ? (p.source === 'manual' ? p.status : 'auto') : 'auto')
  const mode = choice?.workMode ?? (p && p.workModeSource === 'manual' ? p.workMode || '' : '')

  async function change(body, next) {
    setChoice((c) => ({ status, workMode: mode, ...c, ...next }))
    try {
      await presenceApi.setStatus(body)
      reload()
    } catch (e) {
      dispatch(pushToast(errorMessage(e), 'error'))
    } finally {
      setChoice(null)
    }
  }

  return (
    <div className="fs-row" style={{ gap: 4 }}>
      <label className="fs-muted" htmlFor="presence-status" style={{ fontSize: 12 }}>Status</label>
      <select id="presence-status" className="fs-select" style={{ width: 'auto' }} value={status}
        onChange={(e) => change({ status: e.target.value }, { status: e.target.value })}>
        {STATUSES.map((s) => <option key={s} value={s}>{s === 'auto' ? `Auto${p && p.source === 'auto' ? ` (${p.status})` : ''}` : s}</option>)}
      </select>
      <select aria-label="Working on" className="fs-select" style={{ width: 'auto' }} value={mode}
        onChange={(e) => change({ workMode: e.target.value || null }, { workMode: e.target.value })}>
        {MODES.map((m) => <option key={m} value={m}>{m || 'No work mode'}</option>)}
      </select>
    </div>
  )
}
