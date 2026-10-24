const mongoose = require('mongoose');
const User = require('../models/User');
const Workspace = require('../models/Workspace');
const Project = require('../models/Project');

const PUBLIC_FIELDS = 'name email bio skills avatarUrl githubUsername createdAt';

// .lean() skips schema defaults, so fill them in for users created before these fields existed
function withDefaults(user) {
  return {
    ...user,
    bio: user.bio || '',
    skills: user.skills || [],
    avatarUrl: user.avatarUrl || '',
    githubUsername: user.githubUsername || '',
  };
}

async function buildProfile(user, workspaceFilter) {
  const workspaces = await Workspace.find(workspaceFilter).select('name members').lean();
  const workspaceIds = workspaces.map((w) => w._id);

  const projects = await Project.find({
    workspace: { $in: workspaceIds },
    isArchived: false,
  })
    .select('name workspace deadline')
    .sort({ updatedAt: -1 })
    .lean();

  return {
    user: withDefaults(user),
    workspaces: workspaces.map((w) => {
      const member = w.members.find((m) => String(m.user) === String(user._id));
      return { _id: w._id, name: w.name, role: member ? member.role : null };
    }),
    projects,
  };
}

async function getMyProfile(req, res) {
  try {
    const user = await User.findById(req.user.id).select(`${PUBLIC_FIELDS} emailVerified`).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }
    const profile = await buildProfile(user, { 'members.user': req.user.id });
    res.json({ success: true, ...profile, emailVerified: user.emailVerified !== false });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load profile', error: error.message });
  }
}

async function updateMyProfile(req, res) {
  try {
    const body = req.body || {};
    const updates = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length < 1 || body.name.trim().length > 80) {
        return res.status(400).json({ success: false, message: 'name must be 1 to 80 characters' });
      }
      updates.name = body.name.trim();
    }

    if (body.bio !== undefined) {
      if (typeof body.bio !== 'string' || body.bio.length > 500) {
        return res.status(400).json({ success: false, message: 'bio must be text of at most 500 characters' });
      }
      updates.bio = body.bio.trim();
    }

    if (body.skills !== undefined) {
      if (
        !Array.isArray(body.skills) ||
        body.skills.length > 20 ||
        body.skills.some((s) => typeof s !== 'string' || s.trim().length < 1 || s.trim().length > 30)
      ) {
        return res.status(400).json({
          success: false,
          message: 'skills must be a list of at most 20 items, each 1 to 30 characters',
        });
      }
      updates.skills = [...new Set(body.skills.map((s) => s.trim()))];
    }

    if (body.avatarUrl !== undefined) {
      const url = typeof body.avatarUrl === 'string' ? body.avatarUrl.trim() : null;
      if (url === null || url.length > 500 || (url !== '' && !/^https?:\/\//i.test(url))) {
        return res.status(400).json({
          success: false,
          message: 'avatarUrl must be empty or a link starting with http:// or https://',
        });
      }
      updates.avatarUrl = url;
    }

    if (body.githubUsername !== undefined) {
      const gh = typeof body.githubUsername === 'string' ? body.githubUsername.trim() : null;
      if (gh === null || (gh !== '' && !/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37})$/.test(gh))) {
        return res.status(400).json({ success: false, message: 'githubUsername is not a valid GitHub username' });
      }
      updates.githubUsername = gh;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields to update' });
    }

    const user = await User.findByIdAndUpdate(req.user.id, updates, {
      new: true,
      runValidators: true,
    })
      .select(PUBLIC_FIELDS)
      .lean();

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.json({ success: true, user: withDefaults(user) });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to update profile', error: error.message });
  }
}

async function getUserProfile(req, res) {
  try {
    const targetId = req.params.id;
    if (!mongoose.isValidObjectId(targetId)) {
      return res.status(400).json({ success: false, message: 'Invalid id' });
    }

    if (targetId === req.user.id) {
      return getMyProfile(req, res);
    }

    // Only workspaces both people belong to
    const sharedFilter = {
      $and: [{ 'members.user': req.user.id }, { 'members.user': targetId }],
    };
    const sharedCount = await Workspace.countDocuments(sharedFilter);
    if (sharedCount === 0) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const user = await User.findById(targetId).select(PUBLIC_FIELDS).lean();
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const profile = await buildProfile(user, sharedFilter);
    res.json({ success: true, ...profile });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to load profile', error: error.message });
  }
}

module.exports = { getMyProfile, updateMyProfile, getUserProfile };