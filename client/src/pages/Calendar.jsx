import { useSelector } from 'react-redux'
import { EmptyState } from '../components/ui'
import CalendarView from '../components/calendar/CalendarView'

export default function Calendar() {
  const workspaceId = useSelector((s) => s.workspaces.currentId)
  if (!workspaceId) return <EmptyState title="No workspace selected" />
  return (
    <div className="page">
      <CalendarView scope={{ type: 'workspace', id: workspaceId }} />
    </div>
  )
}