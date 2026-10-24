const mongoose = require('mongoose');

// One chat message (FR27). Deleting only blanks the text and sets deletedAt, so the history keeps its shape.
const messageSchema = new mongoose.Schema(
  {
    channel: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, default: '', maxlength: 4000 },
    editedAt: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true }
);

messageSchema.index({ channel: 1, _id: -1 });

module.exports = mongoose.model('Message', messageSchema);
