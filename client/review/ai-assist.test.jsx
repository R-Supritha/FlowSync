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
const calls = (server, method, url) => server.calls.filter((c) => c.method === method && c.url === url)

async function openDrawer(opts = {}) {
  const user = userEvent.setup()
  const ctx = await mount({ route: `${P}/board`, ...opts })
  await user.click(await screen.findByText('Build login page'))
  const drawer = await screen.findByRole('dialog', { name: 'Task details' })
  const section = await within(drawer).findByRole('region', { name: 'Subtasks' })
  return { user, drawer, section, ...ctx }
}

describe('FR25: subtasks and AI task breakdown in the task drawer', () => {
  it('shows the subtasks section; you can add, tick and remove your own subtasks', async () => {
    const { user, section, server } = await openDrawer()
    expect(within(section).getByText('No subtasks yet.')).toBeInTheDocument()
    await user.type(within(section).getByLabelText('New subtask'), 'Write the form')
    await user.click(within(section).getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(called(server, 'put', `/tasks/${ids.t1}`).body).toEqual({ subtasks: [{ title: 'Write the form', done: false }] }))
    expect(await within(section).findByText('Write the form')).toBeInTheDocument()
    await user.click(within(section).getByLabelText('Mark "Write the form" done'))
    await waitFor(() => expect(calls(server, 'put', `/tasks/${ids.t1}`).at(-1).body).toEqual({ subtasks: [{ title: 'Write the form', done: true }] }))
    expect(await within(section).findByText('Subtasks (1/1 done)')).toBeInTheDocument()
    await user.click(within(section).getByRole('button', { name: 'Remove "Write the form"' }))
    await waitFor(() => expect(calls(server, 'put', `/tasks/${ids.t1}`).at(-1).body).toEqual({ subtasks: [] }))
  })

  it('the AI suggests subtasks; you pick, edit and add only the ones you want, and they are saved under the task', async () => {
    const { user, section, server } = await openDrawer()
    await user.click(within(section).getByRole('button', { name: 'Break into subtasks (AI)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Break into subtasks with AI' })
    await user.type(within(dialog).getByLabelText(/Anything the AI should know/), 'use React')
    await user.click(within(dialog).getByRole('button', { name: 'Suggest subtasks' }))
    await waitFor(() => expect(called(server, 'post', `/tasks/${ids.t1}/ai/breakdown`).body).toEqual({ hint: 'use React' }))
    const list = await within(dialog).findByRole('list', { name: 'Suggested subtasks' })
    expect(within(list).getAllByRole('checkbox')).toHaveLength(3)
    await user.click(within(list).getByLabelText('Add subtask 3'))                 // do not keep the third
    const first = within(list).getByLabelText('Subtask 1 title')
    await user.clear(first); await user.type(first, 'Design the sign-in form')    // edit the first
    expect(within(dialog).getByRole('button', { name: 'Add 2 subtasks' })).toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: 'Add 2 subtasks' }))
    await waitFor(() => expect(calls(server, 'put', `/tasks/${ids.t1}`).at(-1).body).toEqual({ subtasks: [{ title: 'Design the sign-in form', done: false }, { title: 'Add JWT middleware', done: false }] }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Break into subtasks with AI' })).not.toBeInTheDocument())
    expect(await within(section).findByText('Design the sign-in form')).toBeInTheDocument()
    expect(within(section).queryByText('Write password hashing')).not.toBeInTheDocument()
    expect(await screen.findByText('2 subtasks added')).toBeInTheDocument()
  })

  it('shows the AI problem in plain words and lets you try again', async () => {
    const { user, section } = await openDrawer({ breakdown: 'off' })
    await user.click(within(section).getByRole('button', { name: 'Break into subtasks (AI)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Break into subtasks with AI' })
    await user.click(within(dialog).getByRole('button', { name: 'Suggest subtasks' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('AI is not configured on this server')
    expect(within(dialog).getByRole('button', { name: 'Try again' })).toBeEnabled()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog', { name: 'Break into subtasks with AI' })).not.toBeInTheDocument()
  })

  it('a Viewer sees subtasks read-only: no add form, no AI button, boxes disabled', async () => {
    const { section } = await openDrawer({ role: 'Viewer' })
    expect(within(section).queryByRole('button', { name: 'Break into subtasks (AI)' })).not.toBeInTheDocument()
    expect(within(section).queryByLabelText('New subtask')).not.toBeInTheDocument()
  })
})

describe('FR23: the stand-up report page', () => {
  const generate = async (user) => user.click(await screen.findByRole('button', { name: 'Generate report' }))

  it('starts empty, then builds a report (written by AI) with a card per person', async () => {
    const user = userEvent.setup()
    const { server } = await mount({ route: `${P}/standup` })
    expect(await screen.findByText('No report yet')).toBeInTheDocument()
    await generate(user)
    await waitFor(() => expect(called(server, 'post', `/projects/${ids.project}/ai/standup`).body).toEqual({ windowHours: 24, useAi: true }))
    const report = await screen.findByRole('region', { name: 'Stand-up report' })
    expect(within(report).getByText('Written by AI')).toBeInTheDocument()
    expect(within(report).getByText('A productive day with the login work finished.')).toBeInTheDocument()
    const sun = within(report).getByRole('article', { name: 'Sunitha' })
    expect(within(sun).getByText('Shipped the login page and fixed two bugs.')).toBeInTheDocument()
    expect(within(sun).getByText('3 commits')).toBeInTheDocument()
    expect(within(sun).getByText('1 task done')).toBeInTheDocument()   // singular reads correctly
    expect(within(sun).queryByText('0 comments')).not.toBeInTheDocument()
    expect(within(sun).getByText('Working on:').closest('p')).toHaveTextContent('Build login page')
    expect(within(sun).getByText('Blockers:').closest('p')).toHaveTextContent('"Search" is waiting on "Build login page"')
    expect(within(report).getByText(/Unassigned problems:/)).toBeInTheDocument()
  })

  it('sends the chosen period and the AI switch', async () => {
    const user = userEvent.setup()
    const { server } = await mount({ route: `${P}/standup` })
    await user.selectOptions(await screen.findByLabelText('Period'), '72')
    await user.click(screen.getByLabelText('Write it with AI'))
    await generate(user)
    await waitFor(() => expect(called(server, 'post', `/projects/${ids.project}/ai/standup`).body).toEqual({ windowHours: 72, useAi: false }))
    expect(await screen.findByText('Plain report')).toBeInTheDocument()
  })

  it('when the AI fails the plain report is still shown, with the reason, and can be copied', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await mount({ route: `${P}/standup`, standup: 'rules' })
    await generate(user)
    const report = await screen.findByRole('region', { name: 'Stand-up report' })
    expect(within(report).getByText('Plain report')).toBeInTheDocument()
    expect(within(report).getByRole('status')).toHaveTextContent('The AI was not available')
    expect(within(report).getByText(/In the last 24 hours: 3 commits, completed 1 task/)).toBeInTheDocument()
    await user.click(within(report).getByRole('button', { name: 'Copy as text' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())
    const text = writeText.mock.calls[0][0]
    expect(text).toContain('Stand-up: Demo Project'); expect(text).toContain('- Sunitha: In the last 24 hours: 3 commits'); expect(text).toContain('Blockers:')
  })

  it('says so when there is nothing to report', async () => {
    const user = userEvent.setup()
    await mount({ route: `${P}/standup`, standup: 'empty' })
    await generate(user)
    expect(await screen.findByText('Nothing to report')).toBeInTheDocument()
  })
})

describe('FR24: the sprint planning page', () => {
  const plan = async (user) => user.click(await screen.findByRole('button', { name: 'Plan sprint' }))

  it('plans with the default settings and shows capacity, the proposed tasks, the deferred ones with reasons, and the AI goal', async () => {
    const user = userEvent.setup()
    const { server } = await mount({ route: `${P}/sprint` })
    expect(await screen.findByText('No plan yet')).toBeInTheDocument()
    await plan(user)
    await waitFor(() => expect(called(server, 'post', `/projects/${ids.project}/ai/sprint-plan`).body).toEqual({ sprintDays: 14, hoursPerPerson: 30, useAi: true }))
    const result = await screen.findByRole('region', { name: 'Sprint plan' })
    expect(within(result).getByText('90 h')).toBeInTheDocument()                    // capacity 3 x 30
    expect(within(result).getByRole('progressbar', { name: 'Capacity used' })).toHaveAttribute('aria-valuenow', '7')
    expect(within(result).getByText('1 task has no estimate, so 4 h was assumed for each.')).toBeInTheDocument()
    const rows = within(result).getAllByRole('row')
    expect(within(rows[1]).getByText('Build login page')).toBeInTheDocument()
    expect(within(rows[2]).getByText('2 (assumed)')).toBeInTheDocument()
    expect(within(rows[2]).getByText('Build login page', { selector: 'td' })).toBeInTheDocument() // "After" column
    expect(within(result).getByText(/more than the whole sprint \(30 h\)/)).toBeInTheDocument()
    const ai = within(result).getByLabelText('AI summary')
    expect(within(ai).getByText('Ship a working login.')).toBeInTheDocument()
    expect(within(ai).getByText('Task 2 has no estimate')).toBeInTheDocument()
  })

  it('sends your own length, people and hours, and the AI switch', async () => {
    const user = userEvent.setup()
    const { server } = await mount({ route: `${P}/sprint` })
    const days = await screen.findByLabelText('Sprint length (days)')
    await user.clear(days); await user.type(days, '7')
    await user.type(screen.getByLabelText('People'), '2')
    const hours = screen.getByLabelText('Hours per person'); await user.clear(hours); await user.type(hours, '10')
    await user.click(screen.getByLabelText('Add an AI-written goal'))
    await plan(user)
    await waitFor(() => expect(called(server, 'post', `/projects/${ids.project}/ai/sprint-plan`).body).toEqual({ sprintDays: 7, hoursPerPerson: 10, people: 2, useAi: false }))
    const result = await screen.findByRole('region', { name: 'Sprint plan' })
    expect(within(result).getByText('20 h')).toBeInTheDocument()
    expect(within(result).queryByLabelText('AI summary')).not.toBeInTheDocument()
  })

  it('the plan is still shown when the AI part fails', async () => {
    const user = userEvent.setup()
    await mount({ route: `${P}/sprint`, sprint: 'ai-down' })
    await plan(user)
    const result = await screen.findByRole('region', { name: 'Sprint plan' })
    expect(within(result).getByText(/The AI goal is not available \(The AI service timed out/)).toBeInTheDocument()
    expect(within(result).getAllByText('Build login page').length).toBeGreaterThan(0)
  })

  it('an Admin starts the sprint after a confirmation: the tasks are sent, and a link to the board appears', async () => {
    const user = userEvent.setup()
    const { server } = await mount({ route: `${P}/sprint` })
    await plan(user)
    await user.click(await screen.findByRole('button', { name: 'Start sprint (2 tasks)' }))
    const dialog = await screen.findByRole('dialog', { name: 'Start this sprint?' })
    expect(dialog).toHaveTextContent('2 tasks will be moved from Backlog to To Do.')
    await user.click(within(dialog).getByRole('button', { name: 'Start sprint' }))
    await waitFor(() => expect(called(server, 'post', `/projects/${ids.project}/sprint/apply`).body).toEqual({ taskIds: [ids.t1, ids.t2] }))
    const done = await screen.findByRole('region', { name: 'Sprint started' })
    expect(done).toHaveTextContent('2 tasks moved to To Do')
    expect(within(done).getByRole('link', { name: 'Open the board' })).toHaveAttribute('href', `${P}/board`)
    expect(screen.queryByRole('region', { name: 'Sprint plan' })).not.toBeInTheDocument()
  })

  it('a Member can plan but cannot start; a Viewer cannot plan at all', async () => {
    const user = userEvent.setup()
    await mount({ route: `${P}/sprint`, role: 'Member' })
    await plan(user)
    expect(await screen.findByText('Only an Admin or Manager can start the sprint.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Start sprint/ })).not.toBeInTheDocument()
  })

  it('a Viewer sees a note and a disabled Plan button', async () => {
    await mount({ route: `${P}/sprint`, role: 'Viewer' })
    expect(await screen.findByText('Viewers cannot plan sprints.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plan sprint' })).toBeDisabled()
  })

  it('explains an empty Backlog', async () => {
    const user = userEvent.setup()
    await mount({ route: `${P}/sprint`, sprint: 'empty' })
    await plan(user)
    expect(await screen.findByText('The Backlog column is empty, so there is nothing to plan.')).toBeInTheDocument()
    expect(screen.getByText('Nothing fits. See the deferred tasks below for why.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Start sprint/ })).toBeDisabled()
  })
})

describe('navigation and quiet console', () => {
  it('the project tree in the sidebar links to Stand-up and Sprint', async () => {
    await mount({ route: `${P}/standup` })
    expect(await screen.findByRole('link', { name: 'Stand-up' })).toHaveAttribute('href', `${P}/standup`)
    expect(screen.getByRole('link', { name: 'Sprint' })).toHaveAttribute('href', `${P}/sprint`)
  })

  it('the three screens open and run without a React warning or error', async () => {
    const user = userEvent.setup()
    for (const route of [`${P}/standup`, `${P}/sprint`]) {
      cleanup()
      await mount({ route })
      await user.click(await screen.findByRole('button', { name: /Generate report|Plan sprint/ }))
      await new Promise((r) => setTimeout(r, 200))
    }
    cleanup()
    await openDrawer()
    await new Promise((r) => setTimeout(r, 200))
    expect(consoleErrors.filter((e) => !/not wrapped in act/.test(e))).toEqual([])
  })
})
