import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
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

// signedIn: false = a visitor with no login; user: fields of the saved user (for example emailVerified: false)
async function mount({ route = '/', signedIn = true, user = {}, ...serverOpts } = {}) {
  vi.resetModules()
  window.localStorage.clear()
  if (signedIn) {
    window.localStorage.setItem('flowsync_token', token)
    window.localStorage.setItem('flowsync_user', JSON.stringify({ id: ids.me, name: 'Sunitha', email: 'sunitha@test.com', emailVerified: true, ...user }))
  }
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
const GOOD_RESET = 'a'.repeat(64)
const GOOD_VERIFY = 'b'.repeat(64)

describe('FR1: forgot password', () => {
  it('the sign-in page has a real "Forgot password?" link', async () => {
    await mount({ route: '/login', signedIn: false })
    expect(await screen.findByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password')
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument()
  })

  it('asks for an email, checks it, and shows the same friendly answer', async () => {
    const user = userEvent.setup()
    const { server } = await mount({ route: '/forgot-password', signedIn: false })
    await user.type(await screen.findByLabelText('Email'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid email address')
    expect(calls(server, 'post', '/auth/forgot-password')).toHaveLength(0)
    await user.clear(screen.getByLabelText('Email')); await user.type(screen.getByLabelText('Email'), 'raj@example.com')
    await user.click(screen.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => expect(calls(server, 'post', '/auth/forgot-password')[0].body).toEqual({ email: 'raj@example.com' }))
    expect(await screen.findByRole('status')).toHaveTextContent('If that email is registered, a reset link has been sent')
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toHaveAttribute('href', '/login')
  })
})

describe('FR1: reset password', () => {
  it('a link with no token says so and offers a new link', async () => {
    await mount({ route: '/reset-password', signedIn: false })
    expect(await screen.findByRole('alert')).toHaveTextContent('This reset link is incomplete')
    expect(screen.getByRole('link', { name: 'Ask for a new one' })).toHaveAttribute('href', '/forgot-password')
  })

  it('checks the two passwords, then changes the password and points to sign in', async () => {
    const user = userEvent.setup()
    const { server } = await mount({ route: `/reset-password?token=${GOOD_RESET}`, signedIn: false })
    await user.type(await screen.findByLabelText('New password'), 'short')
    await user.type(screen.getByLabelText('Repeat the new password'), 'short')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 8 characters')
    await user.clear(screen.getByLabelText('New password')); await user.type(screen.getByLabelText('New password'), 'brandnewpass1')
    await user.clear(screen.getByLabelText('Repeat the new password')); await user.type(screen.getByLabelText('Repeat the new password'), 'different123')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('do not match')
    expect(calls(server, 'post', '/auth/reset-password')).toHaveLength(0)
    await user.clear(screen.getByLabelText('Repeat the new password')); await user.type(screen.getByLabelText('Repeat the new password'), 'brandnewpass1')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    await waitFor(() => expect(calls(server, 'post', '/auth/reset-password')[0].body).toEqual({ token: GOOD_RESET, password: 'brandnewpass1' }))
    expect(await screen.findByText('Your password was changed. You can sign in now.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })

  it('an expired or wrong link shows the reason and a way to get a new one', async () => {
    const user = userEvent.setup()
    await mount({ route: `/reset-password?token=${'f'.repeat(64)}`, signedIn: false })
    await user.type(await screen.findByLabelText('New password'), 'brandnewpass1')
    await user.type(screen.getByLabelText('Repeat the new password'), 'brandnewpass1')
    await user.click(screen.getByRole('button', { name: 'Change password' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('invalid or has expired')
    expect(within(alert).getByRole('link', { name: 'Ask for a new link' })).toHaveAttribute('href', '/forgot-password')
  })
})

describe('FR1: confirm the email', () => {
  it('a good link confirms the email, once, and a visitor is sent to sign in', async () => {
    const { server } = await mount({ route: `/verify-email?token=${GOOD_VERIFY}`, signedIn: false })
    expect(await screen.findByText('Your email address is confirmed.')).toBeInTheDocument()
    expect(calls(server, 'post', '/auth/verify-email')).toHaveLength(1)
    expect(calls(server, 'post', '/auth/verify-email')[0].body).toEqual({ token: GOOD_VERIFY })
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login')
  })

  it('a signed-in person is taken back to the app and is marked as confirmed', async () => {
    const { store } = await mount({ route: `/verify-email?token=${GOOD_VERIFY}`, user: { emailVerified: false } })
    const link = await screen.findByRole('link', { name: 'Continue to FlowSync' })
    expect(link).toHaveAttribute('href', '/')
    expect(store.getState().auth.user.emailVerified).toBe(true)
    expect(JSON.parse(window.localStorage.getItem('flowsync_user')).emailVerified).toBe(true)
  })

  it('a wrong, used or missing link explains what to do', async () => {
    await mount({ route: `/verify-email?token=${'c'.repeat(64)}`, signedIn: false })
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid or has expired')
    expect(screen.getByText(/If you already confirmed your email, you can just sign in/)).toBeInTheDocument()
    cleanup()
    await mount({ route: '/verify-email', signedIn: false })
    expect(await screen.findByRole('alert')).toHaveTextContent('incomplete')
  })
})

describe('FR1: the "confirm your email" banner', () => {
  it('shows for an unconfirmed person, and "Resend link" sends a new email', async () => {
    const user = userEvent.setup()
    const { server } = await mount({ user: { emailVerified: false } })
    const banner = await screen.findByText(/Your email address is not confirmed yet/)
    expect(banner).toHaveTextContent('cannot create workspaces or invite people')
    await user.click(screen.getByRole('button', { name: 'Resend link' }))
    await waitFor(() => expect(calls(server, 'post', '/auth/resend-verification')).toHaveLength(1))
    expect(await screen.findByText('A new confirmation link was sent. Check your inbox.')).toBeInTheDocument()
  })

  it('says why when too many emails were requested', async () => {
    const user = userEvent.setup()
    await mount({ user: { emailVerified: false }, resend: 'limit' })
    await user.click(await screen.findByRole('button', { name: 'Resend link' }))
    expect(await screen.findByText(/Too many emails requested/)).toBeInTheDocument()
  })

  it('is not shown to a confirmed person, and disappears by itself if the server says the email is confirmed', async () => {
    await mount()
    await screen.findByText('Hello, Sunitha')
    expect(screen.queryByText(/Your email address is not confirmed yet/)).not.toBeInTheDocument()
    cleanup()
    const { store } = await mount({ user: { emailVerified: false }, verifiedOnServer: true })
    await waitFor(() => expect(store.getState().auth.user.emailVerified).toBe(true))
    expect(screen.queryByText(/Your email address is not confirmed yet/)).not.toBeInTheDocument()
  })
})

describe('FR2: workspace settings, roles and delete', () => {
  it('an Admin renames the workspace and changes its description', async () => {
    const user = userEvent.setup()
    const { server } = await mount({ route: '/members' })
    const form = await screen.findByRole('form', { name: 'Workspace settings' })
    const save = within(form).getByRole('button', { name: 'Save settings' })
    expect(save).toBeDisabled()                                                          // nothing changed yet
    await user.clear(within(form).getByLabelText('Name')); await user.type(within(form).getByLabelText('Name'), 'Renamed Space')
    await user.clear(within(form).getByLabelText('Description')); await user.type(within(form).getByLabelText('Description'), 'new words')
    await user.click(save)
    await waitFor(() => expect(calls(server, 'patch', `/workspaces/${ids.ws}`)[0].body).toEqual({ name: 'Renamed Space', description: 'new words' }))
    expect(await screen.findByRole('heading', { name: 'Members of Renamed Space' })).toBeInTheDocument()
    expect(await screen.findByText('Workspace settings saved')).toBeInTheDocument()
  })

  it('a Manager can edit the settings but cannot change roles or delete; a Member sees none of it', async () => {
    await mount({ route: '/members', role: 'Manager' })
    expect(await screen.findByRole('form', { name: 'Workspace settings' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Danger zone' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/^Role of /)).not.toBeInTheDocument()
    cleanup()
    await mount({ route: '/members', role: 'Member' })
    await screen.findByRole('heading', { name: /Members of/ })
    expect(screen.queryByRole('form', { name: 'Workspace settings' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Danger zone' })).not.toBeInTheDocument()
  })

  it('an Admin changes another member\'s role from the list', async () => {
    const user = userEvent.setup()
    const { server } = await mount({ route: '/members' })
    const select = await screen.findByLabelText('Role of Test User Two')
    expect(select).toHaveValue('Member')
    await user.selectOptions(select, 'Manager')
    await waitFor(() => expect(calls(server, 'patch', `/workspaces/${ids.ws}/members/${ids.other}`)[0].body).toEqual({ role: 'Manager' }))
    expect(await screen.findByText('Test User Two is now Manager')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Role of Test User Two')).toHaveValue('Manager'))
  })

  it('the last Admin cannot demote themselves: the server\'s reason is shown and nothing changes', async () => {
    const user = userEvent.setup()
    await mount({ route: '/members' })
    const mine = await screen.findByLabelText('Role of Sunitha')
    await user.selectOptions(mine, 'Member')
    expect(await screen.findByText(/must keep at least one Admin/)).toBeInTheDocument()
    expect(screen.getByLabelText('Role of Sunitha')).toHaveValue('Admin')
  })

  it('deleting a workspace needs the exact name typed, then removes it', async () => {
    const user = userEvent.setup()
    const { server } = await mount({ route: '/members' })
    await user.click(await screen.findByRole('button', { name: 'Delete this workspace' }))
    const dialog = await screen.findByRole('dialog', { name: 'Delete workspace' })
    expect(dialog).toHaveTextContent('permanently deletes My Test Workspace')
    const button = within(dialog).getByRole('button', { name: 'Delete workspace' })
    expect(button).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Type the workspace name to confirm'), 'my test workspace')   // wrong capital letters
    expect(button).toBeDisabled()
    await user.clear(within(dialog).getByLabelText('Type the workspace name to confirm'))
    await user.type(within(dialog).getByLabelText('Type the workspace name to confirm'), 'My Test Workspace')
    expect(button).toBeEnabled()
    await user.click(button)
    await waitFor(() => expect(calls(server, 'delete', `/workspaces/${ids.ws}`)[0].body).toEqual({ confirmName: 'My Test Workspace' }))
    expect(await screen.findByText('Workspace "My Test Workspace" was deleted')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Delete workspace' })).not.toBeInTheDocument())
  })

  it('Cancel closes the delete dialog and deletes nothing', async () => {
    const user = userEvent.setup()
    const { server } = await mount({ route: '/members' })
    await user.click(await screen.findByRole('button', { name: 'Delete this workspace' }))
    await user.click(within(await screen.findByRole('dialog', { name: 'Delete workspace' })).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Delete workspace' })).not.toBeInTheDocument()
    expect(calls(server, 'delete', `/workspaces/${ids.ws}`)).toHaveLength(0)
  })

  it('only an Admin is offered the Admin role when inviting', async () => {
    const user = userEvent.setup()
    await mount({ route: '/members', role: 'Manager' })
    await user.click(await screen.findByRole('button', { name: '+ Invite member' }))
    let dialog = await screen.findByRole('dialog', { name: 'Invite member' })
    expect(within(within(dialog).getByLabelText('Role')).getAllByRole('option').map((o) => o.value)).toEqual(['Manager', 'Member', 'Viewer'])
    cleanup()
    await mount({ route: '/members', role: 'Admin' })
    await user.click(await screen.findByRole('button', { name: '+ Invite member' }))
    dialog = await screen.findByRole('dialog', { name: 'Invite member' })
    expect(within(within(dialog).getByLabelText('Role')).getAllByRole('option').map((o) => o.value)).toEqual(['Admin', 'Manager', 'Member', 'Viewer'])
  })
})

describe('quiet console', () => {
  it('the new pages open without a React warning or error', async () => {
    for (const route of ['/forgot-password', `/reset-password?token=${GOOD_RESET}`, `/verify-email?token=${GOOD_VERIFY}`]) {
      cleanup()
      await mount({ route, signedIn: false })
      await new Promise((r) => setTimeout(r, 120))
    }
    cleanup()
    await mount({ route: '/members', user: { emailVerified: false } })
    await screen.findByRole('form', { name: 'Workspace settings' })
    await new Promise((r) => setTimeout(r, 150))
    expect(consoleErrors.filter((e) => !/not wrapped in act/.test(e))).toEqual([])
  })
})
