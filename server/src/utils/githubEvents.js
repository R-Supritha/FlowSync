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

const validDate = (value) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

// FR13: issues (opened, closed) and published releases as activity events. These are NOT run through the
// empty-change filter: that one looks up pull requests by number, and an issue number is not a pull request number.
function buildExtraEvents({ repo, issues, releases, since }) {
  const events = [];

  for (const i of issues || []) {
    if (!i || typeof i.number !== 'number' || i.pull_request) continue;
    const login = (i.user && i.user.login) || null;
    const meta = { source: 'github', repo, number: i.number, url: i.html_url, githubLogin: login, title: i.title };
    const opened = validDate(i.created_at);
    if (opened && opened >= since) {
      events.push({ key: `${repo}:issue-opened:${i.number}`, type: 'issue_opened', login, date: opened, message: `opened issue #${i.number} "${firstLine(i.title)}"`, text: '', meta });
    }
    const closed = i.closed_at ? validDate(i.closed_at) : null;
    if (closed && closed >= since) {
      const closer = (i.closed_by && i.closed_by.login) || login;
      events.push({ key: `${repo}:issue-closed:${i.number}`, type: 'issue_closed', login: closer, date: closed, message: `closed issue #${i.number} "${firstLine(i.title)}"`, text: '', meta: { ...meta, githubLogin: closer } });
    }
  }

  for (const r of releases || []) {
    if (!r || r.draft || !r.published_at) continue; // a draft is not published yet
    const published = validDate(r.published_at);
    if (!published || published < since) continue;
    const login = (r.author && r.author.login) || null;
    const label = r.name || r.tag_name || 'release';
    const tag = r.tag_name && r.name && r.name !== r.tag_name ? ` (${r.tag_name})` : '';
    events.push({
      key: `${repo}:release:${r.id}`,
      type: 'release_published',
      login,
      date: published,
      message: `published release "${firstLine(label)}"${tag}`,
      text: '',
      meta: { source: 'github', repo, tag: r.tag_name, url: r.html_url, githubLogin: login },
    });
  }

  return events.sort((a, b) => a.date - b.date);
}

// Which of the branches are new since the last sync. The first sync only remembers the existing ones.
function findNewBranches({ branches, known, baselined }) {
  const names = [...new Set((branches || []).map((b) => b && b.name).filter((n) => typeof n === 'string' && n))];
  const fresh = baselined ? names.filter((n) => !(known || []).includes(n)) : [];
  return { names, fresh };
}

module.exports = { parseRepo, buildEvents, buildExtraEvents, findNewBranches };
