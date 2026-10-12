import { useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'
import { Check, Save, Settings } from 'lucide-react'
import { privacyApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { pushToast } from '../store/uiSlice'
import { Field, Spinner } from '../components/ui'

const LEVEL_HELP = {
  workspace: 'Anyone in the same workspace as you',
  team: 'Anyone in a team with you',
  shared: 'Anyone who shares a workspace with you that the viewer also belongs to',
  public: 'Visible to everyone on FlowSync',
}

export default function SettingsPage() {
  const dispatch = useDispatch()
  const [privacy, setPrivacy] = useState(null)
  const [levels, setLevels] = useState([])
  const [form, setForm] = useState({ statusVisibility: 'team', contributionVisibility: 'team', inferWorkMode: true })
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await privacyApi.get()
        if (!alive) return
        setPrivacy(res.privacy)
        setLevels(res.levels || [])
        setForm({
          statusVisibility: res.privacy.statusVisibility,
          contributionVisibility: res.privacy.contributionVisibility,
          inferWorkMode: !!res.privacy.inferWorkMode,
        })
      } catch (e) {
        if (!alive) return
        dispatch(pushToast(errorMessage(e, 'Failed to load settings'), 'error'))
        setPrivacy({})
      }
    })()
    return () => {
      alive = false
    }
  }, [dispatch])

  if (!privacy) return <Spinner label="Loading settings…" />

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setSaved(false)
    try {
      await privacyApi.update(form)
      dispatch(pushToast('Privacy settings saved', 'success'))
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      dispatch(pushToast(errorMessage(e), 'error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <h1><Settings size={20} aria-hidden="true" /> Settings</h1>

      <section className="panel">
        <div className="panel-head"><h3>Privacy</h3></div>
        <form onSubmit={submit} style={{ maxWidth: 480 }}>
          <Field label="Who can see your online status" htmlFor="st-vis">
            <select id="st-vis" className="fs-select" value={form.statusVisibility} onChange={(e) => setForm({ ...form, statusVisibility: e.target.value })}>
              {levels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <span className="fs-help">{LEVEL_HELP[form.statusVisibility]}</span>
          </Field>
          <Field label="Who can see your work contributions" htmlFor="co-vis">
            <select id="co-vis" className="fs-select" value={form.contributionVisibility} onChange={(e) => setForm({ ...form, contributionVisibility: e.target.value })}>
              {levels.map((l) => <option key={l} value={l}>{l}</option>)}
            </select>
            <span className="fs-help">{LEVEL_HELP[form.contributionVisibility]}</span>
          </Field>
          <label className="fs-row" style={{ gap: 8, marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={form.inferWorkMode}
              onChange={(e) => setForm({ ...form, inferWorkMode: e.target.checked })}
            />
            <span>Infer my work mode from active development</span>
          </label>
          <button type="submit" className="fs-btn primary" disabled={busy}>
            {saved ? <Check size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />} {busy ? 'Saving…' : saved ? 'Saved' : 'Save settings'}
          </button>
        </form>
      </section>
    </div>
  )
}