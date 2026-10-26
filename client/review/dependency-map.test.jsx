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

const group = (n) => box(n).getAttribute('data-group')
const topOf = (n) => parseFloat(box(n).style.top)

describe('the dependency graph', () => {
  it('draws every linked task as a box and every dependency as an arrow; a task with no links is listed apart', async () => {
    await mount()
    await waitForMap()
    for (const n of ['01', '02', '03', '04', '05']) expect(box(n)).toBeTruthy()
    expect(document.querySelectorAll('[data-edge]')).toHaveLength(4)                                     // 01>02, 02>03, 03>04, 05>04
    const edges = [...document.querySelectorAll('[data-edge]')].map((e) => e.getAttribute('data-edge')).sort()
    expect(edges).toEqual([`${T('01')}>${T('02')}`, `${T('02')}>${T('03')}`, `${T('03')}>${T('04')}`, `${T('05')}>${T('04')}`])
    const apart = screen.getByRole('region', { name: 'Tasks without dependencies' })
    expect(within(apart).getByText('Write docs')).toBeInTheDocument()
    expect(apart).toHaveTextContent('Not linked to other tasks (1)')
    expect(screen.getByText('6 tasks · 4 dependencies')).toBeInTheDocument()
  })

  it('arrows point down: a task is drawn below the ones it waits for', async () => {
    await mount()
    await waitForMap()
    expect(topOf('02')).toBeGreaterThan(topOf('01'))
    expect(topOf('03')).toBeGreaterThan(topOf('02'))
    expect(topOf('04')).toBeGreaterThan(topOf('03'))
    expect(topOf('04')).toBeGreaterThan(topOf('05'))
  })

  it('the colour of each box shows progress: done, in progress, waiting; the legend explains them', async () => {
    await mount()
    await waitForMap()
    expect(group('05')).toBe('done')
    expect(group('02')).toBe('working')
    expect(group('01')).toBe('waiting')
    expect(group('03')).toBe('waiting')
    const legend = screen.getByLabelText('Legend')
    for (const word of ['Done', 'In progress', 'Backlog or To Do']) expect(legend).toHaveTextContent(word)
  })

  it('a box shows the task title, status, owner and deadline', async () => {
    await mount()
    await waitForMap()
    expect(box('01')).toHaveTextContent('Design schema')
    expect(box('01')).toHaveTextContent('To Do')
    expect(box('01')).toHaveTextContent('Sunitha')                                                       // the owner (first name)
    expect(box('02')).toHaveTextContent('In Progress')
    expect(box('02')).not.toHaveTextContent('·')                                                         // no owner, no deadline: nothing extra
  })

  it('clicking a box opens that task\'s details', async () => {
    const user = userEvent.setup()
    await mount()
    await waitForMap()
    await user.click(box('02'))
    const dialog = await screen.findByRole('dialog', { name: 'Task details' })
    expect(within(dialog).getByDisplayValue('Build API')).toBeInTheDocument()
  })

  it('a task listed apart opens its details too', async () => {
    const user = userEvent.setup()
    await mount()
    await waitForMap()
    await user.click(box('06'))
    expect(await within(await screen.findByRole('dialog', { name: 'Task details' })).findByDisplayValue('Write docs')).toBeInTheDocument()
  })
})

describe('empty and unusual projects', () => {
  it('a project with no tasks says so', async () => {
    await mount({ depGraph: 'none' })
    expect(await screen.findByText('No tasks yet')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-task-id]')).toHaveLength(0)
  })

  it('tasks without any dependency: a clear note, and the tasks are still listed', async () => {
    await mount({ depGraph: 'none-linked' })
    expect(await screen.findByText(/No dependencies yet/)).toBeInTheDocument()
    expect(screen.getByText(/Projects made with the AI generator/)).toBeInTheDocument()
    expect(document.querySelectorAll('[data-edge]')).toHaveLength(0)
    expect(within(screen.getByRole('region', { name: 'Tasks without dependencies' })).getByText('Write docs')).toBeInTheDocument()
  })

  it('a circular dependency in old data still draws every task, without crashing', async () => {
    await mount({ depGraph: 'cycle' })
    await waitForMap()
    for (const n of ['01', '02', '03']) expect(box(n)).toBeTruthy()
    expect(document.querySelectorAll('[data-edge]')).toHaveLength(3)
  })

  it('shows the reason and a Try again button when the tasks cannot be loaded', async () => {
    const user = userEvent.setup()
    const server = await mount({ depGraph: 'chain', failTasks: true })
    expect(await screen.findByText(/Could not load the tasks|boom/i)).toBeInTheDocument()
    server.state.failTasks = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    await waitForMap()
  })
})

describe('around the graph', () => {
  it('the project\'s sidebar has a Dependencies link, and a Viewer can look at the graph', async () => {
    await mount({ role: 'Viewer' })
    await waitForMap()
    const link = await screen.findByRole('link', { name: 'Dependencies' })
    expect(link).toHaveAttribute('href', `/projects/${ids.project}/dependencies`)
  })

  it('runs without a React warning or error', async () => {
    const user = userEvent.setup()
    await mount()
    await waitForMap()
    await user.click(box('03'))
    await screen.findByRole('dialog', { name: 'Task details' })
    expect(consoleErrors.filter((e) => !/not wrapped in act/.test(e))).toEqual([])
  })
})
