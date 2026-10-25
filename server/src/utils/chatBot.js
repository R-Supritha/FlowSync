const mongoose = require('mongoose');
const Message = require('../models/Message');

// FR30: FlowSync posts into a project's chat channel when something happens in that project
// (a task is Done, a sprint starts, a stand-up is ready). It is fire-and-forget: a problem here must never
// stop the action that triggered it, so this function never throws. CHAT_BOT=false switches it off.
const MAX_TEXT = 4000;

async function postBotMessage({ workspace, project, actor, text, kind, dedupeHours }) {
  try {
    if (String(process.env.CHAT_BOT || '').trim().toLowerCase() === 'false') return null;
    if (mongoose.connection.readyState !== 1) return null; // no database connection: nothing could be written anyway
    const body = String(text || '').trim().slice(0, MAX_TEXT);
    if (!body || !workspace || !project) return null;

    // loaded here, not at the top: this file is required from many places, the chat controller from few
    const { ensureChannels, presentMessage } = require('../controllers/chatController');
    const { publish } = require('./chatBus');

    const channels = await ensureChannels(workspace, actor);
    const channel = channels.find((c) => c.kind === 'project' && c.project && String(c.project) === String(project));
    if (!channel) return null; // for example the project is archived: its channel is hidden

    if (kind && dedupeHours) {
      const since = new Date(Date.now() - dedupeHours * 60 * 60 * 1000);
      const recent = await Message.findOne({ channel: channel._id, bot: true, botKind: kind, createdAt: { $gt: since } }).select('_id').lean();
      if (recent) return null;
    }

    const created = await Message.create({ channel: channel._id, workspace, bot: true, botKind: kind || 'info', text: body });
    const out = presentMessage(created.toObject ? created.toObject() : created);
    publish(String(workspace), { type: 'message', message: out });
    return out;
  } catch (error) {
    console.error('Chat bot post failed:', error.message);
    return null;
  }
}

module.exports = { postBotMessage };
