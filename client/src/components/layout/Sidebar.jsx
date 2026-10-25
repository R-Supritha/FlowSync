import { avatarSrc } from '../../utils/avatar'
import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { NavLink, useLocation } from 'react-router-dom'
import { Boxes, ChevronDown, ChevronRight, Milestone, Plus, Sparkles, Users } from 'lucide-react'
import {
  selectCurrentWorkspace,
  selectMyRole,
  setCurrentWorkspace,
} from '../../store/workspacesSlice'
import { fetchProjects } from '../../store/projectsSlice'
import { canInviteMembers, canManageColumns } from '../../utils/roles'
import { STATUS_COLOR, isOnline, presenceByUser } from '../../utils/presence'
import { formatDate } from '../../utils/format'
import { errorMessage } from '../../api/client'
import { pushToast } from '../../store/uiSlice'
import { Avatar } from '../ui'
import { InviteModal, NewProjectModal, NewWorkspaceModal } from '../dialogs'
import { PROJECT_VIEWS } from '../../utils/nav'

export default function Sidebar() {
  const dispatch = useDispatch()
  const location = useLocation()
  const open = useSelector((s) => s.ui.sidebarOpen)
  const { items, currentId, people } = useSelector((s) => s.workspaces)
  const workspace = useSelector(selectCurrentWorkspace)
  const role = useSelector(selectMyRole)
  const projects = useSelector((s) => s.projects.active)
  const archivedCount = useSelector((s) => s.projects.archived.length)
  const currentProject = useSelector((s) => s.projects.current)
  const presenceList = useSelector((s) => s.presence.team[currentId]) || []
  const [dialog, setDialog] = useState(null)
  const [expanded, setExpanded] = useState({})

  if (!open) return <aside className="sidebar closed" aria-hidden="true" />

  const names = people[currentId] || {}
  const presence = presenceByUser(presenceList)
  const activeId = location.pathname.match(/^\/projects\/([^/]+)/)?.[1]

  const toggle = (id) => setExpanded((e) => ({ ...e, [id]: !e[id] }))

  async function switchWorkspace(e) {
    const next = e.target.value
    if (!next || next === currentId) return
    dispatch(setCurrentWorkspace(next))
    try {
      await dispatch(fetchProjects({ workspaceId: next, archived: false })).unwrap()
    } catch (err) {
      dispatch(pushToast(errorMessage(err), 'error'))
    }
  }

  const milestones = currentProject && currentProject._id === activeId ? currentProject.milestones || [] : []

  return (
    <aside className="sidebar" aria-label="Sidebar">
      <div className="side-group">
        <div className="side-head">
          <span className="side-label">Workspace</span>
          <button type="button" className="fs-btn small ghost" title="New workspace" aria-label="New workspace" onClick={() => setDialog('workspace')}>
            <Plus size={13} aria-hidden="true" />
          </button>
        </div>
        {items.length > 0 ? (
          <select className="fs-select" aria-label="Switch workspace" value={currentId || ''} onChange={switchWorkspace}>
            {items.map((w) => (
              <option key={w._id} value={w._id}>{w.name}</option>
            ))}
          </select>
        ) : (
          <div className="fs-muted" style={{ padding: '0 6px' }}>No workspaces yet</div>
        )}
      </div>

      <div className="side-group">
        <div className="side-head">
          <span className="side-label">Projects</span>
          <button
            type="button"
            className="fs-btn small ghost"
            title="New project"
            aria-label="New project"
            disabled={!canManageColumns(role) || !workspace}
            onClick={() => setDialog('project')}
          >
            <Plus size={13} aria-hidden="true" />
          </button>
        </div>
        <NavLink
          to="/projects/new/ai"
          className={({ isActive }) => `side-link ai-link${isActive ? ' active' : ''}`}
        >
          <Sparkles size={14} aria-hidden="true" />
          <span>AI project (FR11/12)</span>
        </NavLink>
        {projects.length === 0 && <div className="fs-muted side-empty">No projects yet</div>}
        <ul className="side-tree">
          {projects.map((p) => {
            const isOpen = expanded[p._id] ?? p._id === activeId
            return (
              <li key={p._id}>
                <div className="side-link tree-row">
                  <button type="button" className="tree-caret" aria-label="Toggle project children" onClick={() => toggle(p._id)}>
                    {isOpen ? <ChevronDown size={13} aria-hidden="true" /> : <ChevronRight size={13} aria-hidden="true" />}
                  </button>
                  <NavLink to={`/projects/${p._id}/board`} className={({ isActive }) => `tree-item${isActive ? ' active' : ''}`}>
                    <Boxes size={14} aria-hidden="true" />
                    <span className="ellipsis">{p.name}</span>
                  </NavLink>
                  <button type="button" className="fs-btn small ghost" title="Add task soon" aria-label="Add task" disabled onClick={() => {}}>
                    <Plus size={12} aria-hidden="true" />
                  </button>
                </div>
                {isOpen && (
                  <ul className="side-children">
                    {PROJECT_VIEWS.map((v) => (
                      <li key={v.id}>
                        <NavLink
                          to={`/projects/${p._id}/${v.id}`}
                          className={({ isActive }) => `side-link child${isActive ? ' active' : ''}`}
                        >
                          {v.label}
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
        {archivedCount > 0 && (
          <NavLink to="/projects" className="side-link">
            Archive ({archivedCount})
          </NavLink>
        )}
      </div>

      <NavLink to="/teams" className="side-link top">
        <Users size={14} aria-hidden="true" />
        <span>Teams</span>
      </NavLink>

      {milestones.length > 0 && (
        <div className="side-group">
          <div className="side-head">
            <span className="side-label">Milestones</span>
          </div>
          {milestones.slice(0, 6).map((m) => (
            <div key={m._id} className="side-link" style={{ cursor: 'default' }}>
              <Milestone size={13} aria-hidden="true" style={{ color: m.completed ? 'var(--ok)' : 'var(--fg-muted)' }} />
              <span className="ellipsis">{m.title}</span>
              {m.targetDate && <span className="fs-muted" style={{ fontSize: 11 }}>{formatDate(m.targetDate)}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="side-group">
        <div className="side-head">
          <span className="side-label">Members</span>
          <button type="button" className="fs-btn small ghost" title="Invite member" aria-label="Invite member" disabled={!canInviteMembers(role) || !workspace} onClick={() => setDialog('invite')}>
            <Plus size={13} aria-hidden="true" />
          </button>
        </div>
        <ul>
          {workspace?.members.map((m) => {
            const person = names[m.user]
            const live = presence[m.user]
            return (
              <li key={m.user}>
                <NavLink to={`/profile/${m.user}`} className="side-link member-row">
                  <Avatar name={person?.name} url={avatarSrc(person?.avatarUrl)} size={20} presence={isOnline(live) ? STATUS_COLOR[live.status] : undefined} />
                  <span className="ellipsis">{person?.name || 'Member'}</span>
                  <span className="badge">{m.role}</span>
                </NavLink>
              </li>
            )
          })}
        </ul>
      </div>

      {dialog === 'workspace' && <NewWorkspaceModal onClose={() => setDialog(null)} />}
      {dialog === 'project' && workspace && <NewProjectModal workspaceId={workspace._id} onClose={() => setDialog(null)} />}
      {dialog === 'invite' && workspace && <InviteModal workspaceId={workspace._id} onClose={() => setDialog(null)} />}
    </aside>
  )
}