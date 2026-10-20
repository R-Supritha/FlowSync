import { useEffect, useState } from 'react'
import { useDispatch } from 'react-redux'
import { Check, Save, Settings } from 'lucide-react'
import { settingsApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { pushToast, setFontSize, setLanguage, setTheme } from '../store/uiSlice'
import { Field, Spinner } from '../components/ui'
import { LANGUAGES as I18N_LANGUAGES } from '../i18n'

const LEVEL_HELP = {
  workspace: 'Anyone in the same workspace as you',
  team: 'Anyone in a team with you',
  shared: 'Anyone who shares a workspace with you that the viewer also belongs to',
  public: 'Visible to everyone on FlowSync',
}

const THEME_OPTIONS = [
  { id: 'system', label: 'System', hint: 'Follow your OS light/dark setting' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'contrast', label: 'High contrast' },
]

const NOTIFICATION_OPTIONS = [
  { id: 'taskAssigned', label: 'Task assignments', hint: 'When someone assigns a task to you' },
  { id: 'taskUpdates', label: 'Task status updates', hint: 'When a task you follow changes status' },
  { id: 'comments', label: 'Comments & replies', hint: 'New comments and replies on your tasks' },
  { id: 'mentions', label: 'Mentions', hint: 'When someone @-mentions you' },
  { id: 'dueDates', label: 'Due dates & reminders', hint: 'Deadlines approaching on your tasks' },
]

export default function SettingsPage() {
  const dispatch = useDispatch()

  const [loaded, setLoaded] = useState(false)
  const [levels, setLevels] = useState([])
  const [languages, setLanguages] = useState(I18N_LANGUAGES)
  const [form, setForm] = useState({
    theme: 'system',
    fontSize: 14,
    language: 'en',
    notifications: { taskAssigned: true, taskUpdates: true, comments: true, mentions: true, dueDates: true },
    statusVisibility: 'team',
    contributionVisibility: 'private',
    inferWorkMode: false,
  })
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await settingsApi.get()
        if (!alive) return
        const s = res.settings || {}
        const p = res.privacy || {}
        setLevels(res.visibilityLevels || [])
        setLanguages(res.languages?.length ? res.languages : I18N_LANGUAGES)
        setForm({
          theme: s.theme || 'system',
          fontSize: s.fontSize || 14,
          language: s.language || 'en',
          notifications: {
            taskAssigned: s.notifications?.taskAssigned ?? true,
            taskUpdates: s.notifications?.taskUpdates ?? true,
            comments: s.notifications?.comments ?? true,
            mentions: s.notifications?.mentions ?? true,
            dueDates: s.notifications?.dueDates ?? true,
          },
          statusVisibility: p.statusVisibility || 'team',
          contributionVisibility: p.contributionVisibility || 'private',
          inferWorkMode: !!p.inferWorkMode,
        })
        // Only adopt server values once the user has saved settings before,
        // so a brand-new device's local defaults are not clobbered.
        if (res.configured) {
          if (s.theme) dispatch(setTheme(s.theme))
          if (s.fontSize) dispatch(setFontSize(s.fontSize))
          if (s.language) dispatch(setLanguage(s.language))
        }
        setLoaded(true)
      } catch (e) {
        if (!alive) return
        dispatch(pushToast(errorMessage(e, 'Failed to load settings'), 'error'))
        setLoaded(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [dispatch])

  if (!loaded) return <Spinner label="Loading settings…" />

  function pickTheme(theme) {
    setForm((f) => ({ ...f, theme }))
    // Theme changes apply everywhere immediately; persistence happens on save.
    dispatch(setTheme(theme))
  }

  function pickFontSize(fontSize) {
    setForm((f) => ({ ...f, fontSize }))
    dispatch(setFontSize(fontSize))
  }

  function pickLanguage(language) {
    setForm((f) => ({ ...f, language }))
    dispatch(setLanguage(language))
  }

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setSaved(false)
    try {
      await settingsApi.update({
        theme: form.theme,
        fontSize: form.fontSize,
        language: form.language,
        notifications: form.notifications,
        statusVisibility: form.statusVisibility,
        contributionVisibility: form.contributionVisibility,
        inferWorkMode: form.inferWorkMode,
      })
      dispatch(pushToast('Settings saved', 'success'))
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      dispatch(pushToast(errorMessage(err), 'error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <h1><Settings size={20} aria-hidden="true" /> Settings</h1>

      <form onSubmit={submit}>
        <section className="panel">
          <div className="panel-head"><h3>Appearance</h3></div>
          <div role="radiogroup" aria-label="Theme" className="fs-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {THEME_OPTIONS.map((t) => (
              <label
                key={t.id}
                className={`fs-btn${form.theme === t.id ? ' primary' : ''}`}
                style={{ cursor: 'pointer' }}
                title={t.hint}
              >
                <input
                  type="radio"
                  name="theme"
                  value={t.id}
                  checked={form.theme === t.id}
                  onChange={() => pickTheme(t.id)}
                  style={{ position: 'absolute', opacity: 0, width: 1, height: 1 }}
                />
                {t.label}
              </label>
            ))}
          </div>
          <p className="fs-muted" style={{ fontSize: 12, margin: '6px 0 12px' }}>
            {THEME_OPTIONS.find((t) => t.id === form.theme)?.hint || 'Applies to the whole app instantly.'}
          </p>

          <Field label={`Font size: ${form.fontSize}px`} htmlFor="font-size">
            <input
              id="font-size"
              type="range"
              min="12"
              max="22"
              step="1"
              value={form.fontSize}
              onChange={(e) => pickFontSize(Number(e.target.value))}
              style={{ width: 220 }}
            />
          </Field>
        </section>

        <section className="panel">
          <div className="panel-head"><h3>Notifications</h3></div>
          <p className="fs-muted" style={{ marginTop: 0 }}>
            Choose which events create in-app notifications. Saved preferences are applied when notifications are delivered.
          </p>
          <div style={{ display: 'grid', gap: 8, maxWidth: 480 }}>
            {NOTIFICATION_OPTIONS.map((opt) => (
              <label key={opt.id} className="fs-row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <input
                  type="checkbox"
                  checked={form.notifications[opt.id]}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      notifications: { ...f.notifications, [opt.id]: e.target.checked },
                    }))
                  }
                  style={{ marginTop: 3 }}
                />
                <span>
                  <span style={{ display: 'block' }}>{opt.label}</span>
                  <span className="fs-muted" style={{ fontSize: 12 }}>{opt.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-head"><h3>Language</h3></div>
          <Field label="Display language" htmlFor="lang" hint="Only languages with complete translations are offered.">
            <select
              id="lang"
              className="fs-select"
              style={{ maxWidth: 280 }}
              value={form.language}
              onChange={(e) => pickLanguage(e.target.value)}
            >
              {(languages.length ? languages : I18N_LANGUAGES).map((l) => (
                <option key={l.id} value={l.id}>{l.label}</option>
              ))}
            </select>
          </Field>
          {form.language === 'en' && (
            <p className="fs-muted" style={{ fontSize: 12, marginTop: 0 }}>
              English is the only fully supported language today. More will be added as their translations land.
            </p>
          )}
        </section>

        <section className="panel">
          <div className="panel-head"><h3>Privacy</h3></div>
          <div style={{ maxWidth: 480 }}>
            <Field label="Who can see your online status" htmlFor="st-vis">
              <select
                id="st-vis"
                className="fs-select"
                value={form.statusVisibility}
                onChange={(e) => setForm({ ...form, statusVisibility: e.target.value })}
              >
                {levels.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <span className="fs-help">{LEVEL_HELP[form.statusVisibility]}</span>
            </Field>
            <Field label="Who can see your work contributions" htmlFor="co-vis">
              <select
                id="co-vis"
                className="fs-select"
                value={form.contributionVisibility}
                onChange={(e) => setForm({ ...form, contributionVisibility: e.target.value })}
              >
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
          </div>
        </section>

        <div className="fs-row" style={{ gap: 8, marginTop: 4 }}>
          <button type="submit" className="fs-btn primary" disabled={busy}>
            {saved ? <Check size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
            {busy ? 'Saving…' : saved ? 'Saved' : 'Save settings'}
          </button>
        </div>
      </form>
    </div>
  )
}
