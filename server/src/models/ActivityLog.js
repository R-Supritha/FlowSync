const mongoose = require('mongoose');

const ACTIVITY_TYPES = [
  'task_created',
  'task_updated',
  'task_status_changed',
  'task_completed',
  'task_assigned',
  'task_deleted',
  'comment_added',
  'file_uploaded',
  // Reserved for the GitHub integration (FR13/FR14). Nothing writes these yet,
  // but the feed, timeline and presence already understand them.
  'commit_pushed',
  'pr_opened',
  'pr_merged',
  'review_submitted',
];

const ACTIVITY_CATEGORIES = ['completed', 'collaboration', 'planning'];

const activityLogSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    // Colour bucket for the weekly contribution timeline (FR16).
    category: { type: String, enum: ACTIVITY_CATEGORIES, required: true },
    message: { type: String, required: true, trim: true },
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
    // Snapshot of the title so the feed still reads well after a task is deleted/renamed.
    taskTitle: { type: String, trim: true },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

activityLogSchema.index({ project: 1, createdAt: -1 });
activityLogSchema.index({ workspace: 1, createdAt: -1 });
activityLogSchema.index({ actor: 1, createdAt: -1 });

const ActivityLog = mongoose.model('ActivityLog', activityLogSchema);
ActivityLog.TYPES = ACTIVITY_TYPES;
ActivityLog.CATEGORIES = ACTIVITY_CATEGORIES;

module.exports = ActivityLog;