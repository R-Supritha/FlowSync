import { useEffect, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, NavLink, Outlet, useLocation, useMatch } from 'react-router-dom'
import api from '../api/client'
import { fetchWorkspaces, fetchPeople, selectCurrentWorkspace, selectMyRole, setCurrentWorkspace } from '../store/workspacesSlice'
import { fetchProjects } from '../store/projectsSlice'
import { THEMES, setTheme, toggleSidebar, togglePanel } from '../store/uiSlice'
import { signOut } from '../store/session'
import { isManager } from '../utils/roles'
import { initials } from '../utils/format'
import { ErrorState, Spinner, Toasts } from './ui'
import { InviteModal, NewProjectModal, NewWorkspaceModal } from './dialogs'
import useTheme from '../hooks/useTheme'
import NotificationBell from './NotificationBell'
import PresenceControl from './PresenceControl'
import SearchPalette from './SearchPalette'
import ActivityFeed from './ActivityFeed'
import ContributionDots from './ContributionDots'

// Polls the health endpoint every two minutes (the API allows 100 requests / 15 min per computer).
function useApiHealth() {
  const [state, setState] = useState('checking')
  useEffect(() => {
    let alive = true
    const check = () =>
      api
        .get('/health')
        .then((res) => alive && setState(res.data?.database === 'connected' ? 'ok' : 'degraded'))
        .catch(() => alive && setState('down'))
    check()
    const timer = setInterval(check, 120000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return state
}

function TitleBar({ onSearch }) {
  const dispatch = useDispatch()
  const user = useSelector((s) => s.auth.user)
  const theme = useSelector((s) => s.ui.theme)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <header className="titlebar">
      <Link to="/" className="logo" style={{ textDecoration: 'none' }}>FlowSync</Link>
      <button type="button" className="fs-input search-box" aria-label="Search" onClick={onSearch}>
        Search (Ctrl+K)
      </button>
      <div className="spacer" />
      <PresenceControl />
      <label className="fs-muted" htmlFor="theme-pick" style={{ fontSize: 12 }}>Theme</label>
      <select
        id="theme-pick"
        className="fs-select"
        style={{ width: 'auto' }}
        value={theme}
        onChange={(e) => dispatch(setTheme(e.target.value))}
      >
        <option value="system">System default</option>
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
      <NotificationBell />
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          className="fs-btn ghost"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Account menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span className="avatar">{initials(user?.name)}</span>
        </button>
        {menuOpen && (
          <div role="menu" className="panel-card" style={{ position: 'absolute', right: 0, top: 34, minWidth: 190, zIndex: 60 }}>
            <div style={{ marginBottom: 8 }}>
              <strong>{user?.name}</strong>
              <div className="fs-muted" style={{ fontSize: 12 }}>{user?.email}</div>
            </div>
            <Link role="menuitem" to="/profile" className="menu-link" onClick={() => setMenuOpen(false)}>Profile</Link>
            <Link role="menuitem" to="/settings" className="menu-link" onClick={() => setMenuOpen(false)}>Settings</Link>
            <button type="button" role="menuitem" className="fs-btn" style={{ width: '100%', marginTop: 8 }} onClick={() => dispatch(signOut())}>
              Log out
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

const NAV = [
  ['/', 'Dashboard', '⌂', true],
  ['/projects', 'Projects', '▤'],
  ['/teams', 'Teams', '☗'],
  ['/members', 'Members', '☺'],
  ['/calendar', 'Calendar', '▦'],
  ['/activity', 'Activity', '≋'],
  ['/analytics', 'Analytics', '▥'],
]

function ActivityBar({ onSearch }) {
  const dispatch = useDispatch()
  const link = ([to, label, icon, end]) => (
    <NavLink key={to} to={to} end={end} className={({ isActive }) => `act-btn${isActive ? ' active' : ''}`} title={label} aria-label={label}>
      {icon}
    </NavLink>
  )
  return (
    <nav className="activitybar" aria-label="Main">
      {NAV.map(link)}
      <button type="button" className="act-btn" title="Search (Ctrl+K)" aria-label="Open search" onClick={onSearch}>⌕</button>
      <button type="button" className="act-btn" title="Toggle sidebar (Ctrl+B)" aria-label="Toggle sidebar" onClick={() => dispatch(toggleSidebar())}>☰</button>
      <div className="grow" />
      {link(['/notifications', 'Notifications', '♪'])}
      {link(['/settings', 'Settings', '⚙'])}
      <button type="button" className="act-btn" title="Toggle panel (Ctrl+J)" aria-label="Toggle bottom panel" onClick={() => dispatch(togglePanel())}>
        ▁
      </button>
    </nav>
  )
}

function Sidebar() {
  const dispatch = useDispatch()
  const open = useSelector((s) => s.ui.sidebarOpen)
  const { items, currentId, people } = useSelector((s) => s.workspaces)
  const workspace = useSelector(selectCurrentWorkspace)
  const role = useSelector(selectMyRole)
  const projects = useSelector((s) => s.projects.active)
  const [dialog, setDialog] = useState(null) // 'workspace' | 'project' | 'invite'

  const names = people[currentId] || {}

  return (
    <aside className={`sidebar${open ? '' : ' closed'}`} aria-label="Sidebar">
      <div className="side-title">Workspace</div>
      {items.length > 0 && (
        <select
          className="fs-select"
          aria-label="Switch workspace"
          value={currentId || ''}
          onChange={(e) => dispatch(setCurrentWorkspace(e.target.value))}
        >
          {items.map((w) => (
            <option key={w._id} value={w._id}>{w.name}</option>
          ))}
        </select>
      )}
      <button type="button" className="fs-btn small" style={{ marginTop: 6 }} onClick={() => setDialog('workspace')}>
        + New workspace
      </button>

      {workspace && (
        <>
          <div className="side-title">Projects</div>
          {projects.length === 0 && <div className="fs-muted" style={{ padding: '0 8px' }}>No projects yet</div>}
          {projects.map((p) => (
            <NavLink key={p._id} to={`/projects/${p._id}/board`} className={({ isActive }) => `side-link${isActive ? ' active' : ''}`}>
              ▸ {p.name} <span className="fs-muted" style={{ fontSize: '0.8em' }}>board</span>
            </NavLink>
          ))}
          {isManager(role) && (
            <button type="button" className="fs-btn small" style={{ marginTop: 6 }} onClick={() => setDialog('project')}>
              + New project
            </button>
          )}

          <div className="side-title">Members</div>
          {workspace.members.map((m) => {
            const person = names[m.user]
            return (
              <div key={m.user} className="side-link" style={{ cursor: 'default' }}>
                <span className="avatar">{initials(person?.name)}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {person?.name || 'Member'}
                </span>
                <span className="badge">{m.role}</span>
              </div>
            )
          })}
          {isManager(role) && (
            <button type="button" className="fs-btn small" style={{ marginTop: 6 }} onClick={() => setDialog('invite')}>
              + Invite member
            </button>
          )}
        </>
      )}

      {dialog === 'workspace' && <NewWorkspaceModal onClose={() => setDialog(null)} />}
      {dialog === 'project' && workspace && <NewProjectModal workspaceId={workspace._id} onClose={() => setDialog(null)} />}
      {dialog === 'invite' && workspace && <InviteModal workspaceId={workspace._id} onClose={() => setDialog(null)} />}
    </aside>
  )
}

function BottomPanel() {
  const workspaceId = useSelector((s) => s.workspaces.currentId)
  const me = useSelector((s) => s.auth.user?.id)
  const match = useMatch('/projects/:projectId/*')
  const projectId = match?.params.projectId
  const [tab, setTab] = useState('activity')

  return (
    <section className="bottom-panel" aria-label="Bottom panel">
      <div className="fs-row" role="tablist" aria-label="Panel views" style={{ marginBottom: 6 }}>
        <button type="button" role="tab" aria-selected={tab === 'activity'} className={`tab${tab === 'activity' ? ' active' : ''}`} onClick={() => setTab('activity')}>
          Activity
        </button>
        <button type="button" role="tab" aria-selected={tab === 'week'} className={`tab${tab === 'week' ? ' active' : ''}`} onClick={() => setTab('week')}>
          My week
        </button>
      </div>
      {tab === 'activity' && (projectId
        ? <ActivityFeed scope="project" id={projectId} compact />
        : workspaceId ? <ActivityFeed scope="workspace" id={workspaceId} compact /> : <p className="fs-muted">Open a workspace to see its activity.</p>)}
      {tab === 'week' && me && <ContributionDots userId={me} title="My week" />}
    </section>
  )
}

function StatusBar() {
  const health = useApiHealth()
  const user = useSelector((s) => s.auth.user)
  const role = useSelector(selectMyRole)
  const theme = useSelector((s) => s.ui.theme)
  const label = { ok: 'API connected', checking: 'Checking API…', degraded: 'API up, database down', down: 'API unreachable' }[health]
  return (
    <footer className="statusbar">
      <span>{health === 'ok' ? '●' : '○'} {label}</span>
      <span className="spacer" />
      <span>{user?.name}{role ? ` · ${role}` : ''}</span>
      <span>Theme: {theme}</span>
    </footer>
  )
}

export default function AppShell() {
  useTheme()
  const dispatch = useDispatch()
  const location = useLocation()
  const status = useSelector((s) => s.workspaces.status)
  const error = useSelector((s) => s.workspaces.error)
  const currentId = useSelector((s) => s.workspaces.currentId)
  const panelOpen = useSelector((s) => s.ui.panelOpen)
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (status === 'idle') dispatch(fetchWorkspaces())
  }, [status, dispatch])

  useEffect(() => {
    if (!currentId) return
    dispatch(fetchProjects({ workspaceId: currentId, archived: false }))
    dispatch(fetchPeople(currentId))
  }, [currentId, dispatch])

  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 'k') {
        e.preventDefault()
        setSearching(true)
      } else if (key === 'b') {
        e.preventDefault()
        dispatch(toggleSidebar())
      } else if (key === 'j') {
        e.preventDefault()
        dispatch(togglePanel())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch])

  let body = <Outlet key={location.pathname} />
  if (status === 'idle' || status === 'loading') body = <Spinner label="Loading your workspaces…" />
  if (status === 'error') body = <ErrorState message={error} onRetry={() => dispatch(fetchWorkspaces())} />

  return (
    <div className="shell">
      <TitleBar onSearch={() => setSearching(true)} />
      <ActivityBar onSearch={() => setSearching(true)} />
      <Sidebar />
      <main className="main">
        <div className="main-body">{body}</div>
        {panelOpen && <BottomPanel />}
      </main>
      <StatusBar />
      <Toasts />
      {searching && <SearchPalette onClose={() => setSearching(false)} />}
    </div>
  )
}
