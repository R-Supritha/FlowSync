const mongoose = require('mongoose');
const ActivityLog = require('../models/ActivityLog');

// FR21: achievements are worked out from a person's recorded activity, so nothing extra is stored
// and they can never drift from the real data.
const BADGES = [
  { id: 'first-task', title: 'First task done', description: 'Complete your first task', metric: 'tasksCompleted', target: 1 },
  { id: 'task-finisher', title: 'Task finisher', description: 'Complete 10 tasks', metric: 'tasksCompleted', target: 10 },
  { id: 'task-master', title: 'Task master', description: 'Complete 50 tasks', metric: 'tasksCompleted', target: 50 },
  { id: 'planner', title: 'Planner', description: 'Create 5 tasks', metric: 'tasksCreated', target: 5 },
  { id: 'team-voice', title: 'Team voice', description: 'Write 10 comments', metric: 'comments', target: 10 },
  { id: 'first-commit', title: 'First commit', description: 'Have a commit recorded by the GitHub sync', metric: 'commits', target: 1 },
  { id: 'committer', title: 'Steady committer', description: 'Have 25 commits recorded', metric: 'commits', target: 25 },
  { id: 'merger', title: 'Merger', description: 'Get a pull request merged', metric: 'prsMerged', target: 1 },
];

const METRIC_BY_TYPE = {
  task_completed: 'tasksCompleted',
  task_created: 'tasksCreated',
  comment_added: 'comments',
  commit_pushed: 'commits',
  pr_merged: 'prsMerged',
};

const emptyCounts = () => ({ tasksCompleted: 0, tasksCreated: 0, comments: 0, commits: 0, prsMerged: 0 });

// Pure: counts -> { earned, total, badges: [{ id, title, description, target, current, earned }] }
function computeAchievements(counts = {}) {
  const badges = BADGES.map((b) => {
    const have = Number(counts[b.metric]) || 0;
    return { id: b.id, title: b.title, description: b.description, target: b.target, current: Math.min(have, b.target), earned: have >= b.target };
  });
  return { earned: badges.filter((b) => b.earned).length, total: badges.length, badges };
}

// How many of each kind of activity this person has in the given workspaces.
// GitHub events that could not be matched to a profile are credited to whoever linked the repository,
// so those (meta.matchedUser === false) never count towards anybody's achievements.
async function loadAchievementCounts(userId, workspaceIds) {
  const counts = emptyCounts();
  if (!workspaceIds || workspaceIds.length === 0) return counts;
  const rows = await ActivityLog.aggregate([
    {
      $match: {
        actor: new mongoose.Types.ObjectId(String(userId)),
        workspace: { $in: workspaceIds.map((id) => new mongoose.Types.ObjectId(String(id))) },
        type: { $in: Object.keys(METRIC_BY_TYPE) },
        'meta.matchedUser': { $ne: false },
      },
    },
    { $group: { _id: '$type', n: { $sum: 1 } } },
  ]);
  for (const row of rows) if (METRIC_BY_TYPE[row._id]) counts[METRIC_BY_TYPE[row._id]] = row.n;
  return counts;
}

module.exports = { BADGES, computeAchievements, loadAchievementCounts, METRIC_BY_TYPE };
