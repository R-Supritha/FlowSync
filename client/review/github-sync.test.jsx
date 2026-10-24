import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ids, token } from './token'

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

async function mount(serverOpts) {
  vi.resetModules()
  window.localStorage.clear()
  window.localStorage.setItem('flowsync_token', token)
  window.localStorage.setItem('flowsync_user', JSON.stringify({ id: ids.me, name: 'Sunitha', email: 'sunitha@test.com' }))
  const { makeServer } = await import('./fakeApi')
  const server = makeServer({ githubLinked: true, ...serverOpts })
  const { default: store } = await import('../src/store')
  const { default: App } = await import('../src/App.jsx')
  render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/projects/${ids.project}/github`]}>
        <App />
      </MemoryRouter>
    </Provider>,
  )
  return server
}

describe('GitHub sync message: tasks moved and empty commits ignored', () => {
  it('says how many tasks moved, and that empty commits were ignored and why', async () => {
    const user = userEvent.setup()
    const server = await mount({ githubIgnored: true })
    await user.click(await screen.findByRole('button', { name: 'Sync now' }))
    await waitFor(() => expect(server.calls.some((c) => c.method === 'post' && c.url === `/projects/${ids.project}/github/sync`)).toBe(true))
    expect(await screen.findByText('Synced sunithaa42/FlowSync: 2 commits, 1 PRs opened, 0 merged; 1 task moved')).toBeInTheDocument()
    expect(await screen.findByText(/2 empty commits or pull requests ignored \(no file changes\)\./)).toHaveTextContent('FS-0140ad: commit bbb2222 changes no files, so it did not move the task')
  })

  it('shows no "ignored" message when nothing was empty', async () => {
    const user = userEvent.setup()
    await mount({ githubIgnored: false })
    await user.click(await screen.findByRole('button', { name: 'Sync now' }))
    expect(await screen.findByText(/1 task moved/)).toBeInTheDocument()
    expect(screen.queryByText(/ignored \(no file changes\)/)).not.toBeInTheDocument()
  })
})
