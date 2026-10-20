import { useCallback, useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { GitPullRequest, Link2 } from 'lucide-react'
import { githubApi } from '../../api/endpoints'
import { relativeTime } from '../../utils/format'
import { EmptyState, Spinner } from '../ui'

// Workspace-wide GitHub status (used on /github and inside the bottom panel).
// Fetching each project's link separately is acceptable at workspace scale.
export default function GitHubOverview({ compact = false }) {
  const projects = useSelector((s) => s.projects.active)
  const [byProject, setByProject] = useState({})
  const [syncId, setSyncId] = useState(null)

  const loadAll = useCallback(
    async (ids) => {
      const updates = {}
      const limited = ids.slice(0, 30)
      await Promise.all(
        limited.map(async (id) => {
          try {
            const res = await githubApi.get(id)
            updates[id] = { state: 'ready', link: res.linked ? res.link : null }
          } catch {
            updates[id] = { state: 'error' }
          }
        }),
      )
      for (const id of ids.slice(30)) updates[id] = { state: 'ready', link: null }
      setByProject((prev) => ({ ...prev, ...updates }))
    },
    [],
  )

  useEffect(() => {
    let alive = true
    const ids = projects.map((p) => p._id)
    ;(async () => {
      await Promise.resolve()
      if (!alive) return
      await loadAll(ids)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects])

  if (!projects.length) {
    return compact ? null : <EmptyState title="No projects yet" />
  }
  if (projects.some((p) => !byProject[p._id]?.state || byProject[p._id].state === 'loading')) {
    return <Spinner label="Checking repositories…" />
  }

  const linked = projects.filter((p) => byProject[p._id]?.link)
  const unlinked = projects.filter((p) => !byProject[p._id]?.link)

  return (
    <div className={compact ? 'github-overview compact' : 'github-overview'}>
      <div className="panel-head">
        <h3><GitPullRequest size={15} aria-hidden="true" /> Linked repositories</h3>
      </div>
      {linked.length === 0 && (
        <EmptyState title="Nothing linked yet">
          Managers can link a GitHub repo from a project's GitHub view.
        </EmptyState>
      )}
      <div className="repo-table-wrap">
        <table className="repo-table">
          <thead>
            <tr><th>Project</th><th>Repository</th><th>Branch</th><th>Last synced</th>{!compact && <th>Sync</th>}</tr>
          </thead>
          <tbody>
            {linked.map((p) => {
              const link = byProject[p._id].link
              return (
                <tr key={p._id}>
                  <td className="ellipsis">{p.name}</td>
                  <td><code>{link.repo}</code></td>
                  <td>{link.defaultBranch}</td>
                  <td>{link.lastSyncedAt ? relativeTime(link.lastSyncedAt) : 'never'}</td>
                  {!compact && (
                    <td>
                      <button type="button" className="fs-btn small" disabled={syncId === p._id} onClick={async () => {
                        setSyncId(p._id)
                        try {
                          const res = await githubApi.sync(p._id)
                          const summary = res.lastSyncSummary || res.recorded
                          const state = byProject[p._id]
                          setByProject((prev) => ({
                            ...prev,
                            [p._id]: { ...state, link: { ...link, lastSyncedAt: res.lastSyncedAt } },
                          }))
                          alert(`Synced ${res.repo}\n${summary.commits} commits, ${summary.prsOpened} PRs opened, ${summary.prsMerged} merged`)
                        } catch {
                          setByProject((prev) => ({ ...prev, [p._id]: byProject[p._id] }))
                          alert('Sync failed — open the project GitHub view for details.')
                        } finally {
                          setSyncId(null)
                        }
                      }}>
                        {syncId === p._id ? 'Syncing…' : 'Sync'}
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!compact && unlinked.length > 0 && (
        <>
          <div className="panel-head"><h3>Unlinked projects</h3></div>
          <div className="unlinked-list">
            {unlinked.map((p) => (
              <span key={p._id} className="unlinked-chip" title="Link from the project's GitHub view">
                <Link2 size={13} aria-hidden="true" /> {p.name}
              </span>
            ))}
          </div>
          <p className="fs-muted" style={{ fontSize: 12 }}>Open a project → GitHub to link a repository with a fine-grained token.</p>
        </>
      )}
    </div>
  )
}