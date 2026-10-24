// GITHUB_API_URL only exists so the automatic checks can talk to a fake GitHub.
const apiBase = () => process.env.GITHUB_API_URL || 'https://api.github.com';

class GithubError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'GithubError';
    this.status = status;
  }
}

async function github(path, token, params) {
  const url = new URL(apiBase() + path);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined) url.searchParams.set(key, String(value));
  });

  let response;
  try {
    response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'FlowSync',
      },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    throw new GithubError(502, 'Could not reach GitHub (network problem or timeout)');
  }

  if (response.ok) return response.json();

  if (response.status === 401) {
    throw new GithubError(400, 'GitHub rejected the token (wrong, expired or revoked)');
  }
  if (response.status === 403 || response.status === 429) {
    if (response.status === 429 || response.headers.get('x-ratelimit-remaining') === '0') {
      throw new GithubError(429, 'GitHub rate limit reached, try again in a few minutes');
    }
    throw new GithubError(400, 'The token does not have permission for this. It needs read access to Contents and Pull requests');
  }
  if (response.status === 404) {
    throw new GithubError(400, 'Repository not found, or the token has no access to it');
  }
  if (response.status === 409) {
    throw new GithubError(409, 'The repository is empty');
  }
  throw new GithubError(502, `GitHub returned an unexpected error (${response.status})`);
}

const repoPath = (owner, name) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

function getRepo(token, owner, name) {
  return github(repoPath(owner, name), token);
}

async function listCommits(token, owner, name, since) {
  try {
    return await github(`${repoPath(owner, name)}/commits`, token, {
      since: since.toISOString(),
      per_page: 30,
    });
  } catch (error) {
    if (error instanceof GithubError && error.status === 409) return []; // empty repository
    throw error;
  }
}

// One commit WITH its changed files (the list above does not say what a commit changed).
function getCommit(token, owner, name, sha) {
  return github(`${repoPath(owner, name)}/commits/${encodeURIComponent(sha)}`, token);
}

// One pull request WITH its change counts (changed_files, additions, deletions).
function getPull(token, owner, name, number) {
  return github(`${repoPath(owner, name)}/pulls/${encodeURIComponent(number)}`, token);
}

// The files of one pull request (first 100), used to tell empty files from real changes.
function listPullFiles(token, owner, name, number) {
  return github(`${repoPath(owner, name)}/pulls/${encodeURIComponent(number)}/files`, token, { per_page: 100 });
}

function listPulls(token, owner, name) {
  return github(`${repoPath(owner, name)}/pulls`, token, {
    state: 'all',
    sort: 'updated',
    direction: 'desc',
    per_page: 30,
  });
}

module.exports = { GithubError, getRepo, listCommits, listPulls, getCommit, getPull, listPullFiles };