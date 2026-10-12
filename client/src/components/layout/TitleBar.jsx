import { useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import {
  FilePlus2,
  FolderPlus,
  GitPullRequest,
  HelpCircle,
  LogOut,
  Search,
  Settings,
  UserPlus,
  Zap,
} from 'lucide-react'
import { THEMES, setFontSize, setSearchOpen, setTheme, pushToast } from '../../store/uiSlice'
import { selectMyRole } from '../../store/workspacesSlice'
import { selectCurrentWorkspace } from '../../store/workspacesSlice'
import { signOut } from '../../store/session'
import { canInviteMembers, canManageColumns } from '../../utils/roles'
import { Avatar, Dropdown, MenuItem, Modal } from '../ui'
import NotificationBell from '../notifications/NotificationBell'
import PresenceSelector from '../presence/PresenceSelector'
import { InviteModal, NewProjectModal, NewWorkspaceModal } from '../dialogs'

const FONT_SIZES = [12, 13, 14, 15, 16]

function ThemeMenuButton({ onClose }) {
  const dispatch = useDispatch()
  const theme = useSelector((s) => s.ui.theme)
  return (
    <Dropdown
      label="Theme and font size"
      width={190}
      button={<span className="menu-label">{theme === 'system' ? 'System' : THEMES.find((t) => t.id === theme)?.label}</span>}
    >
      {({ close }) => (
        <>
          <div className="dropdown-head"><strong>Appearance</strong></div>
          <div className="menu-group">Theme</div>
          <MenuItem onClick={() => { dispatch(setTheme('system')); close() }}>
            System default
          </MenuItem>
          {THEMES.map((t) => (
            <MenuItem key={t.id} onClick={() => { dispatch(setTheme(t.id)); close() }}>{t.label}</MenuItem>
          ))}
          <div className="menu-group">Font size</div>
          {FONT_SIZES.map((s) => (
            <MenuItem key={s} onClick={() => { dispatch(setFontSize(s)); close() }}>
              {s}px
            </MenuItem>
          ))}
          {onClose && <div className="menu-group" />}
        </>
      )}
    </Dropdown>
  )
}

export default function TitleBar() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const user = useSelector((s) => s.auth.user)
  const role = useSelector(selectMyRole)
  const workspace = useSelector(selectCurrentWorkspace)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dialog, setDialog] = useState(null) // workspace | project | invite

  const canCreate = canManageColumns(role)

  const fileMenu = (close) => (
    <>
      <div className="dropdown-head"><strong>File</strong></div>
      <MenuItem icon={FolderPlus} disabled={!workspace} onClick={() => { setDialog('workspace'); close() }}>
        New workspace…
      </MenuItem>
      <MenuItem icon={FilePlus2} disabled={!canCreate} onClick={() => { setDialog('project'); close() }}>
        New project…
      </MenuItem>
      <MenuItem icon={UserPlus} disabled={!canInviteMembers(role) || !workspace} onClick={() => { setDialog('invite'); close() }}>
        Invite member…
      </MenuItem>
      <div className="menu-group" />
      <MenuItem icon={LogOut} danger onClick={() => dispatch(signOut())}>Log out</MenuItem>
    </>
  )

  const viewMenu = (close) => (
    <>
      <div className="dropdown-head"><strong>View</strong></div>
      <MenuItem onClick={() => { dispatch(pushToast('Ctrl+K to search', 'info')); close() }}>
        Search… <kbd className="kbd">Ctrl+K</kbd>
      </MenuItem>
      <MenuItem onClick={() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true })); close() }}>
        Toggle sidebar <kbd className="kbd">Ctrl+B</kbd>
      </MenuItem>
      <MenuItem onClick={() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', ctrlKey: true })); close() }}>
        Toggle bottom panel <kbd className="kbd">Ctrl+J</kbd>
      </MenuItem>
      <div className="menu-group" />
      <div style={{ padding: '4px 10px' }}><ThemeMenuButton /></div>
    </>
  )

  const syncMenu = (close) => (
    <>
      <div className="dropdown-head"><strong>Integrations</strong></div>
      <MenuItem icon={GitPullRequest} onClick={() => { navigate('/github'); close() }}>GitHub sync</MenuItem>
    </>
  )

  const helpMenu = () => (
    <>
      <div className="dropdown-head"><strong>Help</strong></div>
      <MenuItem icon={HelpCircle} onClick={() => dispatch(pushToast('FlowSync developer workflow — Solidity team', 'info'))}>
        About FlowSync
      </MenuItem>
      <MenuItem icon={Zap} onClick={() => dispatch(pushToast('Ctrl+K search, Ctrl+B sidebar, Ctrl+J panel', 'info'))}>
        Keyboard shortcuts
      </MenuItem>
    </>
  )

  return (
    <header className="titlebar">
      <Link to="/" className="logo" style={{ textDecoration: 'none' }}>FlowSync</Link>

      <nav className="menubar" aria-label="Menu">
        <Dropdown label="File menu" width={210} button={<span className="menu-label">File</span>}>{fileMenu}</Dropdown>
        <Dropdown label="View menu" width={230} button={<span className="menu-label">View</span>}>{viewMenu}</Dropdown>
        <Dropdown label="Integrations menu" width={200} button={<span className="menu-label">Sync</span>}>{syncMenu}</Dropdown>
        <Dropdown label="Help menu" width={220} button={<span className="menu-label">Help</span>}>{helpMenu}</Dropdown>
      </nav>

      <div className="spacer" />

      <button type="button" className="fs-btn ghost" onClick={() => dispatch(setSearchOpen(true))}>
        <Search size={14} aria-hidden="true" />
        <span className="menu-label">Search</span>
        <kbd className="kbd">Ctrl+K</kbd>
      </button>

      <PresenceSelector />
      <NotificationBell />
      <ThemeMenuButton />

      <div style={{ position: 'relative' }}>
        <button
          type="button"
          className="fs-btn ghost"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          aria-label="Account menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <Avatar name={user?.name} size={22} />
        </button>
        {menuOpen && (
          <div role="menu" className="dropdown-menu account-menu" style={{ right: 0, top: 34, width: 220 }}>
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)' }}>
              <strong>{user?.name}</strong>
              <div className="fs-muted" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis' }}>{user?.email}</div>
            </div>
            <button type="button" role="menuitem" className="menu-item" onClick={() => { setMenuOpen(false); navigate('/profile') }}>
              <Settings size={15} aria-hidden="true" /><span>Profile &amp; settings</span>
            </button>
            <button type="button" role="menuitem" className="menu-item danger" onClick={() => dispatch(signOut())}>
              <LogOut size={15} aria-hidden="true" /><span>Log out</span>
            </button>
          </div>
        )}
      </div>

      {dialog === 'workspace' && <NewWorkspaceModal onClose={() => setDialog(null)} />}
      {dialog === 'project' && workspace && <NewProjectModal workspaceId={workspace._id} onClose={() => setDialog(null)} />}
      {dialog === 'invite' && workspace && <InviteModal workspaceId={workspace._id} onClose={() => setDialog(null)} />}
      {dialog === 'help' && <Modal title="About FlowSync" onClose={() => setDialog(null)} />}
    </header>
  )
}