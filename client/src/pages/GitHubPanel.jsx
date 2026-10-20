import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { useOutletContext } from 'react-router-dom'
import { githubApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import useAsync from '../hooks/useAsync'
import { pushToast } from '../store/uiSlice'
import { canWrite, isManager } from '../utils/roles'
import { formatDateTime } from '../utils/format'
import { ConfirmDialog, ErrorState, Spinner } from '../components/ui'

function LinkForm({ projectId, onLinked }) {
  const dispatch = useDispatch()
  const [repo, setRepo] = useState('')
  const [token, setToken] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!repo.trim()) return setError('Enter the repository, for example owner/name')
    if (!token.trim()) return setError('Paste a GitHub access token')
    setBusy(true)
    setError('')
    try {
      await githubApi.link(projectId, { repo: repo.trim(), token: token.trim() })
      setToken('')
      dispatch(pushToast('Repository linked', 'success'))
      onLinked()
    } catch (err) {
      setError(errorMessage(err, 'Could not link the repository'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="panel-card" style={{ maxWidth: 520 }}>
      <h3>Link a GitHub repository</h3>
      <label className="fs-label" htmlFor="gh-repo">Repository</label>
      <input id="gh-repo" className="fs-input" placeholder="owner/name or a github.com link" value={repo} onChange={(e) => setRepo(e.target.value)} />
      <label className="fs-label" htmlFor="gh-token">Access token</label>
      <input id="gh-token" type="password" autoComplete="off" className="fs-input" placeholder="github_pat_…" value={token} onChange={(e) => setToken(e.target.value)} />
      <p className="fs-muted" style={{ fontSize: '0.85em' }}>
        Use a fine-grained token limited to this one repository, with Contents and Pull requests set to read-only.
        It is stored encrypted and is never shown again.
      </p>
      {error && <p className="fs-error" role="alert">{error}</p>}
      <button type="submit" className="fs-btn primary" disabled={busy}>{busy ? 'Checking with GitHub…' : 'Link repository'}</button>
    </form>
  )
}

function SyncResult({ result }) {
  const r = result.recorded
  return (
    <section className="panel-card" aria-label="Sync result" style={{ marginTop: 12 }}>
      <h3>Sync result</h3>
      <p style={{ margin: '0 0 6px' }}>
        Recorded {r.commits} commit{r.commits === 1 ? '' : 's'}, {r.prsOpened} pull request{r.prsOpened === 1 ? '' : 's'} opened,
        {' '}{r.prsMerged} merged. Skipped {result.skippedAlreadyRecorded} already recorded.
      </p>
      {result.tasksMoved.length > 0 && (
        <>
          <div className="fs-label">Tasks moved</div>
          <ul className="list">
            {result.tasksMoved.map((m) => (
              <li key={`${m.ref}-${m.to}`} className="list-row">
                <span className="task-ref">{m.ref}</span> <span>{m.title}</span>
                <span style={{ flex: 1 }} />
                <span className="badge">{m.from} → {m.to}</span>
                <span className="fs-muted">{m.because}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      {result.taskLinkNotes.length > 0 && (
        <>
          <div className="fs-label">Notes</div>
          <ul>{result.taskLinkNotes.map((n) => <li key={n}>{n}</li>)}</ul>
        </>
      )}
      {result.unmatchedGithubUsers.length > 0 && (
        <p className="fs-muted">
          No FlowSync profile matches {result.unmatchedGithubUsers.map((u) => `@${u}`).join(', ')}. Set the GitHub username on
          their profile so their commits are credited to them.
        </p>
      )}
    </section>
  )
}

export default function GitHubPanel() {
  const { project, role } = useOutletContext()
  const dispatch = useDispatch()
  const link = useAsync(() => githubApi.get(project._id), [project._id])
  const refs = useAsync(() => githubApi.refs(project._id), [project._id])
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)

  async function sync() {
    setBusy(true)
    try {
      const res = await githubApi.sync(project._id)
      setResult(res)
      link.reload()
      refs.reload()
      dispatch(pushToast(res.tasksMoved.length ? `${res.tasksMoved.length} task(s) moved` : 'Sync finished', 'success'))
    } catch (e) {
      dispatch(pushToast(errorMessage(e, 'Sync failed'), 'error'))
    } finally {
      setBusy(false)
    }
  }

  async function unlink() {
    setBusy(true)
    try {
      await githubApi.unlink(project._id)
      dispatch(pushToast('Repository unlinked', 'success'))
      setConfirm(false)
      setResult(null)
      link.reload()
    } catch (e) {
      dispatch(pushToast(errorMessage(e), 'error'))
    } finally {
      setBusy(false)
    }
  }

  async function copy(ref) {
    try {
      await navigator.clipboard.writeText(ref)
      dispatch(pushToast(`Copied ${ref}`, 'success'))
    } catch {
      dispatch(pushToast('Could not copy to the clipboard', 'error'))
    }
  }

  if (link.error) return <ErrorState message={link.error} onRetry={link.reload} />
  if (link.loading && !link.data) return <Spinner label="Checking the GitHub link…" />

  const info = link.data.link
  const s = info?.lastSyncSummary
  return (
    <div className="page">
      <h1>GitHub</h1>
      {!link.data.linked && (isManager(role)
        ? <LinkForm projectId={project._id} onLinked={link.reload} />
        : <p className="fs-muted">This project is not linked to a GitHub repository. An Admin or Manager can link one.</p>)}

      {link.data.linked && (
        <section className="panel-card" aria-label="Linked repository">
          <h3>{info.repo}</h3>
          <div className="fs-muted">
            Default branch {info.defaultBranch}. Linked by {info.linkedBy?.name || 'someone'}.{' '}
            {info.lastSyncedAt ? `Last synced ${formatDateTime(info.lastSyncedAt)}.` : 'Never synced.'}
          </div>
          {s && info.lastSyncedAt && <div className="fs-muted">Last sync recorded {s.commits ?? 0} commits, {s.prsOpened ?? 0} pull requests opened, {s.prsMerged ?? 0} merged.</div>}
          <div className="fs-row" style={{ marginTop: 10 }}>
            {canWrite(role) && <button type="button" className="fs-btn primary" disabled={busy} onClick={sync}>{busy ? 'Syncing…' : 'Sync now'}</button>}
            {isManager(role) && <button type="button" className="fs-btn danger" disabled={busy} onClick={() => setConfirm(true)}>Unlink</button>}
          </div>
        </section>
      )}

      {result && <SyncResult result={result} />}

      <section className="panel-card" style={{ marginTop: 12 }} aria-label="Task references">
        <h3>Task references</h3>
        <p className="fs-muted" style={{ marginTop: 0 }}>
          Put a task’s reference in a commit message, branch name or pull request title. A commit moves the task to In Progress,
          an opened pull request to Review, and a merged one to Done.
        </p>
        {refs.error && <p className="fs-error" role="alert">{refs.error}</p>}
        {refs.data && (
          <table className="fs-table">
            <thead><tr><th>Reference</th><th>Task</th><th>Status</th><th /></tr></thead>
            <tbody>
              {refs.data.tasks.map((t) => (
                <tr key={t._id}>
                  <td><span className="task-ref">{t.ref}</span></td><td>{t.title}</td><td>{t.status}</td>
                  <td><button type="button" className="fs-btn small" aria-label={`Copy ${t.ref}`} onClick={() => copy(t.ref)}>Copy</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {confirm && (
        <ConfirmDialog danger busy={busy} title="Unlink repository?" confirmLabel="Unlink"
          message="Activity already recorded is kept, but new commits will no longer be synced." onCancel={() => setConfirm(false)} onConfirm={unlink} />
      )}
    </div>
  )
}
