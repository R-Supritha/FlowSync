import { useNavigate } from 'react-router-dom'
import { useSelector } from 'react-redux'
import { NewProjectModal } from '../components/dialogs'
import { selectCurrentWorkspace } from '../store/workspacesSlice'
import { EmptyState } from '../components/ui'

export default function NewProjectPage() {
  const navigate = useNavigate()
  const workspace = useSelector(selectCurrentWorkspace)
  if (!workspace) return <EmptyState title="No workspace selected" />
  return <NewProjectModal workspaceId={workspace._id} onClose={() => navigate('/projects')} />
}