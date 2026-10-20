import { Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import AppShell from './components/AppShell'
import ProjectLayout from './components/ProjectLayout'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import Home from './pages/Home'
import Members from './pages/Members'
import Teams from './pages/Teams'
import Board from './pages/Board'
import GitHubPanel from './pages/GitHubPanel'
import Milestones from './pages/Milestones'
import ProjectTeams from './pages/ProjectTeams'
import { ProjectActivity, ProjectAnalytics, ProjectCalendar, ProjectFiles } from './pages/ProjectViews'
import { WorkspaceActivity, WorkspaceAnalytics, WorkspaceCalendar } from './pages/WorkspacePages'
import Notifications from './pages/Notifications'
import Profile from './pages/Profile'
import Settings from './pages/Settings'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="projects" element={<Home />} />
          <Route path="teams" element={<Teams />} />
          <Route path="members" element={<Members />} />
          <Route path="calendar" element={<WorkspaceCalendar />} />
          <Route path="activity" element={<WorkspaceActivity />} />
          <Route path="analytics" element={<WorkspaceAnalytics />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="profile" element={<Profile />} />
          <Route path="users/:id" element={<Profile />} />
          <Route path="settings" element={<Settings />} />
          <Route path="projects/:projectId" element={<ProjectLayout />}>
            <Route path="board" element={<Board />} />
            <Route path="calendar" element={<ProjectCalendar />} />
            <Route path="activity" element={<ProjectActivity />} />
            <Route path="analytics" element={<ProjectAnalytics />} />
            <Route path="github" element={<GitHubPanel />} />
            <Route path="files" element={<ProjectFiles />} />
            <Route path="milestones" element={<Milestones />} />
            <Route path="teams" element={<ProjectTeams />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
