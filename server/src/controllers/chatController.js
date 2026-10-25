// FR26 (channels) and FR27 (live messaging).
const mongoose = require('mongoose');
const Channel = require('../models/Channel');
const Message = require('../models/Message');
const ChannelRead = require('../models/ChannelRead');
const Project = require('../models/Project');
const { isManagerRole, canWrite, getWorkspaceRole, serverError } = require('../utils/access');
const { publish, subscribe } = require('../utils/chatBus');

const MAX_TEXT = 4000;
const PAGE = 50;
const MAX_PAGE = 100;
const PING_MS = 25000;
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
  return null;
}

// "Library Management System" -> "library-management-system"
function slugify(text) {
  const slug = String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '');
  return slug || 'project';
}

// Returns { value } or { error } for a channel name typed by a person.
function parseChannelName(raw) {
  const name = String(raw || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/^#/, '');
  if (!NAME_RE.test(name)) {
    return { error: 'Channel names use lowercase letters, numbers and dashes, start with a letter or number, and are at most 40 characters' };
  }
  return { value: name };
}

// Returns { value } or { error } for message text.
function parseText(raw) {
  if (typeof raw !== 'string') return { error: 'text is required' };
  const text = raw.trim();
  if (!text) return { error: 'A message cannot be empty' };
  if (text.length > MAX_TEXT) return { error: `A message can have at most ${MAX_TEXT} characters` };
  return { value: text };
}

const REACTIONS = ['👍', '❤️', '🎉', '👀'];

const presentMessage = (m) => ({
  _id: String(m._id),
  channel: String(m.channel),
  ...(m.bot ? { bot: true } : {}),
  author: m.bot
    ? { _id: 'flowsync-bot', name: 'FlowSync' }
    : m.author && m.author._id
    ? { _id: String(m.author._id), name: m.author.name, ...(m.author.avatarUrl ? { avatarUrl: m.author.avatarUrl } : {}) }
    : { _id: String(m.author), name: 'Someone' },
  text: m.deletedAt ? '' : m.text,
  deleted: Boolean(m.deletedAt),
  editedAt: m.editedAt || null,
  reactions: m.deletedAt ? [] : (m.reactions || []).filter((r) => r.users && r.users.length).map((r) => ({ emoji: r.emoji, users: r.users.map(String) })),
  createdAt: m.createdAt,
});

const presentChannel = (c, extra = {}) => ({
  _id: String(c._id),
  name: c.name,
  description: c.description || '',
  kind: c.kind,
  project: c.project ? String(c.project) : null,
  ...extra,
});

async function workspaceRole(req, res, workspaceId) {
  const role = await getWorkspaceRole(workspaceId, req.user.id);
  if (!role) return fail(res, 404, 'Workspace not found');
  return role;
}

async function loadChannel(req, res) {
  const channel = await Channel.findById(req.params.id);
  if (!channel) return fail(res, 404, 'Channel not found');
  const role = await getWorkspaceRole(channel.workspace, req.user.id);
  if (!role) return fail(res, 404, 'Channel not found');
  return { channel, role };
}

// Makes sure #general and one channel per active project exist, then returns the visible channels.
async function ensureChannels(workspaceId, userId) {
  const existing = await Channel.find({ workspace: workspaceId });
  const have = new Set(existing.map((c) => c.name));

  if (!existing.some((c) => c.kind === 'general')) {
    try {
      const made = await Channel.create({ workspace: workspaceId, name: 'general', description: 'Everyone in the workspace', kind: 'general', createdBy: userId });
      existing.push(made);
      have.add('general');
    } catch (error) {
      if (!(error && error.code === 11000)) throw error;
      existing.splice(0, existing.length, ...(await Channel.find({ workspace: workspaceId })));
    }
  }

  const projects = await Project.find({ workspace: workspaceId, isArchived: false }).select('name').lean();
  const withChannel = new Set(existing.filter((c) => c.kind === 'project' && c.project).map((c) => String(c.project)));
  for (const p of projects) {
    if (withChannel.has(String(p._id))) continue;
    const base = slugify(p.name);
    let name = base;
    for (let i = 2; have.has(name); i += 1) name = `${base.slice(0, 36)}-${i}`;
    try {
      const made = await Channel.create({ workspace: workspaceId, name, description: `Chat for ${p.name}`, kind: 'project', project: p._id, createdBy: userId });
      existing.push(made);
      have.add(name);
    } catch (error) {
      if (!(error && error.code === 11000)) throw error;
    }
  }

  const activeProjects = new Set(projects.map((p) => String(p._id)));
  const order = { general: 0, project: 1, custom: 2 };
  return existing
    .filter((c) => !c.isArchived && (c.kind !== 'project' || activeProjects.has(String(c.project))))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.name.localeCompare(b.name));
}

