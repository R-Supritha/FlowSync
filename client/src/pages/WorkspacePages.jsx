import { useState } from 'react'
import { useSelector } from 'react-redux'
import ActivityFeed from '../components/ActivityFeed'
import AnalyticsView from '../components/AnalyticsView'
import CalendarView from '../components/CalendarView'
import { EmptyState } from '../components/ui'

export function WorkspaceCalendar() {
  const id = useSelector((s) => s.workspaces.currentId)
  if (!id) return <EmptyState title="No workspace selected">Create a workspace from the sidebar.</EmptyState>
  return <CalendarView scope="workspace" id={id} />
}

export function WorkspaceActivity() {
  const id = useSelector((s) => s.workspaces.currentId)
  if (!id) return <EmptyState title="No workspace selected">Create a workspace from the sidebar.</EmptyState>
  return (
    <div className="page">
      <h1>Activity</h1>
      <ActivityFeed scope="workspace" id={id} />
    </div>
  )
}

// Analytics of any project in the workspace, picked from a list.
export function WorkspaceAnalytics() {
  const projects = useSelector((s) => s.projects.active)
  const [picked, setPicked] = useState('')
  const projectId = picked || projects[0]?._id
  if (!projectId) return <EmptyState title="No projects yet">Create a project to see its analytics.</EmptyState>
  return (
    <div>
      <div className="page" style={{ paddingBottom: 0 }}>
        <label className="fs-label" htmlFor="an-project">Project</label>
        <select id="an-project" className="fs-select" style={{ maxWidth: 320 }} value={projectId} onChange={(e) => setPicked(e.target.value)}>
          {projects.map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
        </select>
      </div>
      <AnalyticsView projectId={projectId} />
    </div>
  )
}
