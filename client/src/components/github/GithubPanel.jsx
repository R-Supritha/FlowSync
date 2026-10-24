import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { GitPullRequest, RefreshCw, Unplug } from 'lucide-react'
import { githubApi } from '../../api/endpoints'
import { errorMessage } from '../../api/client'
import { pushToast } from '../../store/uiSlice'
import { canLinkGithub } from '../../utils/roles'
import { selectRoleIn } from '../../store/workspacesSlice'
import { relativeTime } from '../../utils/format'
import { EmptyState, ErrorState, Spinner } from '../ui'
import LinkGitHubModal from './LinkGitHubModal'

// Full GitHub integration for a single project (used on /projects/:id/github).
export default function GithubPanel({ projectId }) {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const workspaceId = useSelector((s) => s.projects.current?.workspace)
  const role = useSelector((s) => (workspaceId ? selectRoleIn(s, workspaceId) : null))

  const [link, setLink] = useState(null)
  const [status, setStatus] = useState('loading')
  const [error, setError] = useState('')
  const [showLink, setShowLink] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [refs, setRefs] = useState(null)

  async function load() {
    try {
      const res = await githubApi.get(projectId)
      setLink(res.linked ? res.link : null)
      if (res.linked) {
        githubApi.taskRefs(projectId).then((r) => setRefs(r)).catch(() => setRefs(null))
      }
      setStatus('ready')
    } catch (e) {
      setError(errorMessage(e, 'Failed to load repository link'))
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
  }, [projectId])

  async function sync() {
    setSyncing(true)
    try {
      const res = await githubApi.sync(projectId)
      const moved = (res.tasksMoved || []).length
      const ignored = (res.skippedNoChanges?.commits || 0) + (res.skippedNoChanges?.pullRequests || 0)
      dispatch(
        pushToast(
          `Synced ${res.repo}: ${res.recorded.commits} commits, ${res.recorded.prsOpened} PRs opened, ${res.recorded.prsMerged} merged` +
            (moved ? `; ${moved} task${moved === 1 ? '' : 's'} moved` : ''),
          'success',
        ),
      )
      // Empty commits / pull requests (no changed files) are not counted as progress. Say so, otherwise
      // a commit that "did nothing" would look like a bug.
      if (ignored) {
        const why = (res.taskLinkNotes || []).slice(0, 2).join(' ')
        dispatch(pushToast(`${ignored} empty commit${ignored === 1 ? '' : 's'} or pull request${ignored === 1 ? '' : 's'} ignored (no file changes).${why ? ' ' + why : ''}`, 'info'))
      }
      load()
    } catch (e) {
      dispatch(pushToast(errorMessage(e, 'Sync failed'), 'error'))
    } finally {
      setSyncing(false)
    }
  }

  async function unlink() {
    if (!window.confirm('Unlink this repository? Activity already recorded is kept.')) return
    try {
      await githubApi.unlink(projectId)
      dispatch(pushToast('Repository unlinked', 'success'))
      setLink(null)
      setRefs(null)
    } catch (e) {
      dispatch(pushToast(errorMessage(e), 'error'))
    }
  }

  if (status === 'loading') return <Spinner label="Loading repository link…" />
  if (status === 'error') return <ErrorState message={error} onRetry={load} />

  if (!link) {
    const canLink = canLinkGithub(role)
    return (
      <div className="page">
        <EmptyState title="No repository linked" action={canLink ? <button type="button" className="fs-btn primary" onClick={() => setShowLink(true)}>Link GitHub repository</button> : null}>
          {canLink
            ? 'Link a GitHub repository to mirror commits and pull requests into the activity feed.'
            : 'A Manager or Admin can link a repository for this project.'}
        </EmptyState>
        {showLink && <LinkGitHubModal projectId={projectId} onClose={() => setShowLink(false)} onLinked={load} />}
      </div>
    )
  }

  return (
    <div className="page">
      <div className="panel">
        <div className="panel-head">
          <h3>
            <GitPullRequest size={16} aria-hidden="true" /> {link.repo}
          </h3>
          <div className="fs-row" style={{ gap: 8 }}>
            <button type="button" className="fs-btn small primary" disabled={syncing} onClick={sync}>
              <RefreshCw size={13} aria-hidden="true" /> {syncing ? 'Syncing…' : 'Sync now'}
            </button>
            {canLinkGithub(role) && (
              <button type="button" className="fs-btn small danger-outline" onClick={unlink}>
                <Unplug size={13} aria-hidden="true" /> Unlink
              </button>
            )}
          </div>
        </div>

        <dl className="kv">
          <div><dt>Default branch</dt><dd>{link.defaultBranch}</dd></div>
          <div><dt>Linked</dt><dd>{relativeTime(link.linkedAt)}</dd></div>
          <div><dt>Last synced</dt><dd>{link.lastSyncedAt ? relativeTime(link.lastSyncedAt) : 'never'}</dd></div>
          {link.lastSyncSummary && (
            <div>
              <dt>Last sync</dt>
              <dd>
                {link.lastSyncSummary.commits} commits, {link.lastSyncSummary.prsOpened} PRs opened,{' '}
                {link.lastSyncSummary.prsMerged} merged
              </dd>
            </div>
          )}
        </dl>
      </div>

      {refs && (
        <div className="panel">
          <div className="panel-head"><h3>Task references</h3></div>
          <p className="fs-muted" style={{ marginTop: 0 }}>{refs.howTo}</p>
          <div className="ref-grid">
            {refs.tasks.slice(0, 50).map((t) => (
              <button key={t._id} type="button" className="ref-chip" onClick={() => navigate(`/projects/${projectId}/board`)}>
                <code>{t.ref}</code>
                <span className="ellipsis">{t.title}</span>
                <span className="badge">{t.status}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}