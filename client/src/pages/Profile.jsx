import { useEffect, useRef, useState } from 'react'
import { useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { Check, GitPullRequest, Link as LinkIcon, Save, User } from 'lucide-react'
import { profileApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { pushToast } from '../store/uiSlice'
import { setUser } from '../store/authSlice'
import { avatarSrc } from '../utils/avatar'
import Achievements from '../components/Achievements'
import { formatDate } from '../utils/format'
import { Avatar, Chip, EmptyState, ErrorState, Field, Spinner } from '../components/ui'

const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
const MAX_PICTURE = 2 * 1024 * 1024

export default function Profile() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')

  const [form, setForm] = useState({ name: '', bio: '', avatarUrl: '', githubUsername: '', skills: '' })
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [pictureBusy, setPictureBusy] = useState(false)
  const [pictureError, setPictureError] = useState('')
  const fileInput = useRef(null)

  async function load() {
    try {
      const profile = await profileApi.me()
      setData(profile)
      setForm({
        name: profile.user.name,
        bio: profile.user.bio || '',
        avatarUrl: profile.user.avatarUrl || '',
        githubUsername: profile.user.githubUsername || '',
        skills: (profile.user.skills || []).join(', '),
      })
      setStatus('ready')
    } catch (e) {
      setError(errorMessage(e, 'Failed to load profile'))
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
  }, [])

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setSaved(false)
    const body = {
      name: form.name.trim(),
      bio: form.bio.trim(),
      githubUsername: form.githubUsername.trim(),
      skills: form.skills
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    }
    try {
      const res = await profileApi.update(body)
      setData((d) => ({ ...d, user: res.user }))
      dispatch(pushToast('Profile saved', 'success'))
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      dispatch(pushToast(errorMessage(e), 'error'))
    } finally {
      setBusy(false)
    }
  }

  async function choosePicture(e) {
    const file = e.target.files && e.target.files[0]
    e.target.value = '' // so the same file can be chosen again
    if (!file) return
    setPictureError('')
    if (!PICTURE_TYPES.includes(file.type)) return setPictureError('Choose a PNG, JPEG, GIF or WebP picture')
    if (file.size > MAX_PICTURE) return setPictureError('The picture must be at most 2 MB')
    setPictureBusy(true)
    try {
      const res = await profileApi.uploadAvatar(file)
      setData((d) => ({ ...d, user: { ...d.user, avatarUrl: res.user.avatarUrl } }))
      dispatch(setUser({ avatarUrl: res.user.avatarUrl }))
      dispatch(pushToast('Picture updated', 'success'))
    } catch (err) {
      setPictureError(errorMessage(err, 'Could not upload the picture'))
    } finally {
      setPictureBusy(false)
    }
  }

  async function removePicture() {
    setPictureError('')
    setPictureBusy(true)
    try {
      await profileApi.removeAvatar()
      setData((d) => ({ ...d, user: { ...d.user, avatarUrl: '' } }))
      dispatch(setUser({ avatarUrl: '' }))
      dispatch(pushToast('Picture removed', 'success'))
    } catch (err) {
      setPictureError(errorMessage(err, 'Could not remove the picture'))
    } finally {
      setPictureBusy(false)
    }
  }

  if (status === 'loading') return <Spinner label="Loading profile…" />
  if (status === 'error') return <ErrorState message={error} onRetry={load} />

  const { user, workspaces, projects, achievements } = data

  return (
    <div className="page">
      <h1><User size={20} aria-hidden="true" /> Profile</h1>

      <section className="panel">
        <div className="panel-head"><h3>About you</h3></div>
        <form onSubmit={submit} className="profile-grid">
          <div>
            <Field label="Name" htmlFor="pf-name"><input id="pf-name" className="fs-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Email" htmlFor="pf-email"><input id="pf-email" className="fs-input" value={user.email} disabled /></Field>
            <div className="field" style={{ marginBottom: 12 }}>
              <span className="fs-label">Profile picture</span>
              <div className="fs-row" style={{ gap: 12, alignItems: 'center' }}>
                <Avatar name={user.name} url={avatarSrc(user.avatarUrl)} size={64} />
                <div>
                  <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp" aria-label="Choose a picture" hidden onChange={choosePicture} />
                  <div className="fs-row" style={{ gap: 6 }}>
                    <button type="button" className="fs-btn small" disabled={pictureBusy} onClick={() => fileInput.current && fileInput.current.click()}>
                      {pictureBusy ? 'Working…' : user.avatarUrl ? 'Change picture' : 'Upload picture'}
                    </button>
                    {user.avatarUrl && <button type="button" className="fs-btn small ghost" disabled={pictureBusy} onClick={removePicture}>Remove picture</button>}
                  </div>
                  <span className="fs-muted" style={{ fontSize: 12 }}>PNG, JPEG, GIF or WebP, up to 2 MB.</span>
                  {pictureError && <p className="fs-error" role="alert" style={{ margin: '4px 0 0' }}>{pictureError}</p>}
                </div>
              </div>
            </div>
            <Field label="GitHub username" htmlFor="pf-gh">
              <input id="pf-gh" className="fs-input" value={form.githubUsername} placeholder="octocat" onChange={(e) => setForm({ ...form, githubUsername: e.target.value })} />
            </Field>
            <Field label="Skills (comma separated)" htmlFor="pf-skills">
              <input id="pf-skills" className="fs-input" value={form.skills} placeholder="React, Node.js, Figma" onChange={(e) => setForm({ ...form, skills: e.target.value })} />
            </Field>
            <Field label="Bio" htmlFor="pf-bio">
              <textarea id="pf-bio" className="fs-textarea" maxLength="500" value={form.bio} onChange={(e) => setForm({ ...form, bio: e.target.value })} />
            </Field>
            <button type="submit" className="fs-btn primary" disabled={busy}>
              {saved ? <Check size={14} aria-hidden="true" /> : <Save size={14} aria-hidden="true" />} {busy ? 'Saving…' : saved ? 'Saved' : 'Save profile'}
            </button>
          </div>

          <div>
            <h3 className="fs-label" style={{ marginBottom: 8 }}>Memberships</h3>
            {workspaces.length === 0 && <p className="fs-muted">Not part of any workspace yet.</p>}
            <ul className="member-list">
              {workspaces.map((w) => (
                <li key={w._id} className="member-list-item">
                  <span className="ellipsis">{w.name}</span>
                  <span className="badge">{w.role}</span>
                </li>
              ))}
            </ul>

            {(user.skills || []).length > 0 && (
              <>
                <h3 className="fs-label" style={{ margin: '16px 0 8px' }}>Skills</h3>
                <div className="fs-row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {user.skills.map((s) => <Chip key={s}>{s}</Chip>)}
                </div>
              </>
            )}
            {user.githubUsername && (
              <p className="fs-muted" style={{ marginTop: 16 }}>
                <GitPullRequest size={13} aria-hidden="true" /> {user.githubUsername}
              </p>
            )}
            <p className="fs-muted" style={{ marginTop: 8, fontSize: 12 }}>
              <LinkIcon size={12} aria-hidden="true" /> Member since {formatDate(user.createdAt)}
            </p>
          </div>
        </form>
      </section>

      <Achievements achievements={achievements} />

      <section className="panel">
        <div className="panel-head"><h3>Recent projects ({projects.length})</h3></div>
        {projects.length === 0 && <EmptyState title="No projects yet" />}
        <ul className="member-list">
          {projects.map((p) => (
            <li key={p._id} className="member-list-item">
              <button type="button" className="fs-row" style={{ gap: 8, background: 'none', border: 0, color: 'inherit', cursor: 'pointer', textAlign: 'left', flex: 1 }} onClick={() => navigate(`/projects/${p._id}/board`)}>
                <span className="ellipsis">{p.name}</span>
              </button>
              <span className="fs-muted">{p.deadline ? `Due ${formatDate(p.deadline)}` : 'No deadline'}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}