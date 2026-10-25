const { GithubError, listIssues, listReleases, listBranches } = require('./githubClient');
const { buildExtraEvents, findNewBranches } = require('./githubEvents');

// FR13: reads issues, releases and branches. They are optional extras: a fine-grained token that cannot read one of
// them must not stop commits and pull requests from syncing. Each one that fails is reported and skipped.
// A rate limit (429) is the exception: it stops the whole sync, like it does for commits.
const WHY = {
  issues: 'Issues were not read. To include them, give the GitHub token read access to Issues.',
  releases: 'Releases were not read (the token could not list them).',
  branches: 'Branches were not read (the token could not list them).',
};

async function collectExtras({ token, owner, name, repo, since, link }) {
  const unavailable = [];
  const notes = [];
  const read = async (what, fn) => {
    try {
      return await fn();
    } catch (error) {
      if (!(error instanceof GithubError) || error.status === 429) throw error;
      unavailable.push(what);
      notes.push(WHY[what]);
      return null;
    }
  };

  const issues = await read('issues', () => listIssues(token, owner, name, since));
  const releases = await read('releases', () => listReleases(token, owner, name));
  const branches = await read('branches', () => listBranches(token, owner, name));

  const events = buildExtraEvents({ repo, issues, releases, since });
  const branchInfo = branches
    ? findNewBranches({ branches, known: link.knownBranches, baselined: link.branchesBaselined })
    : null;

  return { events, notes, unavailable, branchNames: branchInfo ? branchInfo.names : null, newBranches: branchInfo ? branchInfo.fresh : [] };
}

module.exports = { collectExtras };
