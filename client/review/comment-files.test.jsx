import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ids, token } from './token'

let consoleErrors
beforeEach(() => {
  consoleErrors = []
  vi.spyOn(console, 'error').mockImplementation((...a) => consoleErrors.push(a.map(String).join(' ').slice(0, 240)))
  vi.spyOn(console, 'warn').mockImplementation((...a) => consoleErrors.push('WARN ' + a.map(String).join(' ').slice(0, 240)))
  globalThis.fetch = vi.fn(() => Promise.reject(new Error('no network in tests')))
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  URL.revokeObjectURL = vi.fn()
})

async function mount(serverOpts = {}) {
  vi.resetModules()
  window.localStorage.clear()
  window.localStorage.setItem('flowsync_token', token)
  window.localStorage.setItem('flowsync_user', JSON.stringify({ id: ids.me, name: 'Sunitha', email: 'sunitha@test.com', emailVerified: true }))
  const { makeServer } = await import('./fakeApi')
  const server = makeServer(serverOpts)
  const { default: store } = await import('../src/store')
  const { default: App } = await import('../src/App.jsx')
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/projects/${ids.project}/board`]}>
        <App />
      </MemoryRouter>
    </Provider>,
  )
  await userEvent.setup().click(await screen.findByText('Build login page'))     // opens the task drawer, where the comments are
  const drawer = await screen.findByRole('dialog', { name: 'Task details' })
  const comments = await within(drawer).findByRole('region', { name: 'Comments' })
  await within(comments).findByText('First comment from me')
  return { server, comments }
}
const calls = (server, method, url) => server.calls.filter((c) => c.method === method && c.url === url)
const file = (name, size = 1024, type = 'application/pdf') => { const f = new File(['x'], name, { type }); Object.defineProperty(f, 'size', { value: size }); return f }
const pick = (comments, ...files) => fireEvent.change(within(comments).getAllByLabelText('Choose files to attach')[0], { target: { files } })

describe('FR8: attachments on comments', () => {
  it('a comment shows its attachments with their sizes, and a click downloads one', async () => {
    const user = userEvent.setup()
    const { server, comments } = await mount({ withCommentFiles: true })
    const list = await within(comments).findByRole('list', { name: 'Attachments' })
    expect(within(list).getByRole('button', { name: 'Download notes.pdf' })).toHaveTextContent('2.0 KB')
    expect(within(list).getByRole('button', { name: 'Download mockup.png' })).toHaveTextContent('5.0 MB')
    await user.click(within(list).getByRole('button', { name: 'Download notes.pdf' }))
    await waitFor(() => expect(calls(server, 'get', '/files/cf1/download')).toHaveLength(1))
    expect(within(comments).getAllByRole('list', { name: 'Attachments' })).toHaveLength(1)                 // comments without files show no empty list
  })

  it('posts a comment with two files: the comment first, then each file, and they show up', async () => {
    const user = userEvent.setup()
    const { server, comments } = await mount()
    await user.type(within(comments).getByLabelText(/Add a comment/), 'Here are the specs')
    pick(comments, file('spec.pdf', 3000), file('diagram.png', 4096, 'image/png'))
    const chips = within(comments).getByRole('list', { name: 'Files to attach' })
    expect(within(chips).getByText(/spec\.pdf/)).toBeInTheDocument(); expect(within(chips).getByText(/diagram\.png/)).toBeInTheDocument()
    await user.click(within(chips).getByRole('button', { name: 'Do not attach diagram.png' }))            // changed my mind about one
    expect(within(chips).queryByText(/diagram\.png/)).not.toBeInTheDocument()
    await user.click(within(comments).getByRole('button', { name: 'Comment', exact: true }))
    await waitFor(() => expect(calls(server, 'post', `/tasks/${ids.t1}/comments`)).toHaveLength(1))
    expect(calls(server, 'post', `/tasks/${ids.t1}/comments`)[0].body).toEqual({ text: 'Here are the specs' })
    await waitFor(() => expect(calls(server, 'post', '/comments/c3/files')).toHaveLength(1))
    expect(calls(server, 'post', '/comments/c3/files')[0].body.file.name).toBe('spec.pdf')
    expect(await screen.findByText('Comment posted with attachments')).toBeInTheDocument()
    expect(await within(comments).findByRole('button', { name: 'Download spec.pdf' })).toBeInTheDocument()
    expect(within(comments).queryByRole('list', { name: 'Files to attach' })).not.toBeInTheDocument()       // the box is emptied for the next comment
  })

  it('a reply can carry a file too', async () => {
    const user = userEvent.setup()
    const { server, comments } = await mount()
    await user.click(within(comments).getByRole('button', { name: 'Reply' }))
    await user.type(within(comments).getByLabelText('Reply to Sunitha'), 'See attached')
    pick(comments, file('answer.pdf'))
    await user.click(within(within(comments).getByLabelText('Reply to Sunitha').closest('form')).getByRole('button', { name: 'Reply' }))
    await waitFor(() => expect(calls(server, 'post', '/comments/c3/files')).toHaveLength(1))
    expect(calls(server, 'post', `/tasks/${ids.t1}/comments`)[0].body).toEqual({ text: 'See attached', parentComment: 'c1' })
  })

  it('refuses more than 5 files or a file over 20 MB on the spot, without sending anything', async () => {
    const user = userEvent.setup()
    const { server, comments } = await mount()
    await user.type(within(comments).getByLabelText(/Add a comment/), 'too many')
    pick(comments, file('1.pdf'), file('2.pdf'), file('3.pdf'), file('4.pdf'), file('5.pdf'))
    expect(within(within(comments).getByRole('list', { name: 'Files to attach' })).getAllByRole('listitem')).toHaveLength(5)
    pick(comments, file('6.pdf'))
    expect(await within(comments).findByRole('alert')).toHaveTextContent('at most 5 attachments')
    expect(within(within(comments).getByRole('list', { name: 'Files to attach' })).getAllByRole('listitem')).toHaveLength(5)
    cleanup()
    const second = await mount()
    pick(second.comments, file('huge.zip', 21 * 1024 * 1024, 'application/zip'))
    expect(await within(second.comments).findByRole('alert')).toHaveTextContent('"huge.zip" is larger than 20 MB')
    expect(calls(second.server, 'post', `/tasks/${ids.t1}/comments`)).toHaveLength(0)
    expect(calls(server, 'post', `/tasks/${ids.t1}/comments`)).toHaveLength(0)
  })

  it('if one file fails, the comment is still posted and the failing file is named', async () => {
    const user = userEvent.setup()
    const { server, comments } = await mount()
    await user.type(within(comments).getByLabelText(/Add a comment/), 'Two files')
    pick(comments, file('good.pdf'), file('bad.zip', 100, 'application/zip'))
    await user.click(within(comments).getByRole('button', { name: 'Comment', exact: true }))
    expect(await screen.findByText(/Comment posted, but these attachments failed: bad\.zip \(This file type is not allowed\)/)).toBeInTheDocument()
    expect(calls(server, 'post', '/comments/c3/files')).toHaveLength(2)
    expect(await within(comments).findByRole('button', { name: 'Download good.pdf' })).toBeInTheDocument()
    expect(within(comments).getByText('Two files')).toBeInTheDocument()
  })

  it('you can remove your own attachment; someone else\'s only if you manage the workspace', async () => {
    const user = userEvent.setup()
    const { server, comments } = await mount({ withCommentFiles: true })                                     // an Admin: me
    expect(within(comments).getByRole('button', { name: 'Remove notes.pdf' })).toBeInTheDocument()
    expect(within(comments).getByRole('button', { name: 'Remove mockup.png' })).toBeInTheDocument()
    await user.click(within(comments).getByRole('button', { name: 'Remove notes.pdf' }))
    await waitFor(() => expect(calls(server, 'delete', '/files/cf1')).toHaveLength(1))
    await waitFor(() => expect(within(comments).queryByRole('button', { name: 'Download notes.pdf' })).not.toBeInTheDocument())
    expect(await screen.findByText('Attachment removed')).toBeInTheDocument()
    cleanup()
    const member = await mount({ withCommentFiles: true, role: 'Member' })
    expect(within(member.comments).getByRole('button', { name: 'Remove notes.pdf' })).toBeInTheDocument()     // my own file
    expect(within(member.comments).queryByRole('button', { name: 'Remove mockup.png' })).not.toBeInTheDocument()   // somebody else's
  })

  it('a Viewer can read and download attachments but cannot attach or remove', async () => {
    const { comments } = await mount({ withCommentFiles: true, role: 'Viewer' })
    expect(within(comments).getByRole('button', { name: 'Download notes.pdf' })).toBeInTheDocument()
    expect(within(comments).queryByRole('button', { name: 'Attach files' })).not.toBeInTheDocument()
    expect(within(comments).queryByRole('button', { name: /^Remove / })).not.toBeInTheDocument()
  })

  it('editing a comment offers no attachments (only the words change)', async () => {
    const user = userEvent.setup()
    const { comments } = await mount()
    await user.click(within(comments).getAllByRole('button', { name: 'Edit' })[0])
    const form = within(comments).getByLabelText('Edit comment').closest('form')
    expect(within(form).queryByRole('button', { name: 'Attach files' })).not.toBeInTheDocument()
  })
})

describe('quiet console', () => {
  it('the comment box with attachments runs without a React warning or error', async () => {
    const user = userEvent.setup()
    const { comments } = await mount({ withCommentFiles: true })
    await user.type(within(comments).getByLabelText(/Add a comment/), 'checking the console')
    pick(comments, file('a.pdf'))
    await user.click(within(comments).getByRole('button', { name: 'Comment', exact: true }))
    await screen.findByText('Comment posted with attachments')
    expect(consoleErrors.filter((e) => !/not wrapped in act/.test(e))).toEqual([])
  })
})
