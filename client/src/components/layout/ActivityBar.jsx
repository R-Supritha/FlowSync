import { useDispatch, useSelector } from 'react-redux'
import { NavLink } from 'react-router-dom'
import {
  BarChart3,
  Bell,
  Calendar,
  GitPullRequest,
  Kanban,
  LayoutDashboard,
  MessageSquare,
  PanelBottom,
  Search,
  Settings,
  User,
} from 'lucide-react'
import { togglePanel, toggleSidebar, setSearchOpen } from '../../store/uiSlice'
import { selectUnreadTotal } from '../../store/chatSlice'

export default function ActivityBar() {
  const dispatch = useDispatch()
  const unread = useSelector((s) => s.notifications.unreadCount)
  const chatUnread = useSelector(selectUnreadTotal)

  return (
    <nav className="activitybar" aria-label="Main navigation">
      <NavLink to="/" end className={({ isActive }) => `act-btn${isActive ? ' active' : ''}`} title="Dashboard" aria-label="Dashboard">
        <LayoutDashboard size={19} aria-hidden="true" />
      </NavLink>
      <NavLink to="/projects" className={({ isActive }) => `act-btn${isActive ? ' active' : ''}`} title="Boards" aria-label="Boards">
        <Kanban size={19} aria-hidden="true" />
      </NavLink>
      <NavLink to="/chat" className={({ isActive }) => `act-btn${isActive ? ' active' : ''}`} title="Chat" aria-label="Chat">
        <span className="act-wrap">
          <MessageSquare size={19} aria-hidden="true" />
          {chatUnread > 0 && <span className="badge-dot" aria-label={`${chatUnread} unread messages`}>{chatUnread > 99 ? '99+' : chatUnread}</span>}
        </span>
      </NavLink>
      <hr className="act-sep" />
      <button type="button" className="act-btn" title="Toggle sidebar (Ctrl+B)" aria-label="Toggle sidebar" onClick={() => dispatch(toggleSidebar())}>
        <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1 }}>☰</span>
      </button>
      <button type="button" className="act-btn" title="Global search (Ctrl+K)" aria-label="Search" onClick={() => dispatch(setSearchOpen(true))}>
        <Search size={19} aria-hidden="true" />
      </button>
      <NavLink to="/calendar" className={({ isActive }) => `act-btn${isActive ? ' active' : ''}`} title="Calendar" aria-label="Calendar">
        <Calendar size={19} aria-hidden="true" />
      </NavLink>
      <NavLink to="/github" className={({ isActive }) => `act-btn${isActive ? ' active' : ''}`} title="GitHub" aria-label="GitHub">
        <GitPullRequest size={19} aria-hidden="true" />
      </NavLink>
      <NavLink to="/notifications" className={({ isActive }) => `act-btn${isActive ? ' active' : ''}`} title="Notifications" aria-label="Notifications">
        <span className="act-wrap">
          <Bell size={19} aria-hidden="true" />
          {unread > 0 && <span className="badge-dot">{unread}</span>}
        </span>
      </NavLink>
      <NavLink to="/analytics" className={({ isActive }) => `act-btn${isActive ? ' active' : ''}`} title="Analytics" aria-label="Analytics">
        <BarChart3 size={19} aria-hidden="true" />
      </NavLink>

      <div className="grow" />

      <button type="button" className="act-btn" title="Toggle bottom panel (Ctrl+J)" aria-label="Toggle bottom panel" onClick={() => dispatch(togglePanel())}>
        <PanelBottom size={19} aria-hidden="true" />
      </button>
      <NavLink to="/profile" className={({ isActive }) => `act-btn${isActive ? ' active' : ''}`} title="Account" aria-label="Account">
        <User size={19} aria-hidden="true" />
      </NavLink>
      <NavLink to="/settings" className={({ isActive }) => `act-btn${isActive ? ' active' : ''}`} title="Settings" aria-label="Settings">
        <Settings size={19} aria-hidden="true" />
      </NavLink>
    </nav>
  )
}