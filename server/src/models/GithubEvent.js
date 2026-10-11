const mongoose = require('mongoose');

// One row per GitHub event already turned into an activity entry, so syncing twice
// never records the same commit or pull request twice.
const githubEventSchema = new mongoose.Schema(
  {
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true },
    key: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

githubEventSchema.index({ project: 1, key: 1 }, { unique: true });

module.exports = mongoose.model('GithubEvent', githubEventSchema);