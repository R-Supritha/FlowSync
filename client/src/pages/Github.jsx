import { useSelector } from 'react-redux'
import { EmptyState } from '../components/ui'
import GitHubOverview from '../components/github/GitHubOverview'

export default function Github() {
  const workspaceId = useSelector((s) => s.workspaces.currentId)
  if (!workspaceId) return <EmptyState title="No workspace selected" />
  return (
    <div className="page">
      <h1>GitHub</h1>
      <p className="fs-muted" style={{ marginTop: 0 }}>
        Link repositories to projects to mirror commits, pull requests, issues and releases into the activity feed, and to follow new branches. Commits referencing a
        task's <code>FS-xxxxxx</code> ref move that task forward automatically.
      </p>
      <GitHubOverview />
    </div>
  )
}