const mongoose = require('mongoose');

// One GitHub repository linked to one project. The access token is stored encrypted
// and is never returned by a query unless it is asked for with select('+tokenEncrypted').
const githubLinkSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, unique: true },
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    repoFullName: { type: String, required: true, trim: true },
    defaultBranch: { type: String, trim: true },
    tokenEncrypted: { type: String, required: true, select: false },
    linkedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lastSyncedAt: { type: Date, default: null },
    lastSyncSummary: {
      commits: { type: Number, default: 0 },
      prsOpened: { type: Number, default: 0 },
      prsMerged: { type: Number, default: 0 },
      issuesOpened: { type: Number, default: 0 },
      issuesClosed: { type: Number, default: 0 },
      releases: { type: Number, default: 0 },
      newBranches: { type: Number, default: 0 },
    },
    // FR13: the branches seen at the last sync, so the next sync can tell which ones are new.
    // branchesBaselined stays false until the first sync has remembered the existing ones (they are not "new").
    knownBranches: [{ type: String }],
    branchesBaselined: { type: Boolean, default: false },
    recentNewBranches: [{ name: { type: String }, seenAt: { type: Date } }],
    // Deterministic rules for automatic Kanban movement. AI findings only influence the review
    // verdict; they never bypass these switches.
    workflow: {
      completionOnMerge: { type: Boolean, default: true },
      requireChecksForDone: { type: Boolean, default: false },
      testingBeforeDone: { type: Boolean, default: false },
      moveToTestingOnApproval: { type: Boolean, default: true },
      reopenOnNewCommits: { type: Boolean, default: true },
      reviewSeverityThreshold: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'high' },
      reviewConfidenceThreshold: { type: Number, min: 0, max: 1, default: 0.7 },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('GithubLink', githubLinkSchema);