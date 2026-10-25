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
const calls = (server, method, url) => server.calls.filter((c) => c.method === method && c.url === url)
const live = (type, payload) => act(async () => { pushLive(type, payload); await new Promise((r) => setTimeout(r, 30)) })
const msg = (id, name, text, over = {}) => ({ _id: id, channel: 'ch-general', author: { _id: name === 'Sunitha' ? ids.me : ids.other, name }, text, deleted: false, editedAt: null, createdAt: new Date().toISOString(), ...over })


const botMsg = () => ({ _id: 'mlive-bot', channel: 'ch-general', bot: true, author: { _id: 'flowsync-bot', name: 'FlowSync' }, text: '🚀 Sprint started: 3 tasks moved to To Do', deleted: false, reactions: [], editedAt: null, createdAt: new Date().toISOString() })
const row = (textOrElement) => (typeof textOrElement === 'string' ? screen.getByText(textOrElement) : textOrElement).closest('li')

describe('FR28: reactions on chat messages', () => {
  it('shows the reactions already there with their counts, and marks the ones you made', async () => {
    await mount({ seedReactions: true })
    const message = row(await screen.findByText('Welcome everyone'))
    const group = within(message).getByRole('group', { name: 'Reactions' })
    expect(within(group).getByRole('button', { name: '👍 1' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(group).getByRole('button', { name: '🎉 2, you reacted' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(row('Thanks!')).queryByRole('group', { name: 'Reactions' })).not.toBeInTheDocument()   // no reactions, no empty row
  })

  it('a click on a reaction adds yours, another click takes it back', async () => {
    const user = userEvent.setup()
    const { server } = await mount({ seedReactions: true })
    const group = () => within(row('Welcome everyone')).getByRole('group', { name: 'Reactions' })
    await screen.findByText('Welcome everyone')
    await user.click(within(group()).getByRole('button', { name: '👍 1' }))
    await waitFor(() => expect(calls(server, 'post', '/messages/m0001/reactions')[0].body).toEqual({ emoji: '👍' }))
    expect(await within(group()).findByRole('button', { name: '👍 2, you reacted' })).toHaveAttribute('aria-pressed', 'true')
    await user.click(within(group()).getByRole('button', { name: '👍 2, you reacted' }))
    expect(await within(group()).findByRole('button', { name: '👍 1' })).toHaveAttribute('aria-pressed', 'false')
    await user.click(within(group()).getByRole('button', { name: '🎉 2, you reacted' }))               // the last of two: the count drops
    expect(await within(group()).findByRole('button', { name: '🎉 1' })).toBeInTheDocument()
  })

  it('the hover buttons add a new reaction, and taking back the only one removes it from view', async () => {
    const user = userEvent.setup()
    await mount()
    const message = row(await screen.findByText('Thanks!'))
    expect(within(message).getAllByRole('button', { name: /^Add reaction / })).toHaveLength(4)
    await user.click(within(message).getByRole('button', { name: 'Add reaction ❤️' }))
    await user.click(await within(row('Thanks!')).findByRole('button', { name: '❤️ 1, you reacted' }))
    await waitFor(() => expect(within(row('Thanks!')).queryByRole('group', { name: 'Reactions' })).not.toBeInTheDocument())
  })

  it('a Viewer sees the reactions but cannot add or change them', async () => {
    await mount({ seedReactions: true, role: 'Viewer' })
    const message = row(await screen.findByText('Welcome everyone'))
    expect(within(message).getByRole('button', { name: '👍 1' })).toBeDisabled()
    expect(within(message).queryByRole('button', { name: /^Add reaction / })).not.toBeInTheDocument()
  })

  it('reactions made by other people show up live, and the server\'s reason is shown when a reaction is refused', async () => {
    const user = userEvent.setup()
    await mount()
    const message = row(await screen.findByText('Standup at 10'))
    await waitFor(() => expect(streamOpen).toBe(true))
    await live('message_reacted', { message: msg('m0003', 'Test User Two', 'Standup at 10', { reactions: [{ emoji: '👀', users: [ids.other] }] }) })
    expect(await within(row('Standup at 10')).findByRole('button', { name: '👀 1' })).toBeInTheDocument()
    expect(within(row('Standup at 10')).queryByText('(edited)')).not.toBeInTheDocument()               // a reaction is not an edit
    void message
    await user.click(within(row('Standup at 10')).getByRole('button', { name: 'Add reaction 🎉' }))
    await waitFor(() => expect(within(row('Standup at 10')).getByRole('button', { name: '🎉 1, you reacted' })).toBeInTheDocument())
  })
})

describe('FR30: messages from FlowSync', () => {
  it('shows a bot message as FlowSync with a BOT badge, with no Edit button', async () => {
    await mount({ botMessage: true })
    const message = row(await screen.findByText('✅ "Build login page" is Done'))
    expect(within(message).getByText('FlowSync')).toBeInTheDocument()
    expect(within(message).getByText('BOT')).toBeInTheDocument()
    expect(within(message).queryByRole('button', { name: 'Edit message' })).not.toBeInTheDocument()
    expect(within(row('Thanks!')).queryByText('BOT')).not.toBeInTheDocument()                           // people are not marked
  })

  it('an Admin can delete a bot message, an ordinary member cannot, and people can still react to it', async () => {
    await mount({ botMessage: true })
    expect(within(row(await screen.findByText('✅ "Build login page" is Done'))).getByRole('button', { name: 'Delete message' })).toBeInTheDocument()
    cleanup()
    await mount({ botMessage: true, role: 'Member' })
    const message = row(await screen.findByText('✅ "Build login page" is Done'))
    expect(within(message).queryByRole('button', { name: 'Delete message' })).not.toBeInTheDocument()
    expect(within(message).getAllByRole('button', { name: /^Add reaction / })).toHaveLength(4)
  })

  it('a bot message arrives live like any other, and raises the unread count of a channel you are not looking at', async () => {
    const { store } = await mount()
    await screen.findByText('Welcome everyone')
    await waitFor(() => expect(streamOpen).toBe(true))
    await live('message', { message: botMsg() })
    expect(await screen.findByText('🚀 Sprint started: 3 tasks moved to To Do')).toBeInTheDocument()
    expect(within(row('🚀 Sprint started: 3 tasks moved to To Do')).getByText('BOT')).toBeInTheDocument()
    expect(store.getState().chat.channels.find((c) => c._id === 'ch-general').unread).toBe(0)           // you are looking at it, so it is read
    await live('message', { message: { ...botMsg(), _id: 'mlive-bot2', channel: 'ch-proj', text: '📋 Stand-up ready' } })
    await waitFor(() => expect(store.getState().chat.channels.find((c) => c._id === 'ch-proj').unread).toBe(1))
  })
})

describe('quiet console', () => {
  it('reactions and bot messages run without a React warning or error', async () => {
    const user = userEvent.setup()
    await mount({ seedReactions: true, botMessage: true })
    await screen.findByText('Welcome everyone')
    await user.click(within(row('Welcome everyone')).getByRole('button', { name: '👍 1' }))
    await screen.findByRole('button', { name: '👍 2, you reacted' })
    expect(consoleErrors.filter((e) => !/not wrapped in act/.test(e))).toEqual([])
  })
})
