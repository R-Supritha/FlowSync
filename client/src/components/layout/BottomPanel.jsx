import { useDispatch, useSelector } from 'react-redux'
import { X } from 'lucide-react'
import { PANEL_TABS, setPanelTab, togglePanel } from '../../store/uiSlice'
import ActivityFeed from '../activity/ActivityFeed'
import GitHubOverview from '../github/GitHubOverview'
import WorkspaceAnalytics from '../analytics/WorkspaceAnalytics'
import ContributionDots from '../contributions/ContributionDots'
import { EmptyState } from '../ui'

export default function BottomPanel() {
  const dispatch = useDispatch()
  const panelTab = useSelector((s) => s.ui.panelTab)
  const workspaceId = useSelector((s) => s.workspaces.currentId)
  const me = useSelector((s) => s.presence.me)
  const authUserId = useSelector((s) => s.auth.user?.id)
  const userId = me?._id || me?.user?._id || authUserId

  return (
    <section className="bottom-panel" aria-label="Bottom panel">
      <div className="panel-tabs" role="tablist" aria-label="Bottom panel views">
        {PANEL_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={panelTab === t.id}
            className={`panel-tab${panelTab === t.id ? ' active' : ''}`}
            onClick={() => dispatch(setPanelTab(t.id))}
          >
            {t.label}
          </button>
        ))}
        <button type="button" className="fs-btn small ghost panel-close" aria-label="Close bottom panel" onClick={() => dispatch(togglePanel(false))}>
          <X size={14} aria-hidden="true" />
        </button>
      </div>

      <div className="panel-body">
        {panelTab === 'activity' &&
          (workspaceId ? <ActivityFeed scope="workspace" id={workspaceId} compact /> : <EmptyState title="No workspace selected" />)}

        {panelTab === 'github' &&
          (workspaceId ? <GitHubOverview compact /> : <EmptyState title="No workspace selected" />)}

        {panelTab === 'analytics' &&
          (workspaceId ? <WorkspaceAnalytics compact /> : <EmptyState title="No workspace selected" />)}

        {panelTab === 'contributions' &&
          (userId && workspaceId ? (
            <ContributionDots userId={userId} workspaceId={workspaceId} />
          ) : (
            <EmptyState title="Not signed in" />
          ))}
      </div>
    </section>
  )
}