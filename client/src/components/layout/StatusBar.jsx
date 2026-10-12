import { useEffect, useState } from 'react'
import { useSelector } from 'react-redux'
import { useLocation } from 'react-router-dom'
import api from '../../api/client'
import { selectMyRole } from '../../store/workspacesSlice'
import { STATUS_COLOR } from '../../utils/presence'
import { relativeTime } from '../../utils/format'

// Polls the health endpoint once a minute (well inside the 100 requests / 15 min limit).
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
    const timer = setInterval(check, 60000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])
  return state
}

const HEALTH = {
  ok: { dot: 'ok', label: 'API connected' },
  checking: { dot: 'warn', label: 'Checking API…' },
  degraded: { dot: 'warn', label: 'API up, database down' },
  down: { dot: 'danger', label: 'API unreachable' },
}

export default function StatusBar() {
  const health = useApiHealth()
  const location = useLocation()
  const user = useSelector((s) => s.auth.user)
  const role = useSelector(selectMyRole)
  const theme = useSelector((s) => s.ui.theme)
  const fontSize = useSelector((s) => s.ui.fontSize)
  const presence = useSelector((s) => s.presence.me)
  const projects = useSelector((s) => s.projects.active)
  const workspace = useSelector((s) => s.workspaces.items.find((w) => w._id === s.workspaces.currentId))

  // If a project view is open, surface its GitHub sync summary (if the repo is linked).
  const activeId = location.pathname.match(/^\/projects\/([^/]+)/)?.[1]
  const activeProject = activeId ? projects.find((p) => p._id === activeId) : null
  const link = activeProject?.github && activeProject.github.publicLink ? activeProject.github.publicLink : null
  const sync = { dot: health.dot, label: HEALTH[health].label }

  return (
    <footer className="statusbar">
      <span title={sync.label}>
        <span className="bar-dot" style={{ background: PP_DOT[sync.dot] }} /> {sync.label}
      </span>
      {workspace && <span>Workspace: {workspace.name}</span>}
      {link && (
        <span title="Latest GitHub sync">
          {link.repo} · synced {relativeTime(link.lastSyncedAt)}
        </span>
      )}
      <span className="spacer" />
      <span data-testid="presence-dot" style={{ color: STATUS_COLOR[presence?.status || 'Offline'] }}>
        ● {presence?.status || 'Offline'}
      </span>
      {presence?.workingOn && <span className="ellipsis" style={{ maxWidth: 160 }}>working on {presence.workingOn}</span>}
      <span>{user?.name}{role ? ` · ${role}` : ''}</span>
      <span>{px(fontSize)} · {theme === 'system' ? 'System' : theme}</span>
    </footer>
  )
}

const PP_DOT = { ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)' }
const px = (n) => `${n}px`