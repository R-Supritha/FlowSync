import { useSelector } from 'react-redux'
import { useOutletContext } from 'react-router-dom'
import { canWrite } from '../utils/roles'
import ActivityFeed from '../components/ActivityFeed'
import AnalyticsView from '../components/AnalyticsView'
import CalendarView from '../components/CalendarView'
import Files from '../components/Files'

export function ProjectCalendar() {
  const { project } = useOutletContext()
  return <CalendarView scope="project" id={project._id} />
}

export function ProjectActivity() {
  const { project } = useOutletContext()
  return (
    <div className="page">
      <h1>Activity</h1>
      <ActivityFeed scope="project" id={project._id} />
    </div>
  )
}

export function ProjectAnalytics() {
  const { project } = useOutletContext()
  return <AnalyticsView projectId={project._id} />
}

export function ProjectFiles() {
  const { project, role } = useOutletContext()
  const me = useSelector((s) => s.auth.user?.id)
  return (
    <div className="page">
      <h1>Files</h1>
      <Files scope="project" id={project._id} role={role} me={me} canUpload={canWrite(role) && !project.isArchived} />
    </div>
  )
}
