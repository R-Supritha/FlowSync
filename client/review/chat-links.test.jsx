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



const rowWith = (needle) => screen.getAllByRole('listitem').find((li) => li.className === 'chat-msg' && li.textContent.includes(needle))
const makeIdeas = async (user) => {
  await user.click(await screen.findByRole('button', { name: 'New channel' }))
  const dialog = await screen.findByRole('dialog', { name: 'New channel' })
  await user.type(within(dialog).getByLabelText('Name'), 'ideas')
  await user.click(within(dialog).getByRole('button', { name: 'Create channel' }))
  await screen.findByRole('heading', { name: '# ideas' })
}

describe('FR29: task references become chips', () => {
  it('a known FS-xxxxxx reference becomes a chip with the task title and status; an unknown one stays plain text', async () => {
    const { server } = await mount({ chatLinks: true })
    const message = await waitFor(() => { const m = rowWith('Please review'); if (!m) throw new Error('not yet'); return m })
    const chip = await within(message).findByRole('button', { name: 'Open task FS-0140AD: Build login page' })
    expect(chip).toHaveTextContent('Build login page'); expect(chip).toHaveTextContent('Backlog')
    expect(message).toHaveTextContent('FS-ffffff')                                                     // no such task: left as typed
    expect(within(message).queryByRole('button', { name: /FS-FFFFFF/ })).not.toBeInTheDocument()
    expect(calls(server, 'post', `/workspaces/${ids.ws}/chat/task-refs`)).toHaveLength(1)           // one look-up for the page
    expect(calls(server, 'post', `/workspaces/${ids.ws}/chat/task-refs`)[0].body.refs.sort()).toEqual(['fs-0140ad', 'fs-ffffff'])
  })

  it('a click on a chip opens that task', async () => {
    const user = userEvent.setup()
    await mount({ chatLinks: true })
    const message = await waitFor(() => { const m = rowWith('Please review'); if (!m) throw new Error('not yet'); return m })
    await user.click(await within(message).findByRole('button', { name: 'Open task FS-0140AD: Build login page' }))
    expect(await screen.findByRole('dialog', { name: 'Task details' })).toBeInTheDocument()
  })

  it('a reference that arrives live is looked up and shown as a chip too', async () => {
    const { server } = await mount()
    await screen.findByText('Welcome everyone')
    await waitFor(() => expect(streamOpen).toBe(true))
    expect(calls(server, 'post', `/workspaces/${ids.ws}/chat/task-refs`)).toHaveLength(0)             // no references yet: nothing is asked
    await live('message', { message: msg('mlive1', 'Test User Two', 'Look at FS-0140ad please') })
    expect(await screen.findByRole('button', { name: 'Open task FS-0140AD: Build login page' })).toBeInTheDocument()
  })
})

