import { useDispatch, useSelector } from 'react-redux'
import { useLocation, useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { closeTab } from '../../store/uiSlice'
import { selectCurrentWorkspace } from '../../store/workspacesSlice'
import { routeMeta } from '../../utils/nav'

export function Breadcrumbs() {
  const location = useLocation()
  const workspace = useSelector(selectCurrentWorkspace)
  const projects = useSelector((s) => s.projects.active)
  const currentProject = useSelector((s) => s.projects.current)

  const meta = routeMeta(location.pathname, projects)
  const parts = []
  if (workspace) parts.push(workspace.name)
  if (meta?.kind === 'project') {
    const project = projects.find((p) => p._id === meta.projectId) || currentProject
    if (project) parts.push(project.name)
    const view = location.pathname.split('/').pop()
    if (view && view !== 'board') parts.push(routeMeta(location.pathname, projects).label.split(' · ').pop())
  } else if (meta) {
    parts.push(meta.label)
  }

  if (!parts.length) return null

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      {[workspace ? 'FlowSync' : '', ...parts].filter(Boolean).map((c, i, arr) => (
        <span key={`${c}-${i}`} className="breadcrumb">
          {c}{i < arr.length - 1 && <span className="breadcrumb-sep">/</span>}
        </span>
      ))}
    </nav>
  )
}

export function EditorTabs() {
  const dispatch = useDispatch()
  const location = useLocation()
  const navigate = useNavigate()
  const tabs = useSelector((s) => s.ui.tabs)

  if (!tabs.length) return null

  return (
    <div className="editor-tabs" role="tablist" aria-label="Open pages">
      {tabs.map((t) => {
        const active = t.path === location.pathname
        return (
          <button
            key={t.path}
            type="button"
            role="tab"
            aria-selected={active}
            className={`editor-tab${active ? ' active' : ''}`}
            onClick={() => navigate(t.path)}
            onAuxClick={(e) => {
              if (e.button === 1) dispatch(closeTab(t.path))
            }}
          >
            {t.kind === 'project' && <span className="tab-glyph">◇</span>}
            <span className="ellipsis">{t.label}</span>
            <span
              role="button"
              tabIndex={-1}
              aria-label={`Close ${t.label}`}
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation()
                dispatch(closeTab(t.path))
              }}
            >
              <X size={12} aria-hidden="true" />
            </span>
          </button>
        )
      })}
    </div>
  )
}