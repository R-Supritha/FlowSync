const Workspace = require('../models/Workspace');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Notification = require('../models/Notification');

const DAY = 24 * 60 * 60 * 1000;

async function getDashboard(req, res) {
  try {
    const userId = req.user.id;
    const now = new Date();
    const weekAhead = new Date(now.getTime() + 7 * DAY);

    // Workspaces the user belongs to
    const workspaces = await Workspace.find({ 'members.user': userId })
      .select('name description')
      .lean();
    const workspaceIds = workspaces.map((w) => w._id);

    // Active projects in those workspaces
    const projects = await Project.find({
      workspace: { $in: workspaceIds },
      isArchived: false,
    })
      .select('name workspace deadline milestones updatedAt')
      .sort({ updatedAt: -1 })
      .lean();

    const projectIds = projects.map((p) => p._id);
    const projectNames = {};
    projects.forEach((p) => {
      projectNames[p._id.toString()] = p.name;
    });

    // Open tasks assigned to this user, in active projects
    const openFilter = {
      assignee: userId,
      isArchived: false,
      project: { $in: projectIds },
      status: { $ne: 'Done' },
    };

    const taskFields = 'title priority status deadline project';

    const [openTasks, openCount, overdueCount, dueSoonTasks, unread] = await Promise.all([
      Task.find(openFilter).select(taskFields).limit(50).lean(),
      Task.countDocuments(openFilter),
      Task.countDocuments({ ...openFilter, deadline: { $lt: now } }),
      Task.find({ ...openFilter, deadline: { $gte: now, $lte: weekAhead } })
        .sort({ deadline: 1 })
        .limit(10)
        .select(taskFields)
        .lean(),
      Notification.countDocuments({ user: userId, isRead: false }),
    ]);

    const withProjectName = (t) => ({
      ...t,
      projectName: projectNames[t.project.toString()] || null,
    });

    // Tasks with a deadline first (soonest first), then the ones without
    const myTasks = openTasks
      .sort((a, b) => {
        if (a.deadline && b.deadline) return a.deadline - b.deadline;
        if (a.deadline) return -1;
        if (b.deadline) return 1;
        return 0;
      })
      .slice(0, 10)
      .map(withProjectName);

    // Upcoming, not-yet-completed milestones across all projects
    const upcomingMilestones = [];
    projects.forEach((p) => {
      (p.milestones || []).forEach((m) => {
        if (!m.completed && m.targetDate >= now) {
          upcomingMilestones.push({
            _id: m._id,
            title: m.title,
            targetDate: m.targetDate,
            project: p._id,
            projectName: p.name,
          });
        }
      });
    });
    upcomingMilestones.sort((a, b) => a.targetDate - b.targetDate);

    const recentProjects = projects.slice(0, 5).map((p) => ({
      _id: p._id,
      name: p.name,
      workspace: p.workspace,
      deadline: p.deadline,
    }));

    res.json({
      success: true,
      summary: {
        workspaces: workspaces.length,
        projects: projects.length,
        openTasks: openCount,
        overdueTasks: overdueCount,
        dueSoonTasks: dueSoonTasks.length,
        unreadNotifications: unread,
      },
      myTasks,
      upcomingDeadlines: dueSoonTasks.map(withProjectName),
      upcomingMilestones: upcomingMilestones.slice(0, 5),
      recentProjects,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load dashboard', error: error.message });
  }
}

module.exports = { getDashboard };