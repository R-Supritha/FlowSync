import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { FileText, FolderKanban, MessageSquare, Search, User, AlertCircle, Paperclip } from 'lucide-react'
import { searchApi } from '../../api/endpoints'
import { errorMessage } from '../../api/client'
import { openTask, setSearchOpen } from '../../store/uiSlice'
import { taskRef } from '../../utils/format'

const GROUP_META = [
  { key: 'projects', label: 'Projects', icon: FolderKanban },
  { key: 'tasks', label: 'Tasks', icon: FileText },
  { key: 'comments', label: 'Comments', icon: MessageSquare },
  { key: 'files', label: 'Files', icon: Paperclip },
  { key: 'users', label: 'People', icon: User },
]

export default function SearchDialog() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const open = useSelector((s) => s.ui.searchOpen)
  const currentWorkspaceId = useSelector((s) => s.workspaces.currentId)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [counts, setCounts] = useState({})
  const [status, setStatus] = useState('idle') // idle | loading | ready | empty | error
  const [error, setError] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef(null)
  const abortRef = useRef(null)

  const flat = useCallback(() => {
    if (!results) return []
    const out = []
    for (const group of GROUP_META) {
      for (const item of results[group.key] || []) out.push({ group: group.key, item })
    }
    return out
  }, [results])

  useEffect(() => {
    if (!open) return undefined
    inputRef.current?.focus()
    const t = setTimeout(() => {
      const q = query.trim()
      abortRef.current?.abort()
      if (q.length < 2) {
        setResults(null)
        setStatus('idle')
        return
      }
      const controller = new AbortController()
      abortRef.current = controller
      setStatus('loading')
      searchApi
        .run({ q, ...(currentWorkspaceId ? { workspace: currentWorkspaceId } : {}) })
        .then((res) => {
          setResults(res.results)
          setCounts(res.counts)
          setActiveIndex(0)
          setStatus(
            Object.values(res.results).every((arr) => !arr.length) ? 'empty' : 'ready',
          )
        })
        .catch((e) => {
          if (e.code === 'ERR_CANCELED') return
          setStatus('error')
          setError(errorMessage(e, 'Search failed'))
        })
        .finally(() => {
          if (abortRef.current === controller) abortRef.current = null
        })
    }, 280)
    return () => clearTimeout(t)
  }, [query, open, currentWorkspaceId])

  useEffect(() => {
    if (!open) return undefined
    const onKey = (e) => {
      if (e.key === 'Escape') dispatch(setSearchOpen(false))
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, flat().length - 1))
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
      }
      if (e.key === 'Enter') {
        const list = flat()
        if (list[activeIndex]) openResult(list[activeIndex])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeIndex, flat, results, currentWorkspaceId])

  if (!open) return null

  function openResult({ group, item }) {
    dispatch(setSearchOpen(false))
    if (group === 'projects') navigate(`/projects/${item._id}/board`)
    else if (group === 'tasks') dispatch(openTask(item._id))
    else if (group === 'comments') dispatch(openTask(item.task))
    else if (group === 'files') {
      if (item.task) dispatch(openTask(item.task))
      else if (item.project) navigate(`/projects/${item.project}/board`)
    } else if (group === 'users') navigate(`/profile/${item._id}`)
  }

  let i = -1

  return createPortal(
    <div className="search-overlay" onMouseDown={() => dispatch(setSearchOpen(false))}>
      <div className="search-dialog" role="dialog" aria-modal="true" aria-label="Global search" onMouseDown={(e) => e.stopPropagation()}>
        <div className="search-input-wrap">
          <Search size={16} className="fs-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search projects, tasks, comments, files and people…"
            aria-label="Search"
          />
          <kbd className="kbd">Esc</kbd>
        </div>

        <div className="search-results">
          {status === 'idle' && <p className="search-hint">Type at least two characters to search your workspaces.</p>}
          {status === 'loading' && <p className="fs-muted" style={{ padding: 12 }}>Searching…</p>}
          {status === 'empty' && <p className="search-hint">No matches for “{query.trim()}”.</p>}
          {status === 'error' && (
            <p className="search-hint" style={{ color: 'var(--danger)' }}>
              <AlertCircle size={14} aria-hidden="true" /> {error}
            </p>
          )}
          {status === 'ready' &&
            GROUP_META.map((group) => {
              const items = results[group.key] || []
              if (!items.length) return null
              const Icon = group.icon
              return (
                <section key={group.key} className="search-group">
                  <div className="search-group-title">
                    <Icon size={13} aria-hidden="true" />
                    {group.label}
                    <span className="fs-muted">({counts[group.key]})</span>
                  </div>
                  {items.map((item) => {
                    i += 1
                    const active = i === activeIndex
                    return (
                      <button
                        key={item._id}
                        type="button"
                        className={`search-result${active ? ' active' : ''}`}
                        onClick={() => openResult({ group: group.key, item })}
                        onMouseEnter={() => setActiveIndex(i)}
                      >
                        <span className="search-result-title">
                          {group.key === 'tasks' && <span className="task-ref">{taskRef(item._id)}</span>}
                          {group.key === 'projects' && item.name}
                          {group.key === 'tasks' && item.title}
                          {group.key === 'comments' && item.text}
                          {group.key === 'files' && item.originalName}
                          {group.key === 'users' && item.name}
                        </span>
                        <span className="fs-muted search-result-sub">
                          {group.key === 'tasks' && `${item.status}${item.priority ? ` · ${item.priority}` : ''}`}
                          {group.key === 'comments' && item.taskTitle}
                          {group.key === 'users' && item.email}
                          {group.key === 'files' && (item.mimetype || '')}
                        </span>
                      </button>
                    )
                  })}
                </section>
              )
            })}
        </div>

        <div className="search-foot">
          <span><kbd className="kbd">↑↓</kbd> navigate</span>
          <span><kbd className="kbd">↵</kbd> open</span>
          {currentWorkspaceId && <span className="fs-muted">Inside current workspace</span>}
        </div>
      </div>
    </div>,
    document.body,
  )
}