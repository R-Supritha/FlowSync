const mongoose = require('mongoose');

// One chat message (FR27). Deleting only blanks the text and sets deletedAt, so the history keeps its shape.
const messageSchema = new mongoose.Schema(
  {
    channel: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    // A message written by FlowSync itself (FR30) has no human author.
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: function () { return !this.bot; } },
    bot: { type: Boolean, default: false },
    botKind: { type: String }, // 'task_done', 'sprint' or 'standup'
    text: { type: String, default: '', maxlength: 4000 },
    // One entry per emoji used; `users` holds who reacted with it (a second click takes it back).
    reactions: [
      {
        emoji: { type: String, required: true },
        users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      },
    ],
    editedAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

messageSchema.index({ channel: 1, _id: -1 });

module.exports = mongoose.model('Message', messageSchema);
