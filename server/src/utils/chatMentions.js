const Workspace = require('../models/Workspace');
const User = require('../models/User');
const { notify } = require('./notify');
const { extractMentionHandles, resolveMentions } = require('./mentions');

const MAX_MENTIONS = 10; // per message

// FR28: "@raj" in a chat message tells Raj. The same matching as @mentions in task comments: a first name, the full
// name without spaces, or the start of an email address; an ambiguous handle is skipped rather than guessed.
// Only people in the workspace can be mentioned, nobody is told about their own message, and the person's
// "mentions" switch in Settings is honoured by notify(). Returns the ids of the people told.
async function notifyChatMentions({ text, channel, actorId, actorName }) {
  const handles = [...new Set(extractMentionHandles(text).map((h) => h.replace(/\.+$/, '')).filter(Boolean))].slice(0, MAX_MENTIONS);
  if (!handles.length) return [];

  const workspace = await Workspace.findById(channel.workspace).select('members');
  if (!workspace) return [];
  const candidates = await User.find({ _id: { $in: workspace.members.map((m) => m.user) } }).select('name email');

  const told = [];
  for (const user of resolveMentions(handles, candidates)) {
    const made = await notify({
      user: user._id,
      actor: actorId,
      type: 'mention',
      message: `${actorName || 'Someone'} mentioned you in #${channel.name}`,
      link: { workspace: channel.workspace, channel: channel._id },
    });
    if (made) told.push(user._id);
  }
  return told;
}

module.exports = { notifyChatMentions, MAX_MENTIONS };
