// "owner/name" or a github.com link -> { owner, name }, or null if it is not a valid repository.
function parseRepo(input) {
  if (typeof input !== 'string') return null;
  const cleaned = input
    .trim()
    .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const match = cleaned.match(/^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})$/);
  if (!match || /^\.+$/.test(match[2])) return null;
  return { owner: match[1], name: match[2] };
}

function firstLine(text, max = 120) {
  const line = String(text || '').split('\n')[0].trim();
  return line.length > max ? line.slice(0, max - 3) + '...' : line;
}

// Turns GitHub's commit and pull request lists into activity events (oldest first).
// Each event has a unique key so a later sync can skip what it has already recorded.
function buildEvents({ repo, commits, pulls, since }) {
  const events = [];

  for (const c of commits || []) {
    if (!c || !c.sha) continue;
    const info = c.commit || {};
    const rawDate = (info.author && info.author.date) || (info.committer && info.committer.date);
    const when = rawDate ? new Date(rawDate) : new Date();
    if (Number.isNaN(when.getTime()) || when < since) continue;
    const login = (c.author && c.author.login) || null;
    const fullMessage = String(info.message || '');
    events.push({
      key: `${repo}:commit:${c.sha}`,
      type: 'commit_pushed',
      login,
      date: when,
      message: `committed "${firstLine(fullMessage)}" (${c.sha.slice(0, 7)})`,
      text: fullMessage,
      meta: {
        source: 'github',
        repo,
        sha: c.sha,
        url: c.html_url,
        githubLogin: login,
        commitMessage: fullMessage.slice(0, 500),
      },
    });
  }

  for (const p of pulls || []) {
    if (!p || typeof p.number !== 'number') continue;
    const login = (p.user && p.user.login) || null;
    const meta = {
      source: 'github',
      repo,
      number: p.number,
      url: p.html_url,
      githubLogin: login,
      title: p.title,
      branch: p.head && p.head.ref,
    };

    // Where a task reference (FS-xxxxxx) may appear: title, branch name, description.
    const text = [p.title, p.head && p.head.ref, p.body].filter(Boolean).join('\n').slice(0, 2000);

    const opened = new Date(p.created_at);
    if (!Number.isNaN(opened.getTime()) && opened >= since) {
      events.push({
        key: `${repo}:pr-opened:${p.number}`,
        type: 'pr_opened',
        login,
        date: opened,
        message: `opened PR #${p.number} "${firstLine(p.title)}"`,
        text,
        meta,
      });
    }

    if (p.merged_at) {
      const merged = new Date(p.merged_at);
      if (!Number.isNaN(merged.getTime()) && merged >= since) {
        events.push({
          key: `${repo}:pr-merged:${p.number}`,
          type: 'pr_merged',
          login,
          date: merged,
          message: `merged PR #${p.number} "${firstLine(p.title)}"`,
          text,
          meta,
        });
      }
    }
  }

  events.sort((a, b) => a.date - b.date);
  return events;
}

module.exports = { parseRepo, buildEvents };
