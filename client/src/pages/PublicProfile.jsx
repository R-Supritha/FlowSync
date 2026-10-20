import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { GitPullRequest } from 'lucide-react'
import { profileApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { formatDate } from '../utils/format'
import { Avatar, Chip, EmptyState, ErrorState, Spinner } from '../components/ui'

export default function PublicProfile() {
  const { id: userId } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')

  async function load() {
    try {
      setData(await profileApi.user(userId))
      setStatus('ready')
    } catch (e) {
      setError(errorMessage(e, 'This profile is not visible to you'))
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
  }, [userId])

  if (status === 'loading') return <Spinner label="Loading profile…" />
  if (status === 'error') return <ErrorState message={error} onRetry={load} />

  const { user, workspaces, projects } = data

  return (
    <div className="page">
      <div className="fs-row" style={{ gap: 16, alignItems: 'center' }}>
        <Avatar name={user.name} src={user.avatarUrl || undefined} size={56} />
        <div>
          <h1 style={{ marginBottom: 0 }}>{user.name}</h1>
          {user.bio && <p className="fs-muted" style={{ marginTop: 4 }}>{user.bio}</p>}
        </div>
      </div>

      {(user.skills || []).length > 0 && (
        <section className="panel" style={{ marginTop: 24 }}>
          <div className="panel-head"><h3>Skills</h3></div>
          <div className="fs-row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {user.skills.map((s) => <Chip key={s}>{s}</Chip>)}
          </div>
        </section>
      )}

      <section className="panel" style={{ marginTop: 24 }}>
        <div className="panel-head"><h3>Shared workspaces</h3></div>
        {workspaces.length === 0 && <EmptyState title="No shared workspaces" />}
        <ul className="member-list">
          {workspaces.map((w) => (
            <li key={w._id} className="member-list-item">
              <span className="ellipsis">{w.name}</span>
              <span className="badge">{w.role}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel" style={{ marginTop: 24 }}>
        <div className="panel-head"><h3>Projects in shared workspaces</h3></div>
        {projects.length === 0 && <EmptyState title="No active projects" />}
        {projects.length > 0 && (
          <>
            {user.githubUsername && (
              <p className="fs-muted" style={{ margin: 0, marginBottom: 12 }}>
                <GitPullRequest size={13} aria-hidden="true" /> {user.githubUsername}
              </p>
            )}
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
          </>
        )}
      </section>

      <p className="fs-muted" style={{ fontSize: 12 }}>Joined {formatDate(user.createdAt)}</p>
    </div>
  )
}