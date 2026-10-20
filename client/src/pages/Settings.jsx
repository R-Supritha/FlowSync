import { useDispatch, useSelector } from 'react-redux'
import { presenceApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import useAsync from '../hooks/useAsync'
import { THEMES, setFontSize, setTheme, pushToast } from '../store/uiSlice'
import { ErrorState, Spinner } from '../components/ui'

const LEVELS = [
  ['everyone', 'Everyone in my workspaces'], ['team', 'My teammates'], ['managers', 'Managers only'], ['private', 'Only me'],
]
const SIZES = [12, 13, 14, 15, 16, 18]

export default function Settings() {
  const dispatch = useDispatch()
  const theme = useSelector((s) => s.ui.theme)
  const fontSize = useSelector((s) => s.ui.fontSize)
  const { data, error, loading, reload } = useAsync(() => presenceApi.getPrivacy(), [])

  async function save(body) {
    try {
      await presenceApi.setPrivacy(body)
      dispatch(pushToast('Saved', 'success'))
      reload()
    } catch (e) {
      dispatch(pushToast(errorMessage(e), 'error'))
    }
  }

  const p = data?.privacy
  return (
    <div className="page" style={{ maxWidth: 640 }}>
      <h1>Settings</h1>

      <section className="panel-card" aria-label="Appearance">
        <h3>Appearance</h3>
        <label className="fs-label" htmlFor="set-theme">Theme</label>
        <select id="set-theme" className="fs-select" value={theme} onChange={(e) => dispatch(setTheme(e.target.value))}>
          <option value="system">System default</option>
          {THEMES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <label className="fs-label" htmlFor="set-font">Text size</label>
        <select id="set-font" className="fs-select" value={fontSize} onChange={(e) => dispatch(setFontSize(Number(e.target.value)))}>
          {SIZES.map((n) => <option key={n} value={n}>{n}px</option>)}
        </select>
      </section>

      <section className="panel-card" style={{ marginTop: 12 }} aria-label="Privacy">
        <h3>Privacy</h3>
        {error && <ErrorState message={error} onRetry={reload} />}
        {loading && !data && <Spinner label="Loading privacy settings…" />}
        {p && (
          <>
            <label className="fs-label" htmlFor="set-status">Who can see my status</label>
            <select id="set-status" className="fs-select" value={p.statusVisibility} onChange={(e) => save({ statusVisibility: e.target.value })}>
              {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <label className="fs-label" htmlFor="set-contrib">Who can see my weekly contribution dots</label>
            <select id="set-contrib" className="fs-select" value={p.contributionVisibility} onChange={(e) => save({ contributionVisibility: e.target.value })}>
              {LEVELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <label className="fs-row" style={{ marginTop: 12 }}>
              <input type="checkbox" checked={!!p.inferWorkMode} onChange={(e) => save({ inferWorkMode: e.target.checked })} />
              Let FlowSync guess what I am working on from my latest activity
            </label>
            <p className="fs-muted" style={{ fontSize: '0.85em' }}>FlowSync never records screens, keystrokes or time online.</p>
          </>
        )}
      </section>

      <section className="panel-card" style={{ marginTop: 12 }} aria-label="Not available yet">
        <h3>Notifications and language</h3>
        <p className="fs-muted" style={{ margin: 0 }}>These need backend support that does not exist yet.</p>
      </section>
    </div>
  )
}
