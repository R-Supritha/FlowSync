import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { useSearchParams } from 'react-router-dom'
import { chatApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { channelRead, fetchChannels, messageArrived, upsertChannel } from '../store/chatSlice'
import { pushToast } from '../store/uiSlice'
import useChatStream from '../hooks/useChatStream'
import MessageItem, { MAX_TEXT } from '../components/chat/MessageItem'
import NewChannelDialog from '../components/chat/NewChannelDialog'
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

  const channelId = params.get('c')
  const channel = channels.find((c) => c._id === channelId) || null
  const [view, setView] = useState({ channelId: null, items: [], hasMore: false, status: 'loading', error: '' })
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [newChannel, setNewChannel] = useState(false)
  const [toDelete, setToDelete] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
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
    } else if (ev.type === 'message_edited') {
      replaceMessage(ev.message)
    } else if (ev.type === 'message_deleted') {
      setView((v) => ({ ...v, items: v.items.map((x) => (x._id === ev.id ? { ...x, text: '', deleted: true } : x)) }))
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
                        canEdit={canPost && m.author._id === me}
                        canDelete={m.author._id === me || canManage}
                        onEdit={edit}
                        onDelete={setToDelete}
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
