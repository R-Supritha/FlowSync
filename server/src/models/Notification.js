const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['task_assigned', 'mention', 'comment_reply', 'deadline_approaching', 'status_changed'],
      required: true,
    },
    message: { type: String, required: true, trim: true },
    // Where to send the user when they click the notification.
    link: {
      workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace' },
      project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
      task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
      comment: { type: mongoose.Schema.Types.ObjectId, ref: 'Comment' },
    },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