// GET /workspaces/:workspaceId/channels
async function listChannels(req, res) {
  try {
    const workspaceId = req.params.workspaceId;
    const role = await workspaceRole(req, res, workspaceId);
    if (!role) return;

    const channels = await ensureChannels(workspaceId, req.user.id);
    const ids = channels.map((c) => c._id);
    const reads = await ChannelRead.find({ user: req.user.id, channel: { $in: ids } }).lean();
    const readAt = new Map(reads.map((r) => [String(r.channel), r.lastReadAt]));
    const now = new Date();

    const rows = await Promise.all(channels.map(async (c) => {
      let since = readAt.get(String(c._id));
      if (!since) {
        // First time this person sees the channel: start with nothing unread.
        since = now;
        try { await ChannelRead.create({ user: req.user.id, channel: c._id, lastReadAt: now }); } catch (error) { if (!(error && error.code === 11000)) throw error; }
      }
      const [unread, last] = await Promise.all([
        Message.countDocuments({ channel: c._id, createdAt: { $gt: since }, author: { $ne: req.user.id }, deletedAt: null }),
        Message.findOne({ channel: c._id, deletedAt: null }).sort({ _id: -1 }).populate('author', 'name avatarUrl').lean(),
      ]);
      return presentChannel(c, {
        unread,
        lastMessage: last ? { text: String(last.text).slice(0, 80), createdAt: last.createdAt, author: last.author && last.author.name } : null,
      });
    }));

    return res.json({ success: true, channels: rows, canPost: canWrite(role), canManage: isManagerRole(role) });
  } catch (error) {
    return serverError(res, 'Failed to load channels', error);
  }
}

// POST /workspaces/:workspaceId/channels   body: { name, description? }   (Admin or Manager)
async function createChannel(req, res) {
  try {
    const workspaceId = req.params.workspaceId;
    const role = await workspaceRole(req, res, workspaceId);
    if (!role) return;
    if (!isManagerRole(role)) return fail(res, 403, 'Only Admin or Manager can create channels');

    const parsed = parseChannelName(req.body && req.body.name);
    if (parsed.error) return fail(res, 400, parsed.error);
    const description = String((req.body && req.body.description) || '').trim().slice(0, 200);

    await ensureChannels(workspaceId, req.user.id); // so "general" can never be taken by a custom channel
    let channel;
    try {
      channel = await Channel.create({ workspace: workspaceId, name: parsed.value, description, kind: 'custom', createdBy: req.user.id });
    } catch (error) {
      if (error && error.code === 11000) return fail(res, 409, 'A channel with that name already exists');
      throw error;
    }
    publish(workspaceId, { type: 'channel', channel: presentChannel(channel) });
    return res.status(201).json({ success: true, channel: presentChannel(channel, { unread: 0, lastMessage: null }) });
  } catch (error) {
    return serverError(res, 'Failed to create the channel', error);
  }
}

// PATCH /channels/:id   body: { name?, description?, archived? }   (Admin or Manager, custom channels only)
async function updateChannel(req, res) {
  try {
    const loaded = await loadChannel(req, res);
    if (!loaded) return;
    const { channel, role } = loaded;
    if (!isManagerRole(role)) return fail(res, 403, 'Only Admin or Manager can change channels');
    if (channel.kind !== 'custom') return fail(res, 400, 'This channel is managed by FlowSync and cannot be changed');

    const body = req.body || {};
    if (body.name !== undefined) {
      const parsed = parseChannelName(body.name);
      if (parsed.error) return fail(res, 400, parsed.error);
      channel.name = parsed.value;
    }
    if (body.description !== undefined) channel.description = String(body.description).trim().slice(0, 200);
    if (body.archived !== undefined) channel.isArchived = Boolean(body.archived);

    try {
      await channel.save();
    } catch (error) {
      if (error && error.code === 11000) return fail(res, 409, 'A channel with that name already exists');
      throw error;
    }
    publish(String(channel.workspace), { type: 'channel', channel: presentChannel(channel) });
    return res.json({ success: true, channel: presentChannel(channel), archived: channel.isArchived });
  } catch (error) {
    return serverError(res, 'Failed to update the channel', error);
  }
}