describe('FR29: turn a message into a task', () => {
  it('a project channel offers it, with the message as title and description, and posts a chip for the new task', async () => {
    const user = userEvent.setup()
    const { server } = await mount({ chatLinks: true })
    await user.click(await within(await screen.findByRole('navigation', { name: 'Channels' })).findByRole('button', { name: /# demo-project/ }))
    const message = await waitFor(() => { const m = rowWith('Fix the login bug on mobile'); if (!m) throw new Error('not yet'); return m })
    await user.click(within(message).getByRole('button', { name: 'Create task from message' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create task from message' })
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Fix the login bug on mobile')
    expect(within(dialog).getByLabelText('Description')).toHaveValue('Fix the login bug on mobile')
    await user.clear(within(dialog).getByLabelText('Title')); await user.type(within(dialog).getByLabelText('Title'), 'Fix mobile login')
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))
    await waitFor(() => expect(calls(server, 'post', `/projects/${ids.project}/tasks`)[0].body).toEqual({ title: 'Fix mobile login', description: 'Fix the login bug on mobile' }))
    await waitFor(() => expect(calls(server, 'post', '/channels/ch-proj/messages')[0].body).toEqual({ text: '📌 Task FS-0140B0 created from a message' }))
    expect(await screen.findByText('Task FS-0140B0 created')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Open task FS-0140B0: Fix mobile login/ })).toBeInTheDocument()   // the posted note shows as a chip
  })

  it('the link can be left out, a title is required, and a refusal is shown', async () => {
    const user = userEvent.setup()
    const { server } = await mount({ chatLinks: true })
    await user.click(await within(await screen.findByRole('navigation', { name: 'Channels' })).findByRole('button', { name: /# demo-project/ }))
    await user.click(within(await waitFor(() => { const m = rowWith('Fix the login bug on mobile'); if (!m) throw new Error('not yet'); return m })).getByRole('button', { name: 'Create task from message' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create task from message' })
    await user.clear(within(dialog).getByLabelText('Title'))
    expect(within(dialog).getByRole('button', { name: 'Create task' })).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Title'), 'Quiet task')
    await user.click(within(dialog).getByRole('checkbox', { name: /Post the task link/ }))
    await user.click(within(dialog).getByRole('button', { name: 'Create task' }))
    await waitFor(() => expect(calls(server, 'post', `/projects/${ids.project}/tasks`)).toHaveLength(1))
    expect(calls(server, 'post', '/channels/ch-proj/messages')).toHaveLength(0)
  })

  it('#general has no such button, and neither does a Viewer', async () => {
    await mount({ chatLinks: true })
    const general = await waitFor(() => { const m = rowWith('Please review'); if (!m) throw new Error('not yet'); return m })
    expect(within(general).queryByRole('button', { name: 'Create task from message' })).not.toBeInTheDocument()
    cleanup()
    const user = userEvent.setup()
    await mount({ chatLinks: true, role: 'Viewer' })
    await user.click(await within(await screen.findByRole('navigation', { name: 'Channels' })).findByRole('button', { name: /# demo-project/ }))
    const message = await waitFor(() => { const m = rowWith('Fix the login bug on mobile'); if (!m) throw new Error('not yet'); return m })
    expect(within(message).queryByRole('button', { name: 'Create task from message' })).not.toBeInTheDocument()
  })
})

describe('FR28: @mentions in chat', () => {
  it('@names of people in the workspace are highlighted; other @words are not', async () => {
    await mount({ chatLinks: true })
    const message = await waitFor(() => { const m = rowWith('can you check this'); if (!m) throw new Error('not yet'); return m })
    const marked = Array.from(message.querySelectorAll('.chat-mention')).map((e) => e.textContent)
    expect(marked).toEqual(['@Sunitha'])                                                              // @nobody is not a person here
    expect(message).toHaveTextContent('@nobody')
  })

  it('typing @ suggests people, and a click puts the name in the message', async () => {
    const user = userEvent.setup()
    const { server } = await mount()
    const box = await screen.findByLabelText('Message #general')
    await user.type(box, 'hello @Su')
    const list = await screen.findByRole('listbox', { name: 'Mention suggestions' })
    await user.click(within(list).getByRole('option', { name: '@Sunitha' }))
    expect(box).toHaveValue('hello @Sunitha ')
    await user.type(box, 'thanks{Enter}')
    await waitFor(() => expect(calls(server, 'post', '/channels/ch-general/messages')[0].body).toEqual({ text: 'hello @Sunitha thanks' }))
    expect(screen.queryByRole('listbox', { name: 'Mention suggestions' })).not.toBeInTheDocument()
  })

  it('a notification about a mention opens the channel it was made in', async () => {
    const user = userEvent.setup()
    await mount({ chatMention: true, route: '/notifications' })
    await user.click(await screen.findByText('Test User Two mentioned you in #general'))
    expect(await screen.findByRole('heading', { name: '# general' })).toBeInTheDocument()
  })
})

describe('FR26: archive and restore a channel', () => {
  it('an Admin archives a channel after confirming; it leaves the list and shows under "Archived channels"', async () => {
    const user = userEvent.setup()
    const { server } = await mount()
    await screen.findByText('Welcome everyone')
    await makeIdeas(user)
    await user.click(screen.getByRole('button', { name: 'Archive channel' }))
    const dialog = await screen.findByRole('dialog', { name: 'Archive this channel?' })
    expect(dialog).toHaveTextContent('#ideas will disappear from the list for everyone')
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(calls(server, 'patch', '/channels/ch-ideas')[0].body).toEqual({ archived: true }))
    expect(await screen.findByRole('heading', { name: '# general' })).toBeInTheDocument()              // back to #general
    expect(within(screen.getByRole('navigation', { name: 'Channels' })).queryByRole('button', { name: /# ideas/ })).not.toBeInTheDocument()
    expect(await screen.findByText(/Channel archived/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Archived channels' }))
    expect(await within(await screen.findByRole('list', { name: 'Archived channels' })).findByText('# ideas')).toBeInTheDocument()
  })

  it('Restore brings it back into the list', async () => {
    const user = userEvent.setup()
    const { server } = await mount()
    await screen.findByText('Welcome everyone')
    await makeIdeas(user)
    await user.click(screen.getByRole('button', { name: 'Archive channel' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Archive this channel?' })).getByRole('button', { name: 'Archive' }))
    await user.click(await screen.findByRole('button', { name: 'Archived channels' }))
    await user.click(await screen.findByRole('button', { name: 'Restore ideas' }))
    await waitFor(() => expect(calls(server, 'patch', '/channels/ch-ideas').at(-1).body).toEqual({ archived: false }))
    expect(await within(screen.getByRole('navigation', { name: 'Channels' })).findByRole('button', { name: /# ideas/ })).toBeInTheDocument()
    expect(await screen.findByText('#ideas is back')).toBeInTheDocument()
    expect(await within(screen.getByRole('list', { name: 'Archived channels' })).findByText('No archived channels')).toBeInTheDocument()
  })

  it('cancelling does nothing; #general and project channels cannot be archived; Members see none of it', async () => {
    const user = userEvent.setup()
    const { server } = await mount()
    await screen.findByText('Welcome everyone')
    expect(screen.queryByRole('button', { name: 'Archive channel' })).not.toBeInTheDocument()           // #general is managed by FlowSync
    await makeIdeas(user)
    await user.click(screen.getByRole('button', { name: 'Archive channel' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Archive this channel?' })).getByRole('button', { name: 'Cancel' }))
    expect(calls(server, 'patch', '/channels/ch-ideas')).toHaveLength(0)
    cleanup()
    await mount({ role: 'Member' })
    await screen.findByText('Welcome everyone')
    expect(screen.queryByRole('button', { name: 'Archived channels' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive channel' })).not.toBeInTheDocument()
  })
})

describe('quiet console', () => {
  it('chips, mentions, archiving and creating a task run without a React warning or error', async () => {
    const user = userEvent.setup()
    await mount({ chatLinks: true })
    await waitFor(() => expect(rowWith('Please review')).toBeTruthy())
    await screen.findByRole('button', { name: 'Open task FS-0140AD: Build login page' })
    await user.click(screen.getByRole('button', { name: 'Archived channels' }))
    await screen.findByText('No archived channels')
    expect(consoleErrors.filter((e) => !/not wrapped in act/.test(e))).toEqual([])
  })
})
