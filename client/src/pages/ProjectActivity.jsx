import { useDispatch } from 'react-redux'
import { useParams } from 'react-router-dom'
import { fetchProject } from '../store/projectsSlice'
import useProject from '../hooks/useProject'
import { ErrorState, Spinner } from '../components/ui'
import ActivityFeed from '../components/activity/ActivityFeed'

export default function ProjectActivity() {
  const { projectId } = useParams()
  const dispatch = useDispatch()
  const { project, error } = useProject(projectId)
  if (error && !project) return <ErrorState message={error} onRetry={() => dispatch(fetchProject(projectId))} />
  if (!project) return <Spinner label="Loading project…" />
  return (
    <div className="page">
      <ActivityFeed scope="project" id={projectId} />
    </div>
  )
}