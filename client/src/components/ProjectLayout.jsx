import { useSelector } from 'react-redux'
import { NavLink, Outlet, useParams } from 'react-router-dom'
import { projectApi } from '../api/endpoints'
import useAsync from '../hooks/useAsync'
import { selectRoleIn } from '../store/workspacesSlice'
import { ErrorState, Spinner } from './ui'

const TABS = [
  ['board', 'Board'], ['calendar', 'Calendar'], ['activity', 'Activity'], ['analytics', 'Analytics'],
  ['github', 'GitHub'], ['files', 'Files'], ['milestones', 'Milestones'], ['teams', 'Teams'],
]

// The frame around every project screen: a tab strip, and the project made available to the tab.
export default function ProjectLayout() {
  const { projectId } = useParams()
  const { data, error, loading, reload } = useAsync(() => projectApi.get(projectId), [projectId])
  const project = data?.project
  const role = useSelector((s) => (project ? selectRoleIn(s, project.workspace) : null))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <nav className="tabs" aria-label="Project views">
        {TABS.map(([path, label]) => (
          <NavLink key={path} to={`/projects/${projectId}/${path}`} className={({ isActive }) => `tab${isActive ? ' active' : ''}`}>
            {label}
          </NavLink>
        ))}
      </nav>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {error && <ErrorState message={error} onRetry={reload} />}
        {loading && !data && <Spinner label="Loading project…" />}
        {project && <Outlet context={{ project, role, reload }} />}
      </div>
    </div>
  )
}
