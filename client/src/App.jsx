import { Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import AppShell from './components/AppShell'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import ProjectsPage from './pages/Projects'
import NewProject from './pages/NewProject'
import AiProjectGenerator from './pages/AiProjectGenerator'
import ProjectFiles from './pages/ProjectFiles'
import Board from './pages/Board'
import ProjectCalendarPage from './pages/ProjectCalendar'
import ProjectActivityPage from './pages/ProjectActivity'
import ProjectAnalyticsPage from './pages/ProjectAnalytics'
import ProjectGithubPage from './pages/ProjectGithub'
import ProjectMilestonesPage from './pages/ProjectMilestones'
import Calendar from './pages/Calendar'
import Analytics from './pages/Analytics'
import Github from './pages/Github'
import Notifications from './pages/Notifications'
import TeamsPage from './pages/TeamsPage'
import TeamDetail from './pages/TeamDetail'
import Members from './pages/Members'
import Profile from './pages/Profile'
import PublicProfile from './pages/PublicProfile'
import SettingsPage from './pages/SettingsPage'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/new" element={<NewProject />} />
          <Route path="projects/new/ai" element={<AiProjectGenerator />} />
          <Route path="projects/:projectId/board" element={<Board />} />
          <Route path="projects/:projectId/calendar" element={<ProjectCalendarPage />} />
          <Route path="projects/:projectId/activity" element={<ProjectActivityPage />} />
          <Route path="projects/:projectId/analytics" element={<ProjectAnalyticsPage />} />
          <Route path="projects/:projectId/github" element={<ProjectGithubPage />} />
          <Route path="projects/:projectId/milestones" element={<ProjectMilestonesPage />} />
          <Route path="projects/:projectId/files" element={<ProjectFiles />} />
          <Route path="calendar" element={<Calendar />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="github" element={<Github />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="teams" element={<TeamsPage />} />
          <Route path="teams/:teamId" element={<TeamDetail />} />
          <Route path="members" element={<Members />} />
          <Route path="profile" element={<Profile />} />
          <Route path="profile/:id" element={<PublicProfile />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}