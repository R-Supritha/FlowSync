import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { Boxes, CalendarPlus, Eye, EyeOff, Sparkles } from 'lucide-react'
import { fetchProjects } from '../store/projectsSlice'
import { selectCurrentWorkspace, selectMyRole } from '../store/workspacesSlice'
import { canManageColumns } from '../utils/roles'
import { formatDate } from '../utils/format'
import { EmptyState, Spinner } from '../components/ui'

export default function Projects() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const workspace = useSelector(selectCurrentWorkspace)
  const role = useSelector(selectMyRole)
  const active = useSelector((s) => s.projects.active)
  const archived = useSelector((s) => s.projects.archived)
  const status = useSelector((s) => s.projects.status)
  const [showArchived, setShowArchived] = useState(false)

  if (!workspace) {
    return status === 'loading' ? <Spinner label="Loading projects…" /> : <EmptyState title="No workspace selected" />
  }

  const archiveChanged = async (e) => {
    const next = e.target.checked
    setShowArchived(next)
    await dispatch(fetchProjects({ workspaceId: workspace._id, archived: next }))
  }

  const list = showArchived ? archived : active
  const manager = canManageColumns(role)

  return (
    <div className="page">
      <div className="fs-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1>Projects</h1>
          <p className="fs-muted" style={{ marginTop: 0 }}>Boards live in {workspace.name}.</p>
        </div>
        <div className="fs-row" style={{ gap: 8 }}>
          <label className="fs-row" style={{ gap: 4, fontSize: 13 }}>
            <input type="checkbox" checked={showArchived} onChange={archiveChanged} />
            Show archived
          </label>
          {manager && (
            <>
              <button type="button" className="fs-btn" onClick={() => navigate('/projects/new/ai')}>
                <Sparkles size={14} aria-hidden="true" /> Generate with AI
              </button>
              <button type="button" className="fs-btn primary" onClick={() => navigate('/projects/new')}>
                <Boxes size={14} aria-hidden="true" /> New project
              </button>
            </>
          )}
        </div>
      </div>

      {list.length === 0 && (
        <EmptyState title={showArchived ? 'Nothing archived yet' : 'No projects yet'}>
          {showArchived ? 'Move in progress.' : 'Create your first project to start shipping.'}
        </EmptyState>
      )}

      <div className="project-grid">
        {list.map((p) => {
          const total = (p.milestones || []).length
          const done = (p.milestones || []).filter((m) => m.completed).length
          return (
            <button key={p._id} type="button" className={p.isArchived ? 'project-card archived' : 'project-card'} onClick={() => navigate(`/projects/${p._id}/board`)}>
              <div className="fs-row" style={{ justifyContent: 'space-between' }}>
                <strong className="ellipsis">{p.name}</strong>
                {p.isArchived ? <EyeOff size={14} aria-hidden="true" className="fs-muted" /> : <Eye size={14} aria-hidden="true" className="fs-muted" />}
              </div>
              <p className="fs-muted ellipsis">{p.description || 'No description'}</p>
              <div className="fs-muted" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', fontSize: 12 }}>
                <span><CalendarPlus size={12} aria-hidden="true" /> {formatDate(p.deadline) || 'no deadline'}</span>
                <span>{total ? `${done}/${total} milestones` : 'no milestones'}</span>
                <span className="badge">{p.template}</span>
              </div>
            </button>
          )
        })}
      </div>

      {active.some((p) => !p.isArchived) && archived.length > 0 && !showArchived && (
        <p className="fs-muted" style={{ fontSize: 12 }}>Archived projects are hidden — tick “Show archived”.</p>
      )}
      <Link to="/projects" style={{ display: 'none' }} aria-hidden="true">.</Link>
    </div>
  )
}