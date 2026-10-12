import { useSelector } from 'react-redux'
import { EmptyState } from '../components/ui'
import WorkspaceAnalytics from '../components/analytics/WorkspaceAnalytics'

export default function Analytics() {
  const workspaceId = useSelector((s) => s.workspaces.currentId)
  if (!workspaceId) return <EmptyState title="No workspace selected" />
  return <WorkspaceAnalytics />
}