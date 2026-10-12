import { useEffect } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Outlet, useLocation } from 'react-router-dom'
import { fetchWorkspaces, fetchPeople } from '../store/workspacesSlice'
import { fetchProjects } from '../store/projectsSlice'
import { setSearchOpen, toggleSidebar, togglePanel, openTab, closeTask } from '../store/uiSlice'
import { fetchWorkspacePresence } from '../store/presenceSlice'
import { routeMeta } from '../utils/nav'
import useTheme from '../hooks/useTheme'
import useHeartbeat from '../hooks/useHeartbeat'
import { ErrorState, Spinner, Toasts } from './ui'
import TitleBar from './layout/TitleBar'
import ActivityBar from './layout/ActivityBar'
import Sidebar from './layout/Sidebar'
import { Breadcrumbs, EditorTabs } from './layout/EditorChrome'
import BottomPanel from './layout/BottomPanel'
import StatusBar from './layout/StatusBar'
import SearchDialog from './search/SearchDialog'
import TaskDrawer from './TaskDrawer'

export default function AppShell() {
  useTheme()
  useHeartbeat()
  const dispatch = useDispatch()
  const location = useLocation()
  const status = useSelector((s) => s.workspaces.status)
  const error = useSelector((s) => s.workspaces.error)
  const currentId = useSelector((s) => s.workspaces.currentId)
  const panelOpen = useSelector((s) => s.ui.panelOpen)
  const projects = useSelector((s) => s.projects.active)
  const openTaskId = useSelector((s) => s.ui.openTaskId)

  useEffect(() => {
    if (status === 'idle') dispatch(fetchWorkspaces())
  }, [status, dispatch])

  // When the active workspace changes, reload its projects, member names and presence.
  useEffect(() => {
    if (!currentId) return
    dispatch(fetchProjects({ workspaceId: currentId, archived: false }))
    dispatch(fetchPeople(currentId))
    dispatch(fetchWorkspacePresence(currentId))
  }, [currentId, dispatch])

  // Keep the editor tabs in sync with the URL.
  useEffect(() => {
    const meta = routeMeta(location.pathname, projects)
    if (meta) dispatch(openTab(meta))
  }, [location.pathname, projects, dispatch])

  // IDE-style keyboard shortcuts: Ctrl+K search, Ctrl+B sidebar, Ctrl+J bottom panel.
  useEffect(() => {
    const onKey = (e) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key === 'k') {
        e.preventDefault()
        dispatch(setSearchOpen(true))
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
      <TitleBar />
      <ActivityBar />
      <Sidebar />
      <main className="main">
        <div className="editor-chrome">
          <EditorTabs />
          <Breadcrumbs />
        </div>
        <div className="main-body">{body}</div>
        {panelOpen && <BottomPanel />}
      </main>
      <StatusBar />
      <Toasts />
      <SearchDialog />
      {openTaskId && <TaskDrawer key={openTaskId} taskId={openTaskId} onClose={() => dispatch(closeTask())} />}
    </div>
  )
}