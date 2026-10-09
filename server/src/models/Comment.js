const mongoose = require('mongoose');

const commentSchema = new mongoose.Schema(
  {
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    parentComment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment', default: null },
    text: { type: String, required: true, trim: true },
    attachments: [
      {
        name: { type: String, trim: true },
        url: { type: String, trim: true },
      },
    ],
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // One entry per emoji used; `users` holds who reacted with it (toggle on/off).
    reactions: [
      {
        emoji: { type: String, required: true },
        users: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
      },
    ],
    editedAt: { type: Date },
  },
  { timestamps: true }
);

commentSchema.index({ task: 1, createdAt: 1 });

module.exports = mongoose.model('Comment', commentSchema);
