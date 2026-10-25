import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useSearchParams } from 'react-router-dom'
import { chatApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { channelCleared, channelRead, fetchChannels, messageArrived, removeChannel, upsertChannel } from '../store/chatSlice'
import { openTask, pushToast } from '../store/uiSlice'
import useChatStream from '../hooks/useChatStream'
import MessageItem, { MAX_TEXT } from '../components/chat/MessageItem'
import NewChannelDialog from '../components/chat/NewChannelDialog'
import EditChannelDialog from '../components/chat/EditChannelDialog'
import CreateTaskDialog from '../components/chat/CreateTaskDialog'
import { mentionMatches, refsIn } from '../utils/chatText'
import { taskRef } from '../utils/format'
import { ConfirmDialog, ErrorState, Spinner } from '../components/ui'

const POLL_MS = 15000 // only used while the live stream is down
const NEAR_BOTTOM = 80

// FR26 + FR27: channels on the left, the messages of one channel on the right, new messages arrive live.
export default function ChatPage() {
  const dispatch = useDispatch()
  const [params, setParams] = useSearchParams()
  const workspaceId = useSelector((s) => s.workspaces.currentId)
  const me = useSelector((s) => s.auth.user && s.auth.user.id)
  const { channels, canPost, canManage, status, error } = useSelector((s) => s.chat)
  const people = useSelector((s) => s.workspaces.people[s.workspaces.currentId]) || {}

  const channelId = params.get('c')
  const channel = channels.find((c) => c._id === channelId) || null
  const [view, setView] = useState({ channelId: null, items: [], hasMore: false, status: 'loading', error: '' })
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [newChannel, setNewChannel] = useState(false)
  const [toDelete, setToDelete] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [editing, setEditing] = useState(false)
  const [toClear, setToClear] = useState(false)
  const [toRemove, setToRemove] = useState(false)
  const [toArchive, setToArchive] = useState(false)
  const [archivedOpen, setArchivedOpen] = useState(false)
  const [archived, setArchived] = useState({ status: 'idle', items: [] })
  const [creating, setCreating] = useState(null) // the message being turned into a task
  const [refMap, setRefMap] = useState({}) // 'fs-13c22c' -> the task, or null when there is none
  const asked = useRef(new Set())
  const listRef = useRef(null)
  const stick = useRef(true)
  const activeRef = useRef(null)

  // make sure the channel list is loaded (the app also refreshes it every 30 seconds)
  useEffect(() => {
    if (workspaceId && status === 'idle') dispatch(fetchChannels(workspaceId))
  }, [workspaceId, status, dispatch])

  // pick #general (the first channel) when none is chosen or the chosen one is gone
  useEffect(() => {
    if (status !== 'ready' || channels.length === 0) return
    if (!channels.some((c) => c._id === channelId)) setParams({ c: channels[0]._id }, { replace: true })
  }, [status, channels, channelId, setParams])

  useEffect(() => {
    activeRef.current = channel ? channel._id : null
  })

  // load the messages of the chosen channel, then mark it read
  useEffect(() => {
    if (!channel) return undefined
    let alive = true
    const id = channel._id
    stick.current = true
    chatApi
      .messages(id, { limit: 50 })
      .then((res) => {
        if (!alive) return
        asked.current = new Set() // look the references of this channel up afresh (titles and statuses may have changed)
        setRefMap({})
        setView({ channelId: id, items: res.messages, hasMore: res.hasMore, status: 'ready', error: '' })
        return chatApi.markRead(id).then(() => dispatch(channelRead(id)))
      })
      .catch((e) => {
        if (alive) setView({ channelId: id, items: [], hasMore: false, status: 'error', error: errorMessage(e, 'Could not load the messages') })
      })
    return () => {
      alive = false
    }
  }, [channel && channel._id, reloadKey, dispatch]) // eslint-disable-line react-hooks/exhaustive-deps

  // FS-xxxxxx references on screen become task chips: ask the server about the new ones, once
  useEffect(() => {
    if (!workspaceId) return undefined
    const wanted = []
    for (const m of view.items) {
      if (m.deleted) continue
      for (const r of refsIn(m.text)) if (!asked.current.has(r) && !wanted.includes(r)) wanted.push(r)
    }
    if (wanted.length === 0) return undefined
    const batch = wanted.slice(0, 30)
    batch.forEach((r) => asked.current.add(r))
    let alive = true
    chatApi
      .taskRefs(workspaceId, batch)
      .then((res) => {
        if (!alive) return
        setRefMap((prev) => {
          const next = { ...prev }
          batch.forEach((r) => { next[r] = null })
          res.tasks.forEach((t) => { next[t.ref.toLowerCase()] = t })
          return next
        })
      })
      .catch(() => batch.forEach((r) => asked.current.delete(r)))
    return () => {
      alive = false
    }
  }, [view.items, workspaceId])

  // the list of archived channels (Admin or Manager), kept fresh while it is open
  useEffect(() => {
    if (!archivedOpen || !workspaceId || !canManage) return undefined
    let alive = true
    chatApi
      .channels(workspaceId, { archived: true })
      .then((res) => alive && setArchived({ status: 'ready', items: res.channels }))
      .catch(() => alive && setArchived({ status: 'error', items: [] }))
    return () => {
      alive = false
    }
  }, [archivedOpen, workspaceId, canManage, channels.length])

  // keep the newest message in view, unless you scrolled up to read older ones
  useEffect(() => {
    const el = listRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [view.items])

  const onScroll = () => {
    const el = listRef.current
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM
  }

  const addMessage = useCallback((m) => {
    setView((v) => (v.channelId !== m.channel || v.items.some((x) => x._id === m._id) ? v : { ...v, items: [...v.items, m] }))
  }, [])
  const replaceMessage = useCallback((m) => {
    setView((v) => ({ ...v, items: v.items.map((x) => (x._id === m._id ? m : x)) }))
  }, [])

  // live events
  const live = useChatStream(workspaceId, (ev) => {
    if (ev.type === 'message') {
      const m = ev.message
      const active = m.channel === activeRef.current
      dispatch(messageArrived({ channelId: m.channel, message: m, mine: m.author._id === me, active }))
      if (active) {
        addMessage(m)
        if (m.author._id !== me) chatApi.markRead(m.channel).catch(() => {})
      }
    } else if (ev.type === 'message_edited' || ev.type === 'message_reacted') {
      replaceMessage(ev.message)
    } else if (ev.type === 'message_deleted') {
      setView((v) => ({ ...v, items: v.items.map((x) => (x._id === ev.id ? { ...x, text: '', deleted: true } : x)) }))
    } else if (ev.type === 'channel_cleared') {
      dispatch(channelCleared(ev.channel))
      setView((v) => (v.channelId === ev.channel ? { ...v, items: [], hasMore: false } : v))
    } else if (ev.type === 'channel_deleted') {
      dispatch(removeChannel(ev.id))
    } else if (ev.type === 'channel') {
      dispatch(fetchChannels(workspaceId))
    }
  })

  // while the stream is down, ask for newer messages every 15 seconds
  useEffect(() => {
    if (live || !channel) return undefined
    const id = channel._id
    const timer = setInterval(() => {
      setView((v) => {
        const last = v.items.length ? v.items[v.items.length - 1]._id : null
        if (v.channelId === id && last) {
          chatApi.messages(id, { after: last }).then((res) => res.messages.forEach(addMessage)).catch(() => {})
        }
        return v
      })
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [live, channel && channel._id, addMessage]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadOlder() {
    const first = view.items[0]
    if (!first) return
    const el = listRef.current
    stick.current = false
    try {
      const res = await chatApi.messages(channel._id, { limit: 50, before: first._id })
      setView((v) => ({ ...v, items: [...res.messages, ...v.items], hasMore: res.hasMore }))
      if (el) requestAnimationFrame(() => { el.scrollTop = 0 })
    } catch (e) {
      dispatch(pushToast(errorMessage(e, 'Could not load older messages'), 'error'))
    }
  }

  async function send() {
    const body = text.trim()
    if (!body || body.length > MAX_TEXT || sending || !channel) return
    setSending(true)
    try {
      const res = await chatApi.send(channel._id, body)
      stick.current = true
      addMessage(res.message)
      dispatch(messageArrived({ channelId: channel._id, message: res.message, mine: true, active: true }))
      setText('')
    } catch (e) {
      dispatch(pushToast(errorMessage(e, 'Could not send the message'), 'error'))
    } finally {
      setSending(false)
    }
  }

  const onComposerKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  async function archiveThisChannel() {
    const id = channel._id
    setToArchive(false)
    try {
      await chatApi.updateChannel(id, { archived: true })
      dispatch(removeChannel(id)) // the page then falls back to #general by itself
      dispatch(pushToast('Channel archived. You can restore it under "Archived channels".', 'success'))
    } catch (e) {
      dispatch(pushToast(errorMessage(e, 'Could not archive the channel'), 'error'))
    }
  }

  async function restore(c) {
    try {
      await chatApi.updateChannel(c._id, { archived: false })
      setArchived((a) => ({ ...a, items: a.items.filter((x) => x._id !== c._id) }))
      dispatch(fetchChannels(workspaceId))
      dispatch(pushToast(`#${c.name} is back`, 'success'))
    } catch (e) {
      dispatch(pushToast(errorMessage(e, 'Could not restore the channel'), 'error'))
    }
  }

  function taskCreated(task, sent) {
    setRefMap((prev) => ({ ...prev, [taskRef(task._id)]: { ref: taskRef(task._id), _id: task._id, title: task.title, status: task.status, project: task.project } }))
    if (sent) addMessage(sent)
    dispatch(pushToast(`Task ${taskRef(task._id).toUpperCase()} created`, 'success'))
  }

  async function react(message, emoji) {
    try {
      const res = await chatApi.react(message._id, emoji)
      replaceMessage(res.message)
    } catch (e) {
      dispatch(pushToast(errorMessage(e, 'Could not react to the message'), 'error'))
    }
  }

  async function edit(message, newText) {
    try {
      const res = await chatApi.edit(message._id, newText)
      replaceMessage(res.message)
      return true
    } catch (e) {
      dispatch(pushToast(errorMessage(e, 'Could not edit the message'), 'error'))
      return false
    }
  }

  async function clearChat() {
    const id = channel._id
    setToClear(false)
    try {
      await chatApi.clear(id)
      setView((v) => (v.channelId === id ? { ...v, items: [], hasMore: false } : v))
      dispatch(channelCleared(id))
    } catch (e) {
      dispatch(pushToast(errorMessage(e, 'Could not clear the chat'), 'error'))
    }
  }

  async function deleteThisChannel() {
    const id = channel._id
    setToRemove(false)
    try {
      await chatApi.removeChannel(id)
      dispatch(removeChannel(id)) // the page then falls back to #general by itself
    } catch (e) {
      dispatch(pushToast(errorMessage(e, 'Could not delete the channel'), 'error'))
    }
  }

  async function confirmDelete() {
    const m = toDelete
    setToDelete(null)
    try {
      await chatApi.remove(m._id)
      setView((v) => ({ ...v, items: v.items.map((x) => (x._id === m._id ? { ...x, text: '', deleted: true } : x)) }))
    } catch (e) {
      dispatch(pushToast(errorMessage(e, 'Could not delete the message'), 'error'))
    }
  }

  if (!workspaceId) return <Spinner label="Loading workspace…" />
  if (status === 'error' && channels.length === 0) return <ErrorState message={error} onRetry={() => dispatch(fetchChannels(workspaceId))} />
  if (status !== 'ready') return <Spinner label="Loading channels…" />

  const ready = view.channelId === (channel && channel._id)
  const tooLong = text.length > MAX_TEXT

  return (
    <div className="chat-layout">
      <nav className="chat-channels" aria-label="Channels">
        <div className="fs-row" style={{ justifyContent: 'space-between' }}>
          <strong>Channels</strong>
          {canManage && <button type="button" className="fs-btn small" aria-label="New channel" onClick={() => setNewChannel(true)}>+ New</button>}
        </div>
        <ul className="list">
          {channels.map((c) => (
            <li key={c._id}>
              <button
                type="button"
                className={`chat-channel${channel && channel._id === c._id ? ' active' : ''}`}
                aria-current={channel && channel._id === c._id ? 'true' : undefined}
                onClick={() => setParams({ c: c._id })}
              >
                <span># {c.name}</span>
                {c.unread > 0 && <span className="chat-badge" aria-label={`${c.unread} unread`}>{c.unread > 99 ? '99+' : c.unread}</span>}
              </button>
            </li>
          ))}
        </ul>
        {canManage && (
          <div style={{ marginTop: 10 }}>
            <button type="button" className="fs-btn small ghost" aria-expanded={archivedOpen} onClick={() => setArchivedOpen((o) => !o)}>Archived channels</button>
            {archivedOpen && (
              <ul className="list" aria-label="Archived channels">
                {archived.status !== 'ready' && <li className="fs-muted">{archived.status === 'error' ? 'Could not load them' : 'Loading…'}</li>}
                {archived.status === 'ready' && archived.items.length === 0 && <li className="fs-muted">No archived channels</li>}
                {archived.items.map((c) => (
                  <li key={c._id} className="fs-row" style={{ justifyContent: 'space-between', gap: 6 }}>
                    <span># {c.name}</span>
                    <button type="button" className="fs-btn small" aria-label={`Restore ${c.name}`} onClick={() => restore(c)}>Restore</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </nav>

      <section className="chat-main" aria-label={channel ? `Channel ${channel.name}` : 'Chat'}>
        {!channel ? (
          <p className="fs-muted">No channels yet.</p>
        ) : (
          <>
            <header className="chat-header">
              <h1># {channel.name}</h1>
              <span className="fs-muted">{channel.description}</span>
              <span className="fs-muted" style={{ marginLeft: 'auto' }} role="status">{live ? '● Live' : '○ Reconnecting…'}</span>
              {canManage && (
                <div className="fs-row" style={{ gap: 4 }}>
                  {channel.kind === 'custom' && <button type="button" className="fs-btn small ghost" aria-label="Edit channel" onClick={() => setEditing(true)}>Edit</button>}
                  <button type="button" className="fs-btn small ghost" aria-label="Clear chat" onClick={() => setToClear(true)}>Clear chat</button>
                  {channel.kind === 'custom' && <button type="button" className="fs-btn small ghost" aria-label="Archive channel" onClick={() => setToArchive(true)}>Archive</button>}
                  {channel.kind === 'custom' && <button type="button" className="fs-btn small ghost" aria-label="Delete channel" onClick={() => setToRemove(true)}>Delete channel</button>}
                </div>
              )}
            </header>

            <div className="chat-messages" ref={listRef} onScroll={onScroll}>
              {ready && view.status === 'loading' && <Spinner label="Loading messages…" />}
              {ready && view.status === 'error' && <ErrorState message={view.error} onRetry={() => { setView((v) => ({ ...v, status: 'loading' })); setReloadKey((k) => k + 1) }} />}
              {ready && view.status === 'ready' && (
                <>
                  {view.hasMore && <button type="button" className="fs-btn small" onClick={loadOlder}>Load older messages</button>}
                  {view.items.length === 0 && <p className="fs-muted">No messages yet. Say hello.</p>}
                  <ul className="list">
                    {view.items.map((m) => (
                      <MessageItem
                        key={m._id}
                        message={m}
                        mine={m.author._id === me}
                        me={me}
                        canEdit={canPost && m.author._id === me}
                        canDelete={m.author._id === me || canManage}
                        canReact={canPost}
                        canCreateTask={canPost && channel.kind === 'project'}
                        people={people}
                        taskByRef={refMap}
                        onEdit={edit}
                        onDelete={setToDelete}
                        onReact={react}
                        onCreateTask={setCreating}
                        onOpenTask={(t) => dispatch(openTask(t._id))}
                      />
                    ))}
                  </ul>
                </>
              )}
            </div>

            {canPost && !channel.isArchived ? (
              <div className="chat-composer">
                <textarea
                  className="fs-textarea"
                  aria-label={`Message #${channel.name}`}
                  placeholder={`Message #${channel.name}`}
                  rows={2}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={onComposerKey}
                />
                {mentionMatches(text, people).length > 0 && (
                  <div className="fs-row" role="listbox" aria-label="Mention suggestions" style={{ flexWrap: 'wrap', gap: 4, margin: '4px 0' }}>
                    {mentionMatches(text, people).map((p) => (
                      <button key={p.id} type="button" role="option" className="fs-btn small" onClick={() => setText((t) => t.replace(/@(\w*)$/, `@${p.name.split(/\s+/)[0]} `))}>
                        @{p.name.split(/\s+/)[0]}
                      </button>
                    ))}
                  </div>
                )}
                <div className="fs-row" style={{ justifyContent: 'space-between' }}>
                  <span className={tooLong ? 'fs-error' : 'fs-muted'}>
                    {text.length > MAX_TEXT - 500 ? `${text.length}/${MAX_TEXT}` : 'Enter to send, Shift+Enter for a new line'}
                  </span>
                  <button type="button" className="fs-btn primary" disabled={!text.trim() || tooLong || sending} onClick={send}>
                    {sending ? 'Sending…' : 'Send'}
                  </button>
                </div>
              </div>
            ) : (
              <p className="readonly-note">Viewers can read messages but not post.</p>
            )}
          </>
        )}
      </section>

      {newChannel && (
        <NewChannelDialog
          workspaceId={workspaceId}
          onClose={() => setNewChannel(false)}
          onCreated={(c) => {
            dispatch(upsertChannel(c))
            setParams({ c: c._id })
          }}
        />
      )}
      {editing && channel && <EditChannelDialog channel={channel} onClose={() => setEditing(false)} onSaved={(c) => dispatch(upsertChannel(c))} />}
      {toArchive && channel && (
        <ConfirmDialog
          title="Archive this channel?"
          message={`#${channel.name} will disappear from the list for everyone. Its messages are kept, and an Admin or Manager can restore it under "Archived channels".`}
          confirmLabel="Archive"
          onCancel={() => setToArchive(false)}
          onConfirm={archiveThisChannel}
        />
      )}
      {creating && channel && <CreateTaskDialog message={creating} channel={channel} onClose={() => setCreating(null)} onCreated={taskCreated} />}
      {toClear && channel && (
        <ConfirmDialog
          title="Clear this chat?"
          message={`Every message in #${channel.name} will be deleted for everyone. This cannot be undone.`}
          confirmLabel="Clear chat"
          danger
          onCancel={() => setToClear(false)}
          onConfirm={clearChat}
        />
      )}
      {toRemove && channel && (
        <ConfirmDialog
          title="Delete this channel?"
          message={`#${channel.name} and all its messages will be deleted for everyone. This cannot be undone.`}
          confirmLabel="Delete channel"
          danger
          onCancel={() => setToRemove(false)}
          onConfirm={deleteThisChannel}
        />
      )}
      {toDelete && (
        <ConfirmDialog
          title="Delete message?"
          message="This message will be removed for everyone in the channel."
          confirmLabel="Delete"
          danger
          onCancel={() => setToDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  )
}
