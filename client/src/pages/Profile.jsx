import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useParams } from 'react-router-dom'
import { profileApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import useAsync from '../hooks/useAsync'
import { setUser } from '../store/authSlice'
import { pushToast } from '../store/uiSlice'
import ContributionDots from '../components/ContributionDots'
import { ErrorState, Spinner } from '../components/ui'

function validate(f) {
  if (!f.name.trim()) return 'Name is required'
  if (f.bio.length > 500) return 'The bio can be at most 500 characters'
  const skills = f.skills.split(',').map((s) => s.trim()).filter(Boolean)
  if (skills.length > 20) return 'Add at most 20 skills'
  if (skills.some((s) => s.length > 30)) return 'Each skill can be at most 30 characters'
  if (f.avatarUrl && !/^https?:\/\//i.test(f.avatarUrl)) return 'The picture link must start with http:// or https://'
  return ''
}

function EditForm({ user, workspaces, projects }) {
  const dispatch = useDispatch()
  const [form, setForm] = useState({
    name: user.name || '', bio: user.bio || '', skills: (user.skills || []).join(', '),
    avatarUrl: user.avatarUrl || '', githubUsername: user.githubUsername || '',
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    const problem = validate(form)
    if (problem) return setError(problem)
    setError('')
    setBusy(true)
    try {
      const res = await profileApi.update({
        name: form.name.trim(), bio: form.bio, avatarUrl: form.avatarUrl.trim(), githubUsername: form.githubUsername.trim(),
        skills: form.skills.split(',').map((s) => s.trim()).filter(Boolean),
      })
      dispatch(setUser({ name: res.user.name, email: res.user.email }))
      dispatch(pushToast('Profile saved', 'success'))
    } catch (err) {
      setError(errorMessage(err, 'Could not save the profile'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <form onSubmit={submit} noValidate className="panel-card" style={{ maxWidth: 560 }}>
        <p className="fs-muted" style={{ marginTop: 0 }}>{user.email}</p>
        <label className="fs-label" htmlFor="pf-name">Name</label>
        <input id="pf-name" className="fs-input" value={form.name} onChange={set('name')} />
        <label className="fs-label" htmlFor="pf-bio">Bio</label>
        <textarea id="pf-bio" className="fs-textarea" value={form.bio} onChange={set('bio')} />
        <label className="fs-label" htmlFor="pf-skills">Skills (comma separated)</label>
        <input id="pf-skills" className="fs-input" value={form.skills} onChange={set('skills')} />
        <label className="fs-label" htmlFor="pf-avatar">Picture link</label>
        <input id="pf-avatar" className="fs-input" placeholder="https://…" value={form.avatarUrl} onChange={set('avatarUrl')} />
        <label className="fs-label" htmlFor="pf-gh">GitHub username</label>
        <input id="pf-gh" className="fs-input" value={form.githubUsername} onChange={set('githubUsername')} />
        <p className="fs-muted" style={{ fontSize: '0.85em' }}>Your commits are credited to you when this matches your GitHub name.</p>
        {error && <p className="fs-error" role="alert">{error}</p>}
        <button type="submit" className="fs-btn primary" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</button>
      </form>
      <div className="card-grid" style={{ marginTop: 16 }}>
        <section className="panel-card" aria-label="Your workspaces">
          <h3>Your workspaces</h3>
          <ul className="list">{(workspaces || []).map((w) => <li key={w._id} className="list-row">{w.name}</li>)}</ul>
        </section>
        <section className="panel-card" aria-label="Your projects">
          <h3>Your projects</h3>
          <ul className="list">{(projects || []).map((p) => <li key={p._id} className="list-row"><Link to={`/projects/${p._id}/board`}>{p.name}</Link></li>)}</ul>
        </section>
      </div>
    </>
  )
}

export default function Profile() {
  const { id } = useParams()
  const me = useSelector((s) => s.auth.user?.id)
  const own = !id || id === me
  const { data, error, loading, reload } = useAsync(() => (own ? profileApi.me() : profileApi.user(id)), [own, id])

  if (error) return <ErrorState message={error} onRetry={reload} />
  if (loading || !data) return <Spinner label="Loading profile…" />
  const user = data.user

  return (
    <div className="page">
      <h1>{own ? 'Your profile' : user.name}</h1>
      {own ? <EditForm key={user._id} user={user} workspaces={data.workspaces} projects={data.projects} /> : (
        <section className="panel-card" style={{ maxWidth: 560 }}>
          <p className="fs-muted" style={{ marginTop: 0 }}>{user.email}</p>
          {user.bio && <p>{user.bio}</p>}
          {user.skills?.length > 0 && <div className="fs-row" style={{ flexWrap: 'wrap' }}>{user.skills.map((s) => <span key={s} className="badge">{s}</span>)}</div>}
          {user.githubUsername && <p>GitHub: @{user.githubUsername}</p>}
        </section>
      )}
      <div style={{ marginTop: 16, maxWidth: 560 }}>
        <ContributionDots userId={user._id} title={own ? 'Your week' : `${user.name}’s week`} />
      </div>
    </div>
  )
}
