const mongoose = require('mongoose');
const Comment = require('../models/Comment');
const Task = require('../models/Task');
const Workspace = require('../models/Workspace');
const User = require('../models/User');
const { canWrite, isManagerRole, getWorkspaceRole, serverError } = require('../utils/access');
const { extractMentionHandles, resolveMentions } = require('../utils/mentions');
const { notify } = require('../utils/notify');
const { logActivity } = require('../utils/activity');

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
  return null;
}

async function loadTaskContext(taskId, userId, res) {
  const task = await Task.findById(taskId);
  if (!task) return fail(res, 404, 'Task not found');
  const role = await getWorkspaceRole(task.workspace, userId);
  if (!role) return fail(res, 404, 'Task not found');
  return { task, role };
}

async function loadComment(req, res) {
  const comment = await Comment.findById(req.params.id);
  if (!comment) return fail(res, 404, 'Comment not found');
  const loaded = await loadTaskContext(comment.task, req.user.id, res);
  if (!loaded) return null;
  return { comment, task: loaded.task, role: loaded.role };
}

async function notifyMentions(text, workspaceId, actorId, task) {
  const handles = extractMentionHandles(text);
  if (!handles.length) return [];

  const workspace = await Workspace.findById(workspaceId).select('members');
  const memberIds = workspace.members.map((m) => m.user);
  const candidates = await User.find({ _id: { $in: memberIds } }).select('name email');

  const resolved = resolveMentions(handles, candidates);
  for (const user of resolved) {
    await notify({
      user: user._id,
      actor: actorId,
      type: 'mention',
      message: `You were mentioned in a comment on "${task.title}"`,
      link: { workspace: workspaceId, project: task.project, task: task._id },
    });
  }
  return resolved.map((u) => u._id);
}

// Recursively collects a comment and every descendant reply.
async function collectThread(commentId) {
  const ids = [commentId];
  const children = await Comment.find({ parentComment: commentId }).select('_id');
  for (const child of children) {
    ids.push(...(await collectThread(child._id)));
  }
  return ids;
}

async function createComment(req, res) {
  try {
    const loaded = await loadTaskContext(req.params.taskId, req.user.id, res);
    if (!loaded) return;
    const { task, role } = loaded;

    if (!canWrite(role)) return fail(res, 403, 'Viewers have read-only access');
    if (!req.body.text || !String(req.body.text).trim()) return fail(res, 400, 'Comment text is required');

    let parentComment = null;
    if (req.body.parentComment) {
      if (!mongoose.isValidObjectId(req.body.parentComment)) return fail(res, 400, 'Invalid parentComment id');
      const parent = await Comment.findOne({ _id: req.body.parentComment, task: task._id });
      if (!parent) return fail(res, 400, 'Parent comment not found on this task');
      parentComment = parent._id;
    }

    let attachments = [];
    if (req.body.attachments !== undefined) {
      if (!Array.isArray(req.body.attachments)) return fail(res, 400, 'attachments must be an array');
      attachments = req.body.attachments.map((a) => ({ name: a && a.name, url: a && a.url }));
    }

    const mentions = await notifyMentions(req.body.text, task.workspace, req.user.id, task);

    const comment = await Comment.create({
      task: task._id,
      author: req.user.id,
      parentComment,
      text: req.body.text,
      attachments,
      mentions,
    });

    if (parentComment) {
      const parent = await Comment.findById(parentComment);
      await notify({
        user: parent.author,
        actor: req.user.id,
        type: 'comment_reply',
        message: `Someone replied to your comment on "${task.title}"`,
        link: { workspace: task.workspace, project: task.project, task: task._id, comment: comment._id },
      });
    } else if (String(task.reporter) !== String(req.user.id)) {
      await notify({
        user: task.reporter,
        actor: req.user.id,
        type: 'comment_reply',
        message: `New comment on "${task.title}"`,
        link: { workspace: task.workspace, project: task.project, task: task._id, comment: comment._id },
      });
    }

    await logActivity({
      workspace: task.workspace,
      project: task.project,
      actor: req.user.id,
      type: 'comment_added',
      message: `${parentComment ? 'replied to a comment' : 'commented'} on "${task.title}"`,
      task,
    });

    await comment.populate('author', 'name email');
    res.status(201).json({ success: true, comment });
  } catch (error) {
    serverError(res, 'Failed to create comment', error);
  }
}

async function listComments(req, res) {
  try {
    const loaded = await loadTaskContext(req.params.taskId, req.user.id, res);
    if (!loaded) return;

    const comments = await Comment.find({ task: req.params.taskId })
      .populate('author', 'name email')
      .sort({ createdAt: 1 });

    // Threaded as a flat, ordered list (each item carries parentComment); the client builds the tree.
    res.json({ success: true, comments });
  } catch (error) {
    serverError(res, 'Failed to fetch comments', error);
  }
}

async function updateComment(req, res) {
  try {
    const loaded = await loadComment(req, res);
    if (!loaded) return;
    const { comment } = loaded;

    if (String(comment.author) !== String(req.user.id)) {
      return fail(res, 403, 'Only the author can edit this comment');
    }
    if (!req.body.text || !String(req.body.text).trim()) return fail(res, 400, 'Comment text is required');

    comment.text = req.body.text;
    comment.editedAt = new Date();
    await comment.save();

    res.json({ success: true, comment });
  } catch (error) {
    serverError(res, 'Failed to update comment', error);
  }
}

async function deleteComment(req, res) {
  try {
    const loaded = await loadComment(req, res);
    if (!loaded) return;
    const { comment, role } = loaded;

    const isAuthor = String(comment.author) === String(req.user.id);
    if (!isAuthor && !isManagerRole(role)) {
      return fail(res, 403, 'Only the author, Admin, or Manager can delete this comment');
    }

    // Replies are part of this comment's thread, so they go with it.
    const threadIds = await collectThread(comment._id);
    await Comment.deleteMany({ _id: { $in: threadIds } });

    res.json({ success: true, message: 'Comment deleted', deletedCount: threadIds.length });
  } catch (error) {
    serverError(res, 'Failed to delete comment', error);
  }
}

async function toggleReaction(req, res) {
  try {
    const loaded = await loadComment(req, res);
    if (!loaded) return;
    const { comment } = loaded;

    const { emoji } = req.body;
    if (!emoji || !String(emoji).trim()) return fail(res, 400, 'emoji is required');

    if (!comment.reactions.find((r) => r.emoji === emoji)) {
      comment.reactions.push({ emoji, users: [] });
    }
    // Mongoose casts the pushed object into a subdocument, so re-fetch the live
    // reference rather than keep mutating the plain object we pushed.
    const entry = comment.reactions.find((r) => r.emoji === emoji);

    const uid = String(req.user.id);
    const already = entry.users.some((u) => String(u) === uid);
    if (already) {
      entry.users = entry.users.filter((u) => String(u) !== uid);
    } else {
      entry.users.push(req.user.id);
    }
    comment.reactions = comment.reactions.filter((r) => r.users.length > 0);

    await comment.save();
    res.json({ success: true, comment, reacted: !already });
  } catch (error) {
    serverError(res, 'Failed to update reaction', error);
  }
}

module.exports = { createComment, listComments, updateComment, deleteComment, toggleReaction };