// DELETE /channels/:id/messages   (Admin or Manager)  "Clear chat": removes every message in the channel.
async function clearChannel(req, res) {
  try {
    const loaded = await loadChannel(req, res);
    if (!loaded) return;
    const { channel, role } = loaded;
    if (!isManagerRole(role)) return fail(res, 403, 'Only Admin or Manager can clear a channel');

    const result = await Message.deleteMany({ channel: channel._id });
    publish(String(channel.workspace), { type: 'channel_cleared', channel: String(channel._id) });
    return res.json({ success: true, deleted: (result && result.deletedCount) || 0 });
  } catch (error) {
    return serverError(res, 'Failed to clear the channel', error);
  }
}

// DELETE /channels/:id   (Admin or Manager, custom channels only)
// #general and project channels are made by FlowSync (a deleted project channel would just come back),
// so those can be cleared but not deleted.
async function deleteChannel(req, res) {
  try {
    const loaded = await loadChannel(req, res);
    if (!loaded) return;
    const { channel, role } = loaded;
    if (!isManagerRole(role)) return fail(res, 403, 'Only Admin or Manager can delete channels');
    if (channel.kind !== 'custom') {
      return fail(res, 400, 'This channel is managed by FlowSync and cannot be deleted. You can clear its messages instead.');
    }

    await Message.deleteMany({ channel: channel._id });
    await ChannelRead.deleteMany({ channel: channel._id });
    await channel.deleteOne();
    publish(String(channel.workspace), { type: 'channel_deleted', id: String(channel._id) });
    return res.json({ success: true });
  } catch (error) {
    return serverError(res, 'Failed to delete the channel', error);
  }
}

// GET /channels/:id/messages?before=<id>&limit=50   (older page)  or  ?after=<id>  (newer than a message)
async function listMessages(req, res) {
  try {
    const loaded = await loadChannel(req, res);
    if (!loaded) return;
    const { channel } = loaded;

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || PAGE, 1), MAX_PAGE);
    const { before, after } = req.query;
    if ((before && !mongoose.isValidObjectId(before)) || (after && !mongoose.isValidObjectId(after))) {
      return fail(res, 400, 'before / after must be a message id');
    }

    if (after) {
      const rows = await Message.find({ channel: channel._id, _id: { $gt: after } }).sort({ _id: 1 }).limit(limit).populate('author', 'name avatarUrl').lean();
      return res.json({ success: true, messages: rows.map(presentMessage), hasMore: rows.length === limit });
    }

    const query = { channel: channel._id };
    if (before) query._id = { $lt: before };
    const rows = await Message.find(query).sort({ _id: -1 }).limit(limit).populate('author', 'name avatarUrl').lean();
    return res.json({ success: true, messages: rows.reverse().map(presentMessage), hasMore: rows.length === limit });
  } catch (error) {
    return serverError(res, 'Failed to load messages', error);
  }
}

async function touchRead(userId, channelId) {
  await ChannelRead.updateOne({ user: userId, channel: channelId }, { $set: { lastReadAt: new Date() } }, { upsert: true });
}

// POST /channels/:id/messages   body: { text }
async function sendMessage(req, res) {
  try {
    const loaded = await loadChannel(req, res);
    if (!loaded) return;
    const { channel, role } = loaded;
    if (!canWrite(role)) return fail(res, 403, 'Viewers can read messages but not post');
    if (channel.isArchived) return fail(res, 400, 'This channel is archived');

    const parsed = parseText(req.body && req.body.text);
    if (parsed.error) return fail(res, 400, parsed.error);

    const created = await Message.create({ channel: channel._id, workspace: channel.workspace, author: req.user.id, text: parsed.value });
    const out = presentMessage(await Message.findById(created._id).populate('author', 'name avatarUrl').lean());

    await touchRead(req.user.id, channel._id);
    publish(String(channel.workspace), { type: 'message', message: out });
    return res.status(201).json({ success: true, message: out });
  } catch (error) {
    return serverError(res, 'Failed to send the message', error);
  }
}

async function loadMessage(req, res) {
  const message = await Message.findById(req.params.id);
  if (!message) return fail(res, 404, 'Message not found');
  const role = await getWorkspaceRole(message.workspace, req.user.id);
  if (!role) return fail(res, 404, 'Message not found');
  return { message, role };
}

