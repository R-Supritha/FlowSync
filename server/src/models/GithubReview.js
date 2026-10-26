const mongoose = require('mongoose');

const findingSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true },
    detail: { type: String, trim: true },
    file: { type: String, trim: true },
    line: { type: Number },
    severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'low' },
    confidence: { type: Number, min: 0, max: 1, default: 0 },
    actionable: { type: Boolean, default: false },
  },
  { _id: false }
);

const criterionSchema = new mongoose.Schema(
  {
    criterion: { type: String, trim: true },
    met: { type: Boolean },
    confidence: { type: Number, min: 0, max: 1, default: 0 },
    note: { type: String, trim: true },
  },
  { _id: false }
);

const historySchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    source: { type: String, enum: ['ai', 'github', 'checks'], default: 'ai' },
    commitSha: { type: String, trim: true },
    verdict: { type: String, trim: true },
    summary: { type: String, trim: true },
    findingsCount: { type: Number, default: 0 },
    blockingCount: { type: Number, default: 0 },
    severity: { type: String, trim: true },
    confidence: { type: Number },
    aiUsed: { type: Boolean, default: false },
    reason: { type: String, trim: true },
  },
  { _id: false }
);

// One document per task / pull request, with review history inside it. Re-running a review
// updates this document instead of creating a confusing duplicate row per synchronize event.
const githubReviewSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    task: { type: mongoose.Schema.Types.ObjectId, ref: 'Task', required: true, index: true },
    repoFullName: { type: String, required: true, trim: true },
    prNumber: { type: Number, required: true },
    prUrl: { type: String, trim: true },
    verdict: { type: String, enum: ['pending', 'changes_requested', 'no_blocking_issues', 'approved', 'inconclusive', 'unavailable'], default: 'pending' },
    summary: { type: String, trim: true },
    findings: { type: [findingSchema], default: [] },
    acceptanceCriteria: { type: [criterionSchema], default: [] },
    severity: { type: String, trim: true },
    confidence: { type: Number, min: 0, max: 1 },
    aiUsed: { type: Boolean, default: false },
    commitSha: { type: String, trim: true },
    reviewedAt: { type: Date },
    history: { type: [historySchema], default: [] },
  },
  { timestamps: true }
);

githubReviewSchema.index({ project: 1, repoFullName: 1, prNumber: 1, task: 1 }, { unique: true });
githubReviewSchema.index({ task: 1, reviewedAt: -1 });

module.exports = mongoose.model('GithubReview', githubReviewSchema);
