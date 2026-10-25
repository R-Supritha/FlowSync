// "4 commits, 1 PRs opened, 0 merged", plus issues, releases and new branches only when there were some.
export function summaryText(s = {}) {
  const base = `${s.commits || 0} commits, ${s.prsOpened || 0} PRs opened, ${s.prsMerged || 0} merged`
  const extras = []
  if (s.issuesOpened) extras.push(`${s.issuesOpened} issue${s.issuesOpened === 1 ? '' : 's'} opened`)
  if (s.issuesClosed) extras.push(`${s.issuesClosed} closed`)
  if (s.releases) extras.push(`${s.releases} release${s.releases === 1 ? '' : 's'}`)
  if (s.newBranches) extras.push(`${s.newBranches} new branch${s.newBranches === 1 ? '' : 'es'}`)
  return extras.length ? `${base}, ${extras.join(', ')}` : base
}
