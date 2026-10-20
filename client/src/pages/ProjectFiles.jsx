import { useDispatch, useSelector } from 'react-redux'
import { useParams } from 'react-router-dom'
import { fetchProject } from '../store/projectsSlice'
import useProject from '../hooks/useProject'
import { canWrite } from '../utils/roles'
import Files from '../components/Files'
import { ErrorState, Spinner } from '../components/ui'

export default function ProjectFiles() {
  const { projectId } = useParams()
  const dispatch = useDispatch()
  const { project, role, error } = useProject(projectId)
  const me = useSelector((s) => s.auth.user?.id)

  if (error && !project) return <ErrorState message={error} onRetry={() => dispatch(fetchProject(projectId))} />
  if (!project) return <Spinner label="Loading project…" />

  return (
    <div className="page">
      <h1>Files</h1>
      <Files scope="project" id={projectId} role={role} me={me} canUpload={canWrite(role) && !project.isArchived} />
    </div>
  )
}
