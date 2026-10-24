// "Empty commits do not count." A commit or pull request only counts as progress when it really
// changed something. Without this, `git commit --allow-empty -m "FS-xxxxxx"` would move a task
// to In Progress (and an empty pull request to Review or Done) without any work behind it.
//
// Rule: at least one changed file, and, when the change is made of text lines, at least
// GITHUB_MIN_CHANGED_LINES of them (default 1). A change with no countable lines (a picture, a rename,
// a file mode) still counts, because it is a real change.
// Switch the whole check off with GITHUB_REQUIRE_CHANGES=false (for quick demos).

function requireChanges() {
  return String(process.env.GITHUB_REQUIRE_CHANGES || 'true').trim().toLowerCase() !== 'false';
}

function minChangedLines() {
  const n = Math.floor(Number(process.env.GITHUB_MIN_CHANGED_LINES));
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

function enoughChange(fileCount, lines, minLines) {
  if (fileCount < 1) return false;
  if (lines === 0) return true; // binary file, rename or mode change only: still a real change
  return lines >= minLines;
}

// detail = GET /repos/:owner/:name/commits/:sha
function commitHasChanges(detail, minLines = minChangedLines()) {
  if (!detail || typeof detail !== 'object') return true; // no information: do not punish
  const files = Array.isArray(detail.files) ? detail.files : null;
  const total = detail.stats && typeof detail.stats.total === 'number' ? detail.stats.total : null;
  if (files === null && total === null) return true; // GitHub gave no change information at all
  const fileCount = files ? files.length : (total > 0 ? 1 : 0);
  const lines = total !== null
    ? total
    : files.reduce((n, f) => n + (Number(f.additions) || 0) + (Number(f.deletions) || 0), 0);
  return enoughChange(fileCount, lines, minLines);
}

// detail = GET /repos/:owner/:name/pulls/:number
function pullHasChanges(detail, minLines = minChangedLines()) {
  if (!detail || typeof detail !== 'object' || typeof detail.changed_files !== 'number') return true;
  const lines = (Number(detail.additions) || 0) + (Number(detail.deletions) || 0);
  return enoughChange(detail.changed_files, lines, minLines);
}

// Runs fn over items with at most `limit` running at the same time. Rejects on the first error.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next;
      next += 1;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// The marker row stored for an event that was found empty, so later syncs do not ask GitHub again.
const markerKey = (ev) => ev.key.replace(':', ':empty:');

// events:    from buildEvents (commit_pushed / pr_opened / pr_merged)
// knownKeys: Set of GithubEvent keys that already exist (recorded events AND empty markers)
// Returns { events: the real ones, skipped: counts, notes: [...], markers: [keys to store] }.
// Events already recorded are kept, so the caller counts them as duplicates as before.
async function filterRealEvents({ events, knownKeys, getCommit, getPull, extractRefs, minLines = minChangedLines(), concurrency = 5 }) {
  const none = { commits: 0, pullRequests: 0, alreadyIgnored: 0 };
  if (!requireChanges()) return { events, skipped: none, notes: [], markers: [] };

  const isNew = (ev) => !knownKeys.has(ev.key) && !knownKeys.has(markerKey(ev));
  const commits = events.filter((ev) => ev.type === 'commit_pushed' && isNew(ev));
  const pulls = [...new Set(events.filter((ev) => ev.type !== 'commit_pushed' && isNew(ev)).map((ev) => ev.meta.number))];

  const commitOk = new Map();
  const pullOk = new Map();
  await mapLimit(commits, concurrency, async (ev) => {
    commitOk.set(ev.meta.sha, commitHasChanges(await getCommit(ev.meta.sha), minLines));
  });
  await mapLimit(pulls, concurrency, async (number) => {
    pullOk.set(number, pullHasChanges(await getPull(number), minLines));
  });

  const kept = [];
  const markers = [];
  const notes = new Set();
  const skipped = { ...none };
  for (const ev of events) {
    if (knownKeys.has(markerKey(ev))) { skipped.alreadyIgnored += 1; continue; } // found empty before
    const isCommit = ev.type === 'commit_pushed';
    const ok = isCommit ? commitOk.get(ev.meta.sha) : pullOk.get(ev.meta.number);
    if (ok === false && isNew(ev)) {
      markers.push(markerKey(ev));
      if (isCommit) skipped.commits += 1; else skipped.pullRequests += 1;
      const what = isCommit ? `commit ${String(ev.meta.sha).slice(0, 7)} changes no files` : `PR #${ev.meta.number} has no file changes`;
      for (const key of extractRefs(ev.text)) notes.add(`FS-${key}: ${what}, so it did not move the task`);
      continue;
    }
    kept.push(ev);
  }
  return { events: kept, skipped, notes: [...notes], markers };
}

module.exports = { requireChanges, minChangedLines, commitHasChanges, pullHasChanges, mapLimit, markerKey, filterRealEvents };
