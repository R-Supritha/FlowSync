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
})

async function mount({ route = '/', user = {}, ...serverOpts } = {}) {
  vi.resetModules()
  window.localStorage.clear()
  window.localStorage.setItem('flowsync_token', token)
  window.localStorage.setItem('flowsync_user', JSON.stringify({ id: ids.me, name: 'Sunitha', email: 'sunitha@test.com', emailVerified: true, ...user }))
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
const API = 'http://localhost:5000'
const png = (name = 'me.png', size = 1024, type = 'image/png') => { const f = new File(['x'], name, { type }); Object.defineProperty(f, 'size', { value: size }); return f }
const choose = (file) => fireEvent.change(screen.getByLabelText('Choose a picture', { selector: 'input' }), { target: { files: [file] } })

describe('FR10: the new notification kinds', () => {
  it('the notifications page labels deadline, overdue, pull request opened and merged', async () => {
    await mount({ route: '/notifications', moreNotifications: true })
    expect(await screen.findByText('"Build login page" is due in 5 hours')).toBeInTheDocument()
    expect(screen.getByText('"Write tests" is overdue (it was due 2026-10-22)')).toBeInTheDocument()
    expect(screen.getByText('Pull request #7 "Add search" was opened for "Build login page"')).toBeInTheDocument()
    expect(screen.getByText('Pull request #7 "Add search" was merged for "Build login page"')).toBeInTheDocument()
    for (const label of ['Deadline', 'Overdue', 'Pull request', 'Merged']) expect(screen.getAllByText(label).length).toBeGreaterThan(0)
  })

  it('the bell menu shows them too', async () => {
    const user = userEvent.setup()
    await mount({ moreNotifications: true })
    await user.click(await screen.findByRole('button', { name: /Notifications/ }))
    expect(await screen.findByText(/was merged for "Build login page"/)).toBeInTheDocument()
    expect(screen.getByText(/is overdue/)).toBeInTheDocument()
  })
})

describe('FR21: achievements', () => {
  it('my profile shows earned badges and the progress of the others', async () => {
    await mount({ route: '/profile' })
    const section = await screen.findByRole('region', { name: 'Achievements' })
    expect(within(section).getByRole('heading', { name: /Achievements \(2 of 8\)/ })).toBeInTheDocument()
    expect(within(section).getByRole('listitem', { name: 'First task done: earned' })).toHaveTextContent('Earned')
    const locked = within(section).getByRole('listitem', { name: 'Task master: 12 of 50' })
    expect(locked).toHaveTextContent('12 / 50')
    expect(within(locked).getByRole('progressbar', { name: 'Progress for Task master' })).toHaveAttribute('aria-valuenow', '12')
  })

  it('someone else\'s profile shows their achievements when they allow it, and a polite note when they do not', async () => {
    await mount({ route: `/profile/${ids.other}` })
    expect(await within(await screen.findByRole('region', { name: 'Achievements' })).findByText('Task finisher')).toBeInTheDocument()
    cleanup()
    await mount({ route: `/profile/${ids.other}`, achievements: 'hidden' })
    expect(await screen.findByText('Test User Two keeps their achievements private.')).toBeInTheDocument()
    expect(screen.queryByText('Task finisher')).not.toBeInTheDocument()
  })
})

describe('FR21: profile picture', () => {
  it('uploading a picture shows it on the page and in the top bar', async () => {
    const user = userEvent.setup()
    const { server, store } = await mount({ route: '/profile' })
    await screen.findByRole('button', { name: 'Upload picture' })
    expect(document.querySelector('img.avatar-img')).toBeNull()
    choose(png('face.png'))
    await waitFor(() => expect(calls(server, 'post', '/profile/avatar')).toHaveLength(1))
    expect(calls(server, 'post', '/profile/avatar')[0].body.file.name).toBe('face.png')
    await waitFor(() => expect(document.querySelector(`img.avatar-img[src="${API}/avatars/me-0123456789abcdef.png"]`)).not.toBeNull())
    expect(await screen.findByRole('button', { name: 'Change picture' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove picture' })).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: 'Account menu' })).getByRole('img')).toHaveAttribute('src', `${API}/avatars/me-0123456789abcdef.png`)
    expect(store.getState().auth.user.avatarUrl).toBe('/avatars/me-0123456789abcdef.png')
    expect(JSON.parse(window.localStorage.getItem('flowsync_user')).avatarUrl).toBe('/avatars/me-0123456789abcdef.png')
    expect(await screen.findByText('Picture updated')).toBeInTheDocument()
    void user
  })

  it('a wrong kind of file or one over 2 MB is refused on the spot, without asking the server', async () => {
    const { server } = await mount({ route: '/profile' })
    await screen.findByRole('button', { name: 'Upload picture' })
    choose(png('notes.txt', 100, 'text/plain'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose a PNG, JPEG, GIF or WebP picture')
    choose(png('big.png', 3 * 1024 * 1024))
    expect(await screen.findByText('The picture must be at most 2 MB')).toBeInTheDocument()
    choose(png('vector.svg', 100, 'image/svg+xml'))
    expect(await screen.findByText('Choose a PNG, JPEG, GIF or WebP picture')).toBeInTheDocument()
    expect(calls(server, 'post', '/profile/avatar')).toHaveLength(0)
  })

  it('when the server refuses the picture its reason is shown and nothing changes', async () => {
    await mount({ route: '/profile', avatarFail: true })
    await screen.findByRole('button', { name: 'Upload picture' })
    choose(png('fake.png'))
    expect(await screen.findByRole('alert')).toHaveTextContent('The file is not a PNG, JPEG, GIF or WebP picture')
    expect(document.querySelector('img.avatar-img')).toBeNull()
    expect(screen.getByRole('button', { name: 'Upload picture' })).toBeInTheDocument()
  })

  it('Remove picture takes it away again', async () => {
    const user = userEvent.setup()
    const { server, store } = await mount({ route: '/profile', user: { avatarUrl: '/avatars/me-0123456789abcdef.png' }, hasPicture: true })
    await screen.findByRole('button', { name: 'Remove picture' })
    await user.click(screen.getByRole('button', { name: 'Remove picture' }))
    await waitFor(() => expect(calls(server, 'delete', '/profile/avatar')).toHaveLength(1))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove picture' })).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Upload picture' })).toBeInTheDocument()
    expect(store.getState().auth.user.avatarUrl).toBe('')
  })

  it('saving the profile does not send the picture (it is changed only by the upload buttons)', async () => {
    const user = userEvent.setup()
    const { server } = await mount({ route: '/profile' })
    await screen.findByRole('button', { name: 'Upload picture' })
    choose(png())
    await screen.findByRole('button', { name: 'Remove picture' })
    await user.click(screen.getByRole('button', { name: /Save profile/ }))
    await waitFor(() => expect(calls(server, 'put', '/profile')).toHaveLength(1))
    expect(calls(server, 'put', '/profile')[0].body).not.toHaveProperty('avatarUrl')
  })
})

describe('FR21: pictures show up where people are shown', () => {
  it('another person\'s picture shows on their profile and in the sidebar member list', async () => {
    await mount({ route: `/profile/${ids.other}`, pictures: true })
    await screen.findByRole('region', { name: 'Achievements' })
    await waitFor(() => expect(document.querySelectorAll(`img.avatar-img[src="${API}/avatars/raj.png"]`).length).toBeGreaterThanOrEqual(2))   // profile header and sidebar
  })

  it('a picture that cannot be loaded falls back to the initials', async () => {
    await mount({ route: `/profile/${ids.other}`, pictures: true })
    await screen.findByRole('region', { name: 'Achievements' })
    const img = await waitFor(() => { const i = document.querySelector('.page img.avatar-img'); if (!i) throw new Error('no picture yet'); return i })
    fireEvent.error(img)
    await waitFor(() => expect(document.querySelector('.page img.avatar-img')).toBeNull())
    expect(screen.getAllByText('TU').length).toBeGreaterThan(0)
  })
})

describe('quiet console', () => {
  it('profile, achievements and notifications open without a React warning or error', async () => {
    for (const route of ['/profile', `/profile/${ids.other}`, '/notifications']) {
      cleanup()
      await mount({ route, moreNotifications: true, pictures: true })
      await new Promise((r) => setTimeout(r, 200))
    }
    expect(consoleErrors.filter((e) => !/not wrapped in act/.test(e))).toEqual([])
  })
})
