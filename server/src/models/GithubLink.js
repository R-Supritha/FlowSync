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
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('GithubLink', githubLinkSchema);