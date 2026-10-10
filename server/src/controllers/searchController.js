const Workspace = require('../models/Workspace');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Comment = require('../models/Comment');
const FileAsset = require('../models/FileAsset');
const User = require('../models/User');

const LIMIT = 10;

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function search(req, res) {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) {
      return res.status(400).json({ success: false, message: 'Search text must be at least 2 characters' });
    }
    if (q.length > 100) {
      return res.status(400).json({ success: false, message: 'Search text is too long (max 100 characters)' });
    }

    const rx = new RegExp(escapeRegex(q), 'i');

    // Only search inside workspaces this user belongs to
    let workspaces = await Workspace.find({ 'members.user': req.user.id })
      .select('members')
      .lean();

    // Optional: narrow to one workspace (?workspace=ID)
    if (req.query.workspace) {
      workspaces = workspaces.filter((w) => w._id.toString() === req.query.workspace);
      if (workspaces.length === 0) {
        return res.status(404).json({ success: false, message: 'Workspace not found' });
      }
    }

    const workspaceIds = workspaces.map((w) => w._id);
    const memberIds = new Set();
    workspaces.forEach((w) => w.members.forEach((m) => memberIds.add(String(m.user))));

    // Only active (non-archived) projects that still exist, and tasks inside them.
    // This keeps orphaned tasks from deleted or archived projects out of the results.
    const projectIdsInScope = await Project.find({
      workspace: { $in: workspaceIds },
      isArchived: false,
    }).distinct('_id');

    const taskIdsInScope = await Task.find({
      project: { $in: projectIdsInScope },
    }).distinct('_id');

    const [projects, tasks, comments, files, users] = await Promise.all([
      Project.find({
        workspace: { $in: workspaceIds },
        isArchived: false,
        $or: [{ name: rx }, { description: rx }],
      })
        .select('name description workspace')
        .limit(LIMIT)
        .lean(),

      Task.find({
        project: { $in: projectIdsInScope },
        isArchived: false,
        $or: [{ title: rx }, { description: rx }, { labels: rx }],
      })
        .select('title status priority project workspace')
        .limit(LIMIT)
        .lean(),

      Comment.find({ task: { $in: taskIdsInScope }, text: rx })
        .select('text task author')
        .limit(LIMIT)
        .lean(),

      FileAsset.find({
        originalName: rx,
        $or: [{ project: { $in: projectIdsInScope } }, { task: { $in: taskIdsInScope } }],
      })
        .select('originalName url mimetype project task')
        .limit(LIMIT)
        .lean(),

      User.find({
        _id: { $in: [...memberIds] },
        $or: [{ name: rx }, { email: rx }],
      })
        .select('name email')
        .limit(LIMIT)
        .lean(),
    ]);

    // Add the task title to each matching comment
    const commentTaskIds = comments.map((c) => c.task);
    const commentTasks = await Task.find({ _id: { $in: commentTaskIds } }).select('title').lean();
    const taskTitles = {};
    commentTasks.forEach((t) => {
      taskTitles[t._id.toString()] = t.title;
    });

    const commentResults = comments.map((c) => ({
      _id: c._id,
      text: c.text.length > 200 ? c.text.slice(0, 200) + '...' : c.text,
      task: c.task,
      taskTitle: taskTitles[c.task.toString()] || null,
    }));

    res.json({
      success: true,
      query: q,
      counts: {
        projects: projects.length,
        tasks: tasks.length,
        comments: commentResults.length,
        files: files.length,
        users: users.length,
      },
      results: {
        projects,
        tasks,
        comments: commentResults,
        files,
        users,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Search failed', error: error.message });
  }
}

module.exports = { search };