const mongoose = require('mongoose');

// A small release-note entry generated when a pull request is merged. FlowSync did not have a
// release-note store before, so this focused model fills that gap without duplicating tasks.
const releaseNoteSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
    repoFullName: { type: String, required: true, trim: true },
    prNumber: { type: Number, required: true },
    prUrl: { type: String, trim: true },
    title: { type: String, required: true, trim: true },
    summary: { type: String, trim: true },
    labels: [{ type: String, trim: true }],
  },
  { timestamps: true }
);

releaseNoteSchema.index({ project: 1, repoFullName: 1, prNumber: 1 }, { unique: true });
releaseNoteSchema.index({ project: 1, createdAt: -1 });

module.exports = mongoose.model('ReleaseNote', releaseNoteSchema);
