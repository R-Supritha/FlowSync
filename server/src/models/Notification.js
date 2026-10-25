const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['task_assigned', 'mention', 'comment_reply', 'deadline_approaching', 'deadline_overdue', 'status_changed', 'pr_opened', 'pr_merged'],
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
    // Set on reminders that must be sent only once (for example one per task and due date).
    key: { type: String },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, isRead: 1, createdAt: -1 });
// The same reminder can never be stored twice for one person, even if two requests race.
notificationSchema.index({ user: 1, key: 1 }, { unique: true, partialFilterExpression: { key: { $type: 'string' } } });

module.exports = mongoose.model('Notification', notificationSchema);
