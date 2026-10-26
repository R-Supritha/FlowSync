const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    priority: { type: String, enum: ['Low', 'Medium', 'High'], default: 'Medium' },
    // Must match one of the project's Kanban columns (validated in the controller).
    status: { type: String, default: 'Backlog' },
    // Sort order inside a column, used by the Kanban board (Module 6).
    position: { type: Number, default: 0 },
    labels: [{ type: String, trim: true }],
    attachments: [
      {
        name: { type: String, trim: true },
        url: { type: String, trim: true },
      },
    ],
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reporter: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    deadline: { type: Date },
    estimatedHours: { type: Number, min: 0, default: 0 },
    actualHours: { type: Number, min: 0, default: 0 },
    // "Blocked by" relationships: this task cannot start until these are done.
    dependencies: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Task' }],
    milestone: { type: mongoose.Schema.Types.ObjectId },
    checklist: [
      {
        text: { type: String, required: true, trim: true },
        done: { type: Boolean, default: false },
      },
    ],
    subtasks: [
      {
        title: { type: String, required: true, trim: true },
        done: { type: Boolean, default: false },
      },
    ],
    completedAt: { type: Date },
    // Whether the last status change was made by a person or by the GitHub automation.
    // A manually completed task is never reopened automatically.
    statusSource: { type: String, enum: ['manual', 'github'], default: 'manual' },
    // The latest GitHub evidence for this task. Used to reject stale/out-of-order webhooks
    // and to keep the review, checks and pull-request context in one place.
    github: {
      prNumber: { type: Number },
      prUrl: { type: String, trim: true },
      branch: { type: String, trim: true },
      lastEventAt: { type: Date },
      lastEventKey: { type: String, trim: true },
      reviewStatus: { type: String, trim: true },
      reviewVerdict: { type: String, trim: true },
      checksConclusion: { type: String, trim: true },
      lastTransitionAt: { type: Date },
      lastTransitionReason: { type: String, trim: true },
    },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

taskSchema.index({ project: 1, status: 1, position: 1 });

module.exports = mongoose.model('Task', taskSchema);
