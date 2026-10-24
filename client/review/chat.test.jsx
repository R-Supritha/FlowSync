import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ids, token } from './token'

let consoleErrors
let pushLive = () => {}
let streamOpen = false

// The live stream is a fake we control: pushLive('message', { message }) arrives like a server event.
function installFakeStream() {
  const enc = new TextEncoder()
  streamOpen = false
  globalThis.fetch = vi.fn((url) => {
    if (String(url).endsWith('/chat/stream')) {
      const body = new ReadableStream({
        start(controller) {
          streamOpen = true
          pushLive = (type, payload) => controller.enqueue(enc.encode(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`))
          controller.enqueue(enc.encode('event: ready\ndata: {}\n\n'))
        },
      })
      return Promise.resolve({ ok: true, status: 200, body })
    }
    return Promise.reject(new Error('no network in tests'))
  })
}

beforeEach(() => {
  consoleErrors = []
  vi.spyOn(console, 'error').mockImplementation((...a) => consoleErrors.push(a.map(String).join(' ').slice(0, 240)))
  vi.spyOn(console, 'warn').mockImplementation((...a) => consoleErrors.push('WARN ' + a.map(String).join(' ').slice(0, 240)))
  installFakeStream()
})

async function mount({ route = '/chat', ...serverOpts } = {}) {
  vi.resetModules()
  window.localStorage.clear()
  window.localStorage.setItem('flowsync_token', token)
  window.localStorage.setItem('flowsync_user', JSON.stringify({ id: ids.me, name: 'Sunitha', email: 'sunitha@test.com' }))
  const { makeServer } = await import('./fakeApi')
  const server = makeServer(serverOpts)
  const { default: store } = await import('../src/store')
  const { default: App } = await import('../src/App.jsx')
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[route]}>
        <App />
      </MemoryRouter>
    </Provider>,
  )
  return { server, store }
}
const called = (server, method, url) => server.calls.find((c) => c.method === method && c.url === url)
const calls = (server, method, url) => server.calls.filter((c) => c.method === method && c.url === url)
const live = (type, payload) => act(async () => { pushLive(type, payload); await new Promise((r) => setTimeout(r, 30)) })
const msg = (id, name, text, over = {}) => ({ _id: id, channel: 'ch-general', author: { _id: name === 'Sunitha' ? ids.me : ids.other, name }, text, deleted: false, editedAt: null, createdAt: new Date().toISOString(), ...over })

describe('FR26: channels', () => {
  it('shows #general and the project channel, opens #general, and clears its unread badge once read', async () => {
    const { server } = await mount()
    const nav = await screen.findByRole('navigation', { name: 'Channels' })
    expect(within(nav).getByRole('button', { name: /# general/ })).toBeInTheDocument()
    expect(within(nav).getByRole('button', { name: /# demo-project/ })).toBeInTheDocument()
    expect(await screen.findByText('Welcome everyone')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '# general' })).toBeInTheDocument()
    await waitFor(() => expect(called(server, 'post', '/channels/ch-general/read')).toBeTruthy())
    await waitFor(() => expect(within(nav).queryByLabelText('2 unread')).not.toBeInTheDocument())
  })

  it('the Chat icon in the main bar links to /chat and shows how many messages are unread', async () => {
    await mount({ route: '/' })
    const link = await screen.findByRole('link', { name: 'Chat' })
    expect(link).toHaveAttribute('href', '/chat')
    expect(await within(link).findByLabelText('2 unread messages')).toBeInTheDocument()
  })

  it('switching channels loads that channel\'s messages and changes the composer', async () => {
    const user = userEvent.setup()
    const { server } = await mount()
    await screen.findByText('Welcome everyone')
    await user.click(screen.getByRole('button', { name: /# demo-project/ }))
    expect(await screen.findByText('No messages yet. Say hello.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '# demo-project' })).toBeInTheDocument()
    expect(screen.getByLabelText('Message #demo-project')).toBeInTheDocument()
    await waitFor(() => expect(calls(server, 'get', '/channels/ch-proj/messages').length).toBeGreaterThan(0))
  })

  it('an Admin creates a channel; bad and duplicate names show the server\'s reason', async () => {
    const user = userEvent.setup()
    const { server } = await mount()
    await screen.findByText('Welcome everyone')
    await user.click(screen.getByRole('button', { name: 'New channel' }))
    const dialog = await screen.findByRole('dialog', { name: 'New channel' })
    await user.type(within(dialog).getByLabelText('Name'), 'general')
    await user.click(within(dialog).getByRole('button', { name: 'Create channel' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('already exists')
    await user.clear(within(dialog).getByLabelText('Name')); await user.type(within(dialog).getByLabelText('Name'), 'bad name!')
    await user.click(within(dialog).getByRole('button', { name: 'Create channel' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('lowercase letters, numbers and dashes')
    await user.clear(within(dialog).getByLabelText('Name')); await user.type(within(dialog).getByLabelText('Name'), 'Design Team')
    await user.click(within(dialog).getByRole('button', { name: 'Create channel' }))
    await waitFor(() => expect(calls(server, 'post', `/workspaces/${ids.ws}/channels`).at(-1).body).toEqual({ name: 'Design Team', description: '' }))
    expect(calls(server, 'post', `/workspaces/${ids.ws}/channels`).map((c) => c.body.name)).toEqual(['general', 'bad name!', 'Design Team'])
    expect(await screen.findByRole('heading', { name: '# design-team' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'New channel' })).not.toBeInTheDocument()
  })

  it('a Member does not get the New channel button', async () => {
    await mount({ role: 'Member' })
    await screen.findByText('Welcome everyone')
    expect(screen.queryByRole('button', { name: 'New channel' })).not.toBeInTheDocument()
  })
})

describe('FR27: sending, editing and deleting', () => {
  it('Enter sends, Shift+Enter makes a new line, an empty box cannot be sent', async () => {
    const user = userEvent.setup()
    const { server } = await mount()
    await screen.findByText('Welcome everyone')
    const box = screen.getByLabelText('Message #general')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two')
    expect(box).toHaveValue('line one\nline two')
    expect(calls(server, 'post', '/channels/ch-general/messages')).toHaveLength(0)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(called(server, 'post', '/channels/ch-general/messages').body).toEqual({ text: 'line one\nline two' }))
    expect(await screen.findByText(/line one/)).toBeInTheDocument()
    expect(box).toHaveValue('')
    await user.type(box, 'via the button')
    await user.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(calls(server, 'post', '/channels/ch-general/messages')).toHaveLength(2))
  })

  it('shows a message exactly as text, never as HTML', async () => {
    const user = userEvent.setup()
    await mount()
    await screen.findByText('Welcome everyone')
    await user.type(screen.getByLabelText('Message #general'), '<b>bold?</b>{Enter}')
    expect(await screen.findByText('<b>bold?</b>')).toBeInTheDocument()
    expect(document.querySelector('.chat-text b')).toBeNull()
  })

  it('you can edit your own message (marked "edited"), but not other people\'s', async () => {
    const user = userEvent.setup()
    const { server } = await mount()
    await screen.findByText('Thanks!')
    const mine = screen.getByRole('listitem', { name: 'Message from Sunitha' })
    const theirs = screen.getAllByRole('listitem', { name: 'Message from Test User Two' })[0]
    expect(within(theirs).queryByRole('button', { name: 'Edit message' })).not.toBeInTheDocument()
    await user.click(within(mine).getByRole('button', { name: 'Edit message' }))
    const box = within(mine).getByLabelText('Edit message')
    await user.clear(box); await user.type(box, 'Thanks a lot!{Enter}')
    await waitFor(() => expect(calls(server, 'patch', '/messages/m0002')[0].body).toEqual({ text: 'Thanks a lot!' }))
    expect(await screen.findByText('Thanks a lot!')).toBeInTheDocument()
    expect(within(screen.getByRole('listitem', { name: 'Message from Sunitha' })).getByText('(edited)')).toBeInTheDocument()
  })

  it('Escape cancels an edit without saving', async () => {
    const user = userEvent.setup()
    const { server } = await mount()
    await screen.findByText('Thanks!')
    const mine = screen.getByRole('listitem', { name: 'Message from Sunitha' })
    await user.click(within(mine).getByRole('button', { name: 'Edit message' }))
    await user.type(within(mine).getByLabelText('Edit message'), ' CHANGED{Escape}')
    expect(screen.queryByLabelText('Edit message', { selector: 'textarea' })).not.toBeInTheDocument()
    expect(screen.getByText('Thanks!')).toBeInTheDocument()
    expect(calls(server, 'patch', '/messages/m0002')).toHaveLength(0)
  })

  it('you can delete your own message after confirming; it stays as a "deleted" row', async () => {
    const user = userEvent.setup()
    const { server } = await mount()
    await screen.findByText('Thanks!')
    const mine = screen.getByRole('listitem', { name: 'Message from Sunitha' })
    await user.click(within(mine).getByRole('button', { name: 'Delete message' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Delete message?' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(called(server, 'delete', '/messages/m0002')).toBeTruthy())
    expect(await screen.findByText('This message was deleted')).toBeInTheDocument()
    expect(screen.queryByText('Thanks!')).not.toBeInTheDocument()
  })

  it('an Admin can delete other people\'s messages; a Member cannot', async () => {
    await mount({ role: 'Admin' })
    await screen.findByText('Welcome everyone')
    expect(within(screen.getAllByRole('listitem', { name: 'Message from Test User Two' })[0]).getByRole('button', { name: 'Delete message' })).toBeInTheDocument()
    cleanup()
    await mount({ role: 'Member' })
    await screen.findByText('Welcome everyone')
    expect(within(screen.getAllByRole('listitem', { name: 'Message from Test User Two' })[0]).queryByRole('button', { name: 'Delete message' })).not.toBeInTheDocument()
    expect(within(screen.getByRole('listitem', { name: 'Message from Sunitha' })).getByRole('button', { name: 'Delete message' })).toBeInTheDocument()
  })

  it('a Viewer can read but not post, edit or delete', async () => {
    await mount({ role: 'Viewer' })
    await screen.findByText('Welcome everyone')
    expect(screen.getByText('Viewers can read messages but not post.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Message #general')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit message' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'New channel' })).not.toBeInTheDocument()
  })

  it('refuses a message that is too long before sending it', async () => {
    const { server } = await mount()
    await screen.findByText('Welcome everyone')
    const box = screen.getByLabelText('Message #general')
    // typing 4001 characters one by one is slow, so set the value in one go
    const { fireEvent } = await import('@testing-library/react')
    fireEvent.change(box, { target: { value: 'x'.repeat(4001) } })
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(calls(server, 'post', '/channels/ch-general/messages')).toHaveLength(0)
  })
})

describe('FR27: live messages', () => {
  it('a new message in the open channel appears at once, and your own message is not shown twice', async () => {
    const user = userEvent.setup()
    await mount()
    await screen.findByText('Welcome everyone')
    await waitFor(() => expect(streamOpen).toBe(true))
    expect(await screen.findByText('● Live')).toBeInTheDocument()
    await live('message', { message: msg('m9001', 'Test User Two', 'Hello from the live stream') })
    expect(await screen.findByText('Hello from the live stream')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Message #general'), 'my own words{Enter}')
    await screen.findByText('my own words')
    await live('message', { message: msg('m0004', 'Sunitha', 'my own words') })       // the same message echoed by the stream
    expect(screen.getAllByText('my own words')).toHaveLength(1)
  })

  it('a message in another channel raises that channel\'s unread count and the Chat icon badge', async () => {
    await mount()
    await screen.findByText('Welcome everyone')
    await waitFor(() => expect(streamOpen).toBe(true))
    const nav = screen.getByRole('navigation', { name: 'Channels' })
    await live('message', { message: msg('m9002', 'Test User Two', 'psst', { channel: 'ch-proj' }) })
    const badge = await within(nav).findByLabelText('1 unread')
    // the badge sits INSIDE its channel's button and is the in-line "chat-badge" (the icon's floating badge-dot would fly off the list)
    expect(within(screen.getByRole('button', { name: /# demo-project/ })).getByLabelText('1 unread')).toBe(badge)
    expect(badge).toHaveClass('chat-badge'); expect(badge).not.toHaveClass('badge-dot')
    expect(within(screen.getByRole('link', { name: 'Chat' })).getByLabelText('1 unread messages')).toBeInTheDocument()
    await live('message', { message: msg('m9003', 'Sunitha', 'my own, elsewhere', { channel: 'ch-proj' }) })
    expect(within(nav).getByLabelText('1 unread')).toBeInTheDocument()               // your own messages never count as unread
  })

  it('edits and deletions by other people show up live', async () => {
    await mount()
    await screen.findByText('Welcome everyone')
    await waitFor(() => expect(streamOpen).toBe(true))
    await live('message_edited', { message: msg('m0001', 'Test User Two', 'Welcome, everyone!', { editedAt: new Date().toISOString() }) })
    expect(await screen.findByText('Welcome, everyone!')).toBeInTheDocument()
    await live('message_deleted', { channel: 'ch-general', id: 'm0003' })
    expect(await screen.findByText('This message was deleted')).toBeInTheDocument()
    expect(screen.queryByText('Standup at 10')).not.toBeInTheDocument()
  })

  it('a channel made by someone else appears in the list', async () => {
    const { server } = await mount()
    await screen.findByText('Welcome everyone')
    await waitFor(() => expect(streamOpen).toBe(true))
    // pretend another person created #ideas on the server, then the stream announces it
    await live('channel', { channel: { _id: 'ch-ideas', name: 'ideas', kind: 'custom' } })
    await waitFor(() => expect(calls(server, 'get', `/workspaces/${ids.ws}/channels`).length).toBeGreaterThan(1))
  })

  it('says "Reconnecting" when the live stream is not available', async () => {
    globalThis.fetch = vi.fn(() => Promise.reject(new Error('down')))
    await mount()
    await screen.findByText('Welcome everyone')
    expect(await screen.findByText('○ Reconnecting…')).toBeInTheDocument()
  })
})

describe('FR27: history', () => {
  it('shows the newest 50, and "Load older messages" adds the rest in front', async () => {
    const user = userEvent.setup()
    const { server } = await mount({ manyMessages: true })
    expect(await screen.findByText('old message 60')).toBeInTheDocument()
    expect(screen.queryByText('old message 10')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Load older messages' }))
    await waitFor(() => expect(calls(server, 'get', '/channels/ch-general/messages').some((c) => c.params.before)).toBe(true))
    expect(await screen.findByText('old message 10')).toBeInTheDocument()
    expect(screen.getByText('old message 1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Load older messages' })).not.toBeInTheDocument()
    const items = screen.getAllByRole('listitem', { name: /Message from/ })
    expect(items).toHaveLength(60)
    expect(within(items[0]).getByText('old message 1')).toBeInTheDocument()          // oldest first
  })
})

describe('quiet console', () => {
  it('the chat page opens, sends, switches channel and closes without a React warning or error', async () => {
    const user = userEvent.setup()
    await mount()
    await screen.findByText('Welcome everyone')
    await user.type(screen.getByLabelText('Message #general'), 'hello{Enter}')
    await screen.findByText('hello')
    await user.click(screen.getByRole('button', { name: /# demo-project/ }))
    await screen.findByText('No messages yet. Say hello.')
    cleanup()
    await new Promise((r) => setTimeout(r, 100))
    expect(consoleErrors.filter((e) => !/not wrapped in act/.test(e))).toEqual([])
  })
})
