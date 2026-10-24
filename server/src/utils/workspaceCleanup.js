const fs = require('fs');
const path = require('path');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Comment = require('../models/Comment');
const FileAsset = require('../models/FileAsset');
const Team = require('../models/Team');
const TeamProject = require('../models/TeamProject');
const GithubLink = require('../models/GithubLink');
const GithubEvent = require('../models/GithubEvent');
const ActivityLog = require('../models/ActivityLog');
const Notification = require('../models/Notification');
const Presence = require('../models/Presence');
const Channel = require('../models/Channel');
const Message = require('../models/Message');
const ChannelRead = require('../models/ChannelRead');
const { UPLOAD_DIR } = require('../config/upload');

const idsOf = (rows) => rows.map((r) => r._id);
const count = (result) => (result && result.deletedCount) || 0;

// Deletes everything that belongs to one workspace: projects, tasks, comments, files (records and the
// uploaded files on disk), teams, GitHub links and events, activity, notifications and chat.
// Every query is limited to this workspace's own ids, so other workspaces are never touched.
// Returns how many records of each kind were removed. The workspace record itself is removed by the caller.
async function deleteWorkspaceData(workspaceId) {
  const [projects, tasks, teams, channels, files] = await Promise.all([
    Project.find({ workspace: workspaceId }).select('_id').lean(),
    Task.find({ workspace: workspaceId }).select('_id').lean(),
    Team.find({ workspace: workspaceId }).select('_id').lean(),
    Channel.find({ workspace: workspaceId }).select('_id').lean(),
    FileAsset.find({ workspace: workspaceId }).select('storedName').lean(),
  ]);
  const projectIds = idsOf(projects);
  const taskIds = idsOf(tasks);
  const teamIds = idsOf(teams);
  const channelIds = idsOf(channels);

  for (const f of files) {
    if (f.storedName) fs.unlink(path.join(UPLOAD_DIR, f.storedName), () => {}); // best effort
  }

  const deleted = {};
  deleted.comments = count(await Comment.deleteMany({ task: { $in: taskIds } }));
  deleted.files = count(await FileAsset.deleteMany({ workspace: workspaceId }));
  await Presence.updateMany({ workingOn: { $in: taskIds } }, { $set: { workingOn: null } });
  deleted.tasks = count(await Task.deleteMany({ workspace: workspaceId }));
  await TeamProject.deleteMany({ $or: [{ project: { $in: projectIds } }, { team: { $in: teamIds } }] });
  deleted.teams = count(await Team.deleteMany({ workspace: workspaceId }));
  await GithubEvent.deleteMany({ project: { $in: projectIds } });
  await GithubLink.deleteMany({ workspace: workspaceId });
  deleted.activity = count(await ActivityLog.deleteMany({ workspace: workspaceId }));
  await Notification.deleteMany({ workspace: workspaceId });
  deleted.messages = count(await Message.deleteMany({ workspace: workspaceId }));
  await ChannelRead.deleteMany({ channel: { $in: channelIds } });
  deleted.channels = count(await Channel.deleteMany({ workspace: workspaceId }));
  deleted.projects = count(await Project.deleteMany({ workspace: workspaceId }));
  return deleted;
}

module.exports = { deleteWorkspaceData };
