import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ids, token } from './token'
import { summaryText } from '../src/utils/githubSummary'
import { ACTIVITY_LABELS } from '../src/utils/activity'

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

describe('FR13: issues, releases and branches', () => {
  it('the summary wording adds issues, releases and new branches only when there were some', () => {
    expect(summaryText({ commits: 4, prsOpened: 1, prsMerged: 0 })).toBe('4 commits, 1 PRs opened, 0 merged')
    expect(summaryText({ commits: 4, prsOpened: 1, prsMerged: 0, issuesOpened: 2, issuesClosed: 1, releases: 1, newBranches: 1 }))
      .toBe('4 commits, 1 PRs opened, 0 merged, 2 issues opened, 1 closed, 1 release, 1 new branch')
    expect(summaryText({ issuesOpened: 1, releases: 3, newBranches: 2 })).toBe('0 commits, 0 PRs opened, 0 merged, 1 issue opened, 3 releases, 2 new branches')
    expect(summaryText()).toBe('0 commits, 0 PRs opened, 0 merged')
  })

  it('the activity feed has words for the new kinds', () => {
    expect(ACTIVITY_LABELS.issue_opened).toBe('Issue opened')
    expect(ACTIVITY_LABELS.issue_closed).toBe('Issue closed')
    expect(ACTIVITY_LABELS.release_published).toBe('Release')
  })

  it('a sync reports issues, releases and new branches in its message', async () => {
    const user = userEvent.setup()
    const server = await mount({ githubExtras: 'some' })
    await user.click(await screen.findByRole('button', { name: 'Sync now' }))
    await waitFor(() => expect(server.calls.some((c) => c.method === 'post' && c.url === `/projects/${ids.project}/github/sync`)).toBe(true))
    expect(await screen.findByText('Synced sunithaa42/FlowSync: 2 commits, 1 PRs opened, 0 merged, 2 issues opened, 1 closed, 1 release, 1 new branch; 1 task moved')).toBeInTheDocument()
  })

  it('the panel lists the branches and the new ones, and the last sync includes the extras', async () => {
    await mount({ githubExtras: 'some' })
    const branches = (await screen.findByText('Branches')).closest('div')
    expect(within(branches).getByText('4')).toBeInTheDocument()
    expect(within(branches).getByText(/new: feature\/search/)).toBeInTheDocument()
    expect(screen.getByText('4 commits, 1 PRs opened, 0 merged, 2 issues opened, 1 closed, 1 release, 1 new branch')).toBeInTheDocument()
  })

  it('an older link with no branch information shows no Branches row', async () => {
    await mount({ githubExtras: 'none' })
    await screen.findByText('Last synced')
    expect(screen.queryByText('Branches')).not.toBeInTheDocument()
    expect(screen.getByText('4 commits, 1 PRs opened, 0 merged')).toBeInTheDocument()
  })

  it('when the token cannot read issues, the sync still works and says what to do', async () => {
    const user = userEvent.setup()
    await mount({ githubExtras: 'denied' })
    await user.click(await screen.findByRole('button', { name: 'Sync now' }))
    expect(await screen.findByText(/Synced sunithaa42\/FlowSync: 2 commits/)).toBeInTheDocument()
    expect(await screen.findByText('Issues were not read. To include them, give the GitHub token read access to Issues.')).toBeInTheDocument()
  })
})