// PATCH /messages/:id   body: { text }   (the author only)
async function editMessage(req, res) {
  try {
    const loaded = await loadMessage(req, res);
    if (!loaded) return;
    const { message } = loaded;
    if (String(message.author) !== String(req.user.id)) return fail(res, 403, 'You can only edit your own messages');
    if (message.deletedAt) return fail(res, 400, 'This message was deleted');

    const parsed = parseText(req.body && req.body.text);
    if (parsed.error) return fail(res, 400, parsed.error);
    message.text = parsed.value;
    message.editedAt = new Date();
    await message.save();

    const withName = await Message.findById(message._id).populate('author', 'name avatarUrl').lean();
    const out = presentMessage(withName || message);
    publish(String(message.workspace), { type: 'message_edited', message: out });
    return res.json({ success: true, message: out });
  } catch (error) {
    return serverError(res, 'Failed to edit the message', error);
  }
}

// POST /messages/:id/reactions   body: { emoji }   (anyone who can post; a second click takes the reaction back)
async function reactToMessage(req, res) {
  try {
    const loaded = await loadMessage(req, res);
    if (!loaded) return;
    const { message, role } = loaded;
    if (!canWrite(role)) return fail(res, 403, 'Viewers can read messages but not react');
    if (message.deletedAt) return fail(res, 400, 'This message was deleted');

    const emoji = req.body && req.body.emoji;
    if (!REACTIONS.includes(emoji)) return fail(res, 400, `emoji must be one of ${REACTIONS.join(' ')}`);

    if (!message.reactions) message.reactions = [];
    const me = String(req.user.id);
    const entry = message.reactions.find((r) => r.emoji === emoji);
    let reacted;
    if (!entry) {
      message.reactions.push({ emoji, users: [req.user.id] });
      reacted = true;
    } else if (entry.users.some((u) => String(u) === me)) {
      entry.users = entry.users.filter((u) => String(u) !== me);
      reacted = false;
    } else {
      entry.users.push(req.user.id);
      reacted = true;
    }
    message.reactions = message.reactions.filter((r) => r.users.length > 0);
    await message.save();

    const withName = await Message.findById(message._id).populate('author', 'name avatarUrl').lean();
    const out = presentMessage(withName || message);
    publish(String(message.workspace), { type: 'message_reacted', message: out });
    return res.json({ success: true, message: out, reacted });
  } catch (error) {
    return serverError(res, 'Failed to react to the message', error);
  }
}

// DELETE /messages/:id   (the author, or an Admin or Manager)
async function deleteMessage(req, res) {
  try {
    const loaded = await loadMessage(req, res);
    if (!loaded) return;
    const { message, role } = loaded;
    const own = String(message.author) === String(req.user.id);
    if (!own && !isManagerRole(role)) return fail(res, 403, 'You can only delete your own messages');
    if (message.deletedAt) return res.json({ success: true });

    message.deletedAt = new Date();
    message.text = '';
    await message.save();
    publish(String(message.workspace), { type: 'message_deleted', channel: String(message.channel), id: String(message._id) });
    return res.json({ success: true });
  } catch (error) {
    return serverError(res, 'Failed to delete the message', error);
  }
}

// POST /channels/:id/read
async function markRead(req, res) {
  try {
    const loaded = await loadChannel(req, res);
    if (!loaded) return;
    await touchRead(req.user.id, loaded.channel._id);
    return res.json({ success: true });
  } catch (error) {
    return serverError(res, 'Failed to mark the channel as read', error);
  }
}

// GET /workspaces/:workspaceId/chat/stream - Server-Sent Events: new, edited and deleted messages, channel changes.
async function stream(req, res) {
  try {
    const workspaceId = req.params.workspaceId;
    const role = await workspaceRole(req, res, workspaceId);
    if (!role) return;

    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 5000\n\n');
    res.write(`event: ready\ndata: ${JSON.stringify({ workspace: String(workspaceId) })}\n\n`);

    const unsubscribe = subscribe(String(workspaceId), (event) => {
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const timer = setInterval(() => res.write(': ping\n\n'), PING_MS);
    req.on('close', () => {
      clearInterval(timer);
      unsubscribe();
    });
  } catch (error) {
    if (res.headersSent) res.end();
    else serverError(res, 'Failed to open the chat stream', error);
  }
}

module.exports = {
  listChannels, createChannel, updateChannel, clearChannel, deleteChannel, listMessages, sendMessage, editMessage, deleteMessage, reactToMessage, markRead, stream, ensureChannels, presentMessage, REACTIONS,
  slugify, parseChannelName, parseText, MAX_TEXT,
};
