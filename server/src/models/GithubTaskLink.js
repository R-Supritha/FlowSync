const mongoose = require('mongoose');

// Saved, explicit association between a GitHub pull request (or branch) and a FlowSync task.
// Webhook events use this when the pull request title / body does not repeat the FS-xxxxxx
// reference, so a later synchronize / review / merge event still finds the right task.
const githubTaskLinkSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    repoFullName: { type: String, required: true, trim: true },
    prNumber: { type: Number, index: true },
    prUrl: { type: String, trim: true },
    branch: { type: String, trim: true },
    // How the link was first established: an evidence-backed reason, never a title match.
    source: { type: String, enum: ['reference', 'branch', 'saved', 'manual'], default: 'reference' },
    lastEventAt: { type: Date },
  },
  { timestamps: true }
);

githubTaskLinkSchema.index({ project: 1, repoFullName: 1, prNumber: 1, task: 1 }, { unique: true });
githubTaskLinkSchema.index({ project: 1, repoFullName: 1, branch: 1 });

module.exports = mongoose.model('GithubTaskLink', githubTaskLinkSchema);
