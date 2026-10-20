// Maps a URL to the tab/breadcrumb metadata used by the shell chrome.
export const VIEWS = {
  board: 'Board',
  calendar: 'Calendar',
  activity: 'Activity',
  analytics: 'Analytics',
  github: 'GitHub',
  milestones: 'Milestones',
  files: 'Files',
  info: 'Project',
}

const PAGES = {
  '/': { label: 'Dashboard' },
  '/projects': { label: 'Projects' },
  '/projects/new': { label: 'New project' },
  '/projects/new/ai': { label: 'AI project generator' },
  '/teams': { label: 'Teams' },
  '/members': { label: 'Members' },
  '/calendar': { label: 'Calendar' },
  '/notifications': { label: 'Notifications' },
  '/analytics': { label: 'Analytics' },
  '/github': { label: 'GitHub' },
  '/profile': { label: 'Profile' },
  '/settings': { label: 'Settings' },
}

export function routeMeta(pathname, projects = []) {
  if (PAGES[pathname]) return { kind: 'page', path: pathname, label: PAGES[pathname].label }

  const m = pathname.match(/^\/projects\/([^/]+)(?:\/([a-z-]+))?$/i)
  if (m) {
    const [, id, view = 'board'] = m
    const project = projects.find((p) => p._id === id)
    const base = project?.name || `Project ${id.slice(0, 6)}`
    const viewLabel = VIEWS[view] || 'Overview'
    return { kind: 'project', path: pathname, projectId: id, label: `${base} · ${viewLabel}` }
  }

  const profile = pathname.match(/^\/profile\/([^/]+)$/)
  if (profile) return { kind: 'page', path: pathname, label: 'Profile' }
  const team = pathname.match(/^\/teams\/([^/]+)$/)
  if (team) return { kind: 'page', path: pathname, label: 'Team' }
  return null
}

// The project views listed in the sidebar tree.
export const PROJECT_VIEWS = [
  { id: 'board', label: 'Board' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'milestones', label: 'Milestones' },
  { id: 'files', label: 'Files' },
  { id: 'activity', label: 'Activity' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'github', label: 'GitHub' },
]