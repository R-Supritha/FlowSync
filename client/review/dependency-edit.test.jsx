import { render, screen, waitFor, within } from '@testing-library/react'
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

async function mount({ depGraph = 'chain', ...serverOpts } = {}) {
  vi.resetModules()
  window.localStorage.clear()
  window.localStorage.setItem('flowsync_token', token)
  window.localStorage.setItem('flowsync_user', JSON.stringify({ id: ids.me, name: 'Sunitha', email: 'sunitha@test.com', emailVerified: true }))
  const { makeServer } = await import('./fakeApi')
  const server = makeServer({ depGraph, ...serverOpts })
  const { default: store } = await import('../src/store')
  const { default: App } = await import('../src/App.jsx')
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/projects/${ids.project}/dependencies`]}>
        <App />
      </MemoryRouter>
    </Provider>,
  )
  return server
}
const T = (n) => `6ac87dc3e1de3a64a30141${n}`
const box = (n) => document.querySelector(`[data-task-id="${T(n)}"]`)
const waitForMap = () => screen.findByRole('heading', { name: 'Dependency graph' }).then(() => waitFor(() => { if (!box('01')) throw new Error('map not drawn yet') }))

const calls = (server, method, url) => server.calls.filter((c) => c.method === method && c.url === url)
const openDrawerOf = async (user, n) => {
  await waitForMap()
  await user.click(box(n))
  return screen.findByRole('dialog', { name: 'Task details' })
}
const choose = async (user, dialog, n) => {
  await user.click(within(dialog).getByRole('button', { name: 'Add dependency' }))
  const pick = await within(dialog).findByRole('combobox', { name: 'Task to wait for' })
  await waitFor(() => expect(pick).toBeEnabled())
  await user.selectOptions(pick, T(n))
}

describe('setting "Blocked by" in the task details', () => {
  it('Add dependency lists the other tasks, saves the choice, and the details show it at once', async () => {
    const user = userEvent.setup()
    const server = await mount()
    const dialog = await openDrawerOf(user, '06')                              // "Write docs": no links yet
    expect(within(dialog).queryByText(/Blocked by:/)).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Add dependency' }))
    const pick = await within(dialog).findByRole('combobox', { name: 'Task to wait for' })
    await waitFor(() => expect(pick).toBeEnabled())
    expect(within(pick).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a task it must wait for…', 'Design schema (To Do)', 'Build API (In Progress)', 'Write tests (Backlog)', 'Deploy (Backlog)', 'Set up CI (Done)'])   // not itself
    await user.selectOptions(pick, T('02'))
    await waitFor(() => expect(calls(server, 'put', `/tasks/${T('06')}`)[0].body).toEqual({ dependencies: [T('02')] }))
    expect(await within(dialog).findByText('Blocked by: Build API')).toBeInTheDocument()
    expect(within(dialog).queryByRole('combobox', { name: 'Task to wait for' })).not.toBeInTheDocument()      // the chooser closes
    expect(await screen.findByText('Dependencies saved')).toBeInTheDocument()
  })

  it('a task it already waits for is not offered again, and a second one is added to the first', async () => {
    const user = userEvent.setup()
    const server = await mount()
    const dialog = await openDrawerOf(user, '02')                              // "Build API" waits for "Design schema"
    expect(await within(dialog).findByText('Blocked by: Design schema')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Add dependency' }))
    const pick = await within(dialog).findByRole('combobox', { name: 'Task to wait for' })
    await waitFor(() => expect(pick).toBeEnabled())
    expect(within(pick).queryByRole('option', { name: /Design schema/ })).not.toBeInTheDocument()
    expect(within(pick).queryByRole('option', { name: /Build API/ })).not.toBeInTheDocument()
    await user.selectOptions(pick, T('05'))
    await waitFor(() => expect(calls(server, 'put', `/tasks/${T('02')}`)[0].body).toEqual({ dependencies: [T('01'), T('05')] }))
    expect(await within(dialog).findByText('Blocked by: Set up CI')).toBeInTheDocument()
    expect(within(dialog).getByText('Blocked by: Design schema')).toBeInTheDocument()
  })

  it('Remove takes one dependency away and keeps the others', async () => {
    const user = userEvent.setup()
    const server = await mount()
    const dialog = await openDrawerOf(user, '04')                              // "Deploy" waits for "Write tests" and "Set up CI"
    expect(await within(dialog).findByText('Blocked by: Write tests')).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Remove dependency Write tests' }))
    await waitFor(() => expect(calls(server, 'put', `/tasks/${T('04')}`)[0].body).toEqual({ dependencies: [T('05')] }))
    await waitFor(() => expect(within(dialog).queryByText('Blocked by: Write tests')).not.toBeInTheDocument())
    expect(within(dialog).getByText('Blocked by: Set up CI')).toBeInTheDocument()
  })

  it('shows which tasks wait for this one', async () => {
    const user = userEvent.setup()
    await mount()
    const dialog = await openDrawerOf(user, '03')                              // "Write tests" is waited for by "Deploy"
    expect(await within(dialog).findByText('Blocks: Deploy')).toBeInTheDocument()
  })

  it('a circular chain is refused with the server\'s reason, and nothing changes', async () => {
    const user = userEvent.setup()
    const server = await mount()
    const dialog = await openDrawerOf(user, '01')                              // "Design schema" -> Build API -> Write tests -> Deploy
    await choose(user, dialog, '04')                                           // it would have to wait for "Deploy", which waits for it
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('These dependencies would create a circular dependency')
    expect(within(dialog).queryByText(/Blocked by:/)).not.toBeInTheDocument()
    expect(calls(server, 'put', `/tasks/${T('01')}`)).toHaveLength(1)
    expect(screen.getByRole('dialog', { name: 'Task details' })).toBeInTheDocument()                          // the details stay open
  })

  it('the chooser can be cancelled without saving', async () => {
    const user = userEvent.setup()
    const server = await mount()
    const dialog = await openDrawerOf(user, '06')
    await user.click(within(dialog).getByRole('button', { name: 'Add dependency' }))
    await within(dialog).findByRole('combobox', { name: 'Task to wait for' })
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(within(dialog).queryByRole('combobox', { name: 'Task to wait for' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Add dependency' })).toBeInTheDocument()
    expect(calls(server, 'put', `/tasks/${T('06')}`)).toHaveLength(0)
  })

  it('a Viewer sees the dependencies but cannot add or remove any', async () => {
    const user = userEvent.setup()
    await mount({ role: 'Viewer' })
    const dialog = await openDrawerOf(user, '04')
    expect(await within(dialog).findByText('Blocked by: Write tests')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Add dependency' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: /Remove dependency/ })).not.toBeInTheDocument()
  })
})

describe('the graph keeps up with the changes', () => {
  it('a task that had no links joins the tree, with its new arrow, after the details are closed', async () => {
    const user = userEvent.setup()
    await mount()
    const dialog = await openDrawerOf(user, '06')
    expect(box('06').style.position).not.toBe('absolute')                       // listed apart, not in the tree
    await choose(user, dialog, '02')
    await within(dialog).findByText('Blocked by: Build API')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Task details' })).not.toBeInTheDocument())
    await waitFor(() => expect(document.querySelector(`[data-edge="${T('02')}>${T('06')}"]`)).toBeTruthy())
    expect(box('06').style.position).toBe('absolute')                           // now part of the tree
    expect(parseFloat(box('06').style.top)).toBeGreaterThan(parseFloat(box('02').style.top))
    expect(screen.getByText('6 tasks · 5 dependencies')).toBeInTheDocument()
  })

  it('removing a dependency takes the arrow away after the details are closed', async () => {
    const user = userEvent.setup()
    await mount()
    const dialog = await openDrawerOf(user, '04')
    await user.click(await within(dialog).findByRole('button', { name: 'Remove dependency Write tests' }))
    await waitFor(() => expect(within(dialog).queryByText('Blocked by: Write tests')).not.toBeInTheDocument())
    await user.keyboard('{Escape}')
    await waitFor(() => expect(document.querySelector(`[data-edge="${T('03')}>${T('04')}"]`)).toBeNull())
    expect(screen.getByText('6 tasks · 3 dependencies')).toBeInTheDocument()
  })
})

describe('the details panel opened from the graph', () => {
  it('saving a change works there too (it has no board to tell)', async () => {
    const user = userEvent.setup()
    const server = await mount()
    const dialog = await openDrawerOf(user, '06')
    await user.type(within(dialog).getByDisplayValue('Write docs'), ' v2')
    await user.click(within(dialog).getByRole('button', { name: /^save/i }))
    await waitFor(() => expect(calls(server, 'put', `/tasks/${T('06')}`)).toHaveLength(1))
    expect(await screen.findByText('Task saved')).toBeInTheDocument()
  })

  it('adding, removing and a refusal run without a React warning or error', async () => {
    const user = userEvent.setup()
    await mount()
    const dialog = await openDrawerOf(user, '06')
    await choose(user, dialog, '04')
    await within(dialog).findByText('Blocked by: Deploy')
    await user.click(within(dialog).getByRole('button', { name: 'Remove dependency Deploy' }))
    await waitFor(() => expect(within(dialog).queryByText('Blocked by: Deploy')).not.toBeInTheDocument())
    expect(consoleErrors.filter((e) => !/not wrapped in act/.test(e))).toEqual([])
  })
})
