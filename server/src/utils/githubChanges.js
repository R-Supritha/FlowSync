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

// Git stores an empty file under one fixed id. A commit that only adds (or removes) empty files changes
// no content, so it is not progress either: "git add empty.txt" is the same shortcut as --allow-empty.
const EMPTY_BLOB_SHA = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';
const isEmptyFile = (f) => Boolean(f) && (f.status === 'added' || f.status === 'removed') && f.sha === EMPTY_BLOB_SHA;
const meaningfulFiles = (files) => files.filter((f) => !isEmptyFile(f));

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
  const fileCount = files ? meaningfulFiles(files).length : (total > 0 ? 1 : 0);
  const lines = total !== null
    ? total
    : files.reduce((n, f) => n + (Number(f.additions) || 0) + (Number(f.deletions) || 0), 0);
  return enoughChange(fileCount, lines, minLines);
}

// detail = GET /repos/:owner/:name/pulls/:number
function pullHasChanges(detail, minLines = minChangedLines()) {
  if (!detail || typeof detail !== 'object' || typeof detail.changed_files !== 'number') return true;
  const lines = (Number(detail.additions) || 0) + (Number(detail.deletions) || 0);
  // When the caller also fetched the file list (only needed if there are files but no text lines),
  // files that are just empty files do not count.
  const fileCount = Array.isArray(detail.files) ? meaningfulFiles(detail.files).length : detail.changed_files;
  return enoughChange(fileCount, lines, minLines);
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
async function filterRealEvents({ events, knownKeys, getCommit, getPull, getPullFiles, extractRefs, minLines = minChangedLines(), concurrency = 5 }) {
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
    let detail = await getPull(number);
    // A pull request with files but no text lines may be a picture, a rename or only empty files:
    // look at its files to tell them apart (one extra call, only in that rare case).
    const noLines = detail && (Number(detail.additions) || 0) + (Number(detail.deletions) || 0) === 0;
    if (getPullFiles && detail && Number(detail.changed_files) > 0 && noLines) {
      detail = { ...detail, files: await getPullFiles(number) };
    }
    pullOk.set(number, pullHasChanges(detail, minLines));
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

module.exports = { requireChanges, minChangedLines, commitHasChanges, pullHasChanges, isEmptyFile, EMPTY_BLOB_SHA, mapLimit, markerKey, filterRealEvents };
