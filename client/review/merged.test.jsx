import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
  URL.createObjectURL = vi.fn(() => 'blob:fake')
  URL.revokeObjectURL = vi.fn()
})

async function mount({ route = '/', ...serverOpts } = {}) {
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
const P = `/projects/${ids.project}`
const called = (server, method, url) => server.calls.find((c) => c.method === method && c.url === url)

async function openDrawer(opts = {}) {
  const user = userEvent.setup()
  const ctx = await mount({ route: `${P}/board`, ...opts })
  await user.click(await screen.findByText('Build login page'))
  const drawer = await screen.findByRole('dialog', { name: 'Task details' })
  return { user, drawer, ...ctx }
}

describe('comments, files and assignment in the task drawer (added to the teammate client)', () => {
  it('shows threaded comments with reactions and the files list', async () => {
    const { drawer } = await openDrawer()
    expect(await within(drawer).findByText('First comment from me')).toBeInTheDocument()
    expect(within(drawer).getByText('A reply from the other user')).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'React 👍, 1' })).toBeInTheDocument()
    expect(await within(drawer).findByText('spec.pdf')).toBeInTheDocument()
  })

  it('posts a comment, replies, reacts, edits and deletes', async () => {
    const { user, drawer, server } = await openDrawer()
    await within(drawer).findByText('First comment from me')
    await user.type(within(drawer).getByLabelText(/Add a comment/), 'Looks good')
    await user.click(within(drawer).getByRole('button', { name: 'Comment' }))
    await waitFor(() => expect(called(server, 'post', `/tasks/${ids.t1}/comments`).body).toEqual({ text: 'Looks good' }))
    expect(await within(drawer).findByText('Looks good')).toBeInTheDocument()

    await user.click(within(drawer).getAllByRole('button', { name: 'Reply' })[0])
    const box = within(drawer).getByLabelText(/Reply to Sunitha/)
    await user.type(box, 'Thanks')
    await user.click(within(box.closest('form')).getByRole('button', { name: 'Reply' }))
    await waitFor(() => expect(server.calls.some((c) => c.method === 'post' && c.body?.parentComment === 'c1')).toBe(true))

    await user.click(within(drawer).getAllByRole('button', { name: /React 🎉/ })[0])
    await waitFor(() => expect(called(server, 'post', '/comments/c1/reactions').body).toEqual({ emoji: '🎉' }))

    await user.click(within(drawer).getAllByRole('button', { name: 'Edit' })[0])
    const edit = within(drawer).getByLabelText('Edit comment')
    await user.clear(edit)
    await user.type(edit, 'Edited text')
    await user.click(within(edit.closest('form')).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(called(server, 'put', '/comments/c1').body).toEqual({ text: 'Edited text' }))

    await user.click(within(within(drawer).getByRole('region', { name: 'Comments' })).getAllByRole('button', { name: 'Delete' })[0])
    await user.click(within(screen.getByRole('dialog', { name: 'Delete comment?' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(called(server, 'delete', '/comments/c1')).toBeTruthy())
  })

  it('a Viewer can read comments and files but not write or upload', async () => {
    const { drawer } = await openDrawer({ role: 'Viewer' })
    await within(drawer).findByText('First comment from me')
    expect(within(drawer).getByText(/Viewers can read comments but not write them/)).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: 'Upload a file' })).not.toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'Download spec.pdf' })).toBeInTheDocument()
  })

  it('uploads, downloads and deletes a file', async () => {
    const { user, drawer, server } = await openDrawer()
    const files = await within(drawer).findByRole('region', { name: 'Files' })
    await within(files).findByText('spec.pdf')
    fireEvent.change(within(files).getByLabelText('Choose a file to upload'), { target: { files: [new File(['hello'], 'notes.pdf', { type: 'application/pdf' })] } })
    await waitFor(() => expect(called(server, 'post', `/tasks/${ids.t1}/files`).body.file.name).toBe('notes.pdf'))
    expect(await within(files).findByText('notes.pdf')).toBeInTheDocument()
    await user.click(within(files).getByRole('button', { name: 'Download spec.pdf' }))
    await waitFor(() => expect(called(server, 'get', '/files/f1/download')).toBeTruthy())
    await user.click(within(files).getByRole('button', { name: 'Delete diagram.png' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Delete file?' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(called(server, 'delete', '/files/f2')).toBeTruthy())
  })

  it('refuses a file over 20 MB before sending it', async () => {
    const { drawer, server } = await openDrawer()
    const files = await within(drawer).findByRole('region', { name: 'Files' })
    const big = new File(['x'], 'big.zip', { type: 'application/zip' })
    Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 })
    fireEvent.change(within(files).getByLabelText('Choose a file to upload'), { target: { files: [big] } })
    expect(await screen.findByText('That file is larger than 20 MB.')).toBeInTheDocument()
    expect(server.calls.some((c) => c.method === 'post' && c.url.endsWith('/files'))).toBe(false)
  })

  it('changing the assignee uses the assign call (so the new assignee is notified)', async () => {
    const { user, drawer, server } = await openDrawer()
    await user.selectOptions(within(drawer).getByLabelText('Assignee'), ids.other)
    await user.click(within(drawer).getByRole('button', { name: 'Save' }))
    const assign = await waitFor(() => server.calls.find((c) => c.method === 'patch' && c.url === `/tasks/${ids.t1}/assign`))
    expect(assign.body).toEqual({ assignee: ids.other })
    expect(server.calls.find((c) => c.method === 'put' && c.url === `/tasks/${ids.t1}`).body).not.toHaveProperty('assignee')
  })

  it('Escape closes only the delete confirmation, not the whole drawer', async () => {
    const { user, drawer } = await openDrawer()
    await user.click(within(drawer).getAllByRole('button', { name: 'Delete' })[0])
    expect(await screen.findByRole('dialog', { name: 'Delete task?' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Delete task?' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Task details' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Task details' })).not.toBeInTheDocument())
  })
})

describe('the project Files tab', () => {
  it('lists, uploads and is reachable from the sidebar', async () => {
    const { server } = await mount({ route: `${P}/files` })
    expect(await screen.findByText('spec.pdf')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Choose a file to upload'), { target: { files: [new File(['a'], 'plan.docx', { type: 'application/msword' })] } })
    await waitFor(() => expect(called(server, 'post', `/projects/${ids.project}/files`)).toBeTruthy())
    expect(await screen.findByText('plan.docx')).toBeInTheDocument()
  })
})

describe('FR11 + FR12: the AI project generator (teammate screen)', () => {
  const TEXT = 'Build a library system where students search and borrow books and librarians track overdue returns.'
  async function gen(opts) {
    const user = userEvent.setup()
    const ctx = await mount({ route: '/projects/new/ai', ...opts })
    const box = await screen.findByLabelText(/Describe the project/)
    return { user, box, ...ctx }
  }

  it('asks for enough text, generates a plan, lets you edit it, and creates the project', async () => {
    const { user, box, server } = await gen()
    const go = screen.getByRole('button', { name: /Generate|Continue|Next/ })
    expect(go).toBeDisabled()
    await user.type(box, TEXT)
    await waitFor(() => expect(go).toBeEnabled())
    await user.click(go)
    // the review-text step may sit between input and plan
    const next = await screen.findByRole('button', { name: /Generate plan|Generate project|Generate/ }).catch(() => null)
    if (next && !screen.queryByLabelText('Project name')) await user.click(next)
    const name = await screen.findByLabelText('Project name')
    expect(name).toHaveValue('Library System')
    expect(screen.getByLabelText('Task 1 title')).toHaveValue('Design database')
    expect(screen.getByLabelText('Task 2 title')).toHaveValue('Build search')
    expect(screen.getByText(/Skipped task 3/)).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Task 2 title'))
    await user.type(screen.getByLabelText('Task 2 title'), 'Build the search page')
    await user.click(screen.getByRole('button', { name: /Create project/ }))
    const post = await waitFor(() => server.calls.find((c) => c.method === 'post' && c.url.endsWith('/projects/generate')))
    expect(post.body.generationKey).toBeTruthy()
    expect(post.body.plan.tasks[1].title).toBe('Build the search page')
    expect(post.body.plan.tasks[1].dependsOn).toEqual([0])
    expect(await screen.findByText('Build login page')).toBeInTheDocument() // landed on the board
  })

  it('shows a clear message when the AI is not configured on the server (503)', async () => {
    const { user, box } = await gen({ ai: 'off' })
    await user.type(box, TEXT)
    await user.click(screen.getByRole('button', { name: /Generate|Continue|Next/ }))
    const again = screen.queryByRole('button', { name: /Generate plan|Generate project/ })
    if (again) await user.click(again)
    expect(await screen.findByText(/not configured/i)).toBeInTheDocument()
  })

  it('reads a requirements document with OCR and adds its text; rejects a wrong file type', async () => {
    const { user, box, server } = await gen()
    const input = document.querySelector('input[type=file]')
    fireEvent.change(input, { target: { files: [new File(['x'], 'req.docx', { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })] } })
    await waitFor(() => expect(called(server, 'post', '/ocr/extract')).toBeTruthy())
    await waitFor(() => expect(box.value).toContain('students search and borrow books'))
    expect(box.value).toContain('--- req.docx ---')
    fireEvent.change(input, { target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] } })
    expect(await screen.findByText(/Unsupported type/)).toBeInTheDocument()
    void user
  })

  it('shows the OCR error when a file cannot be read', async () => {
    await gen({ ocrFail: true })
    const input = document.querySelector('input[type=file]')
    fireEvent.change(input, { target: { files: [new File(['x'], 'scan.png', { type: 'image/png' })] } })
    expect(await screen.findByText(/OCR engine could not process/)).toBeInTheDocument()
  })
})

describe('FR22: the settings page (teammate screen)', () => {
  it('loads the saved values and saves notification, theme, size and privacy choices together', async () => {
    const user = userEvent.setup()
    const { server } = await mount({ route: '/settings' })
    expect(await screen.findByRole('heading', { name: /Settings/ })).toBeInTheDocument()
    const status = await screen.findByLabelText('Who can see your online status')
    expect(within(status).getAllByRole('option').map((o) => o.value)).toEqual(['everyone', 'team', 'managers', 'private'])
    expect(status).toHaveValue('team')
    expect(screen.getByText('Only people on a team with you')).toBeInTheDocument() // help text matches the real levels
    await user.selectOptions(status, 'managers')
    expect(screen.getByText('Only Admins and Managers of your workspaces')).toBeInTheDocument()
    await user.click(screen.getByRole('radio', { name: /Midnight/ }))
    await user.click(screen.getByLabelText(/Comments & replies/))
    await user.click(screen.getByRole('button', { name: /Save/ }))
    const put = await waitFor(() => server.calls.find((c) => c.method === 'put' && c.url === '/settings'))
    expect(put.body).toMatchObject({ theme: 'midnight', statusVisibility: 'managers', notifications: { comments: false } })
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight')
  })
})

describe('whole app still works', () => {
  it('visits every route without a React warning or error', async () => {
    for (const route of ['/', '/projects', '/projects/new', '/projects/new/ai', '/teams', '/members', '/calendar', '/notifications', '/analytics', '/profile', '/settings', `${P}/board`, `${P}/calendar`, `${P}/activity`, `${P}/analytics`, `${P}/github`, `${P}/milestones`, `${P}/files`]) {
      await mount({ route })
      await new Promise((r) => setTimeout(r, 150))
    }
    const real = consoleErrors.filter((e) => !/not wrapped in act/.test(e))
    expect(real).toEqual([])
  })
})
