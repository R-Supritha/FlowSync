const { notify } = require('./notify');
const { extractRefs } = require('./githubTaskLinks');

const VERB = { pr_opened: 'opened', pr_merged: 'merged' };

// FR10: when a pull request that mentions a task is opened or merged, the task's assignee and reporter are told
// (except the person who made the pull request). Only called for events FlowSync records for the first time,
// so a sync never notifies twice. Unknown or ambiguous references notify nobody.
// tasks: [{ _id, title, assignee, reporter }]   index: last-6-characters -> [task ids]
async function notifyPullRequest({ ev, project, tasks, index, authorId }) {
  if (!VERB[ev.type]) return 0;
  const byId = new Map((tasks || []).map((t) => [String(t._id), t]));
  const number = ev.meta && ev.meta.number ? ev.meta.number : '';
  const title = (ev.meta && ev.meta.title) || '';
  let sent = 0;
  const told = new Set();

  for (const ref of extractRefs(ev.text)) {
    const ids = index.get(ref) || [];
    if (ids.length !== 1) continue;
    const task = byId.get(String(ids[0]));
    if (!task) continue;
    for (const user of [task.assignee, task.reporter]) {
      if (!user) continue;
      const once = `${task._id}:${user}`;
      if (told.has(once)) continue;
      told.add(once);
      const made = await notify({
        user,
        actor: authorId,
        type: ev.type,
        message: `Pull request ${number ? `#${number} ` : ''}${title ? `"${title}" ` : ''}was ${VERB[ev.type]} for "${task.title}"`,
        link: { workspace: project.workspace, project: project._id, task: task._id },
      });
      if (made) sent += 1;
    }
  }
  return sent;
}

module.exports = { notifyPullRequest };
