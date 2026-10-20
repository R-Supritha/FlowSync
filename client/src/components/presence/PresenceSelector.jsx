import { useDispatch, useSelector } from 'react-redux'
import { pushToast } from '../../store/uiSlice'
import { updateMyPresence } from '../../store/presenceSlice'
import { errorMessage } from '../../api/client'
import { PRESENCE_STATUSES, STATUS_COLOR, WORK_MODES } from '../../utils/presence'
import { Dropdown, MenuItem } from '../ui'
import { Check, CircleDot } from 'lucide-react'

// The status the user last picked by hand. "auto" clears it and lets the server
// decide Active/Idle from the heartbeat.
export default function PresenceSelector() {
  const dispatch = useDispatch()
  const me = useSelector((s) => s.presence.me)
  const status = me?.status || 'Offline'
  const workMode = me?.workMode || ''
  const manual = me?.manualStatus

  async function setStatus(next) {
    try {
      await dispatch(updateMyPresence({ status: next })).unwrap()
      dispatch(pushToast(`Presence set to ${next === 'auto' ? 'automatic' : next}`, 'success'))
    } catch (e) {
      dispatch(pushToast(errorMessage(e), 'error'))
    }
  }

  async function setWorkMode(next) {
    try {
      await dispatch(updateMyPresence({ workMode: next || null })).unwrap()
      if (next) dispatch(pushToast(`Work mode: ${next}`, 'success'))
    } catch (e) {
      dispatch(pushToast(errorMessage(e), 'error'))
    }
  }

  return (
    <Dropdown
      label="Presence"
      width={230}
      button={
        <span className="fs-row" style={{ gap: 6, fontSize: 12 }}>
          <span className="presence-dot lg" style={{ background: STATUS_COLOR[status] }} />
          {status}
        </span>
      }
    >
      {({ close }) => (
        <>
          <div className="dropdown-head">
            <strong>Presence</strong>
          </div>
          <div className="dropdown-scroll">
            <div className="menu-group">Status</div>
            <MenuItem icon={CircleDot} onClick={async () => { await setStatus('auto'); close() }}>
              <span className="fs-row" style={{ gap: 6 }}>
                <Check size={manual === 'auto' || manual == null ? 14 : 14} style={{ opacity: manual == null ? 1 : 0.25 }} aria-hidden="true" />
                Automatic (follows my activity)
              </span>
            </MenuItem>
            {PRESENCE_STATUSES.map((s) => (
              <MenuItem key={s} onClick={async () => { await setStatus(s); close() }}>
                <span className="fs-row" style={{ gap: 6 }}>
                  <span className="presence-dot" style={{ background: STATUS_COLOR[s] }} />
                  {s}
                  <Check size={14} style={{ marginLeft: 'auto', opacity: manual === s ? 1 : 0.25 }} aria-hidden="true" />
                </span>
              </MenuItem>
            ))}
            <div className="menu-group">Work mode</div>
            <MenuItem onClick={async () => { await setWorkMode(''); close() }}>
              <span className="fs-row" style={{ gap: 6 }}>
                No mode
                <Check size={14} style={{ marginLeft: 'auto', opacity: workMode ? 0.25 : 1 }} aria-hidden="true" />
              </span>
            </MenuItem>
            {WORK_MODES.map((m) => (
              <MenuItem key={m} onClick={async () => { await setWorkMode(m); close() }}>
                <span className="fs-row" style={{ gap: 6 }}>
                  {m}
                  <Check size={14} style={{ marginLeft: 'auto', opacity: workMode === m ? 1 : 0.25 }} aria-hidden="true" />
                </span>
              </MenuItem>
            ))}
          </div>
        </>
      )}
    </Dropdown>
  )
}