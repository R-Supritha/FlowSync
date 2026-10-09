const mongoose = require('mongoose');

const teamSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    members: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        // Per-team role, independent of the user's workspace-level role (FR4).
        role: { type: String, enum: ['Admin', 'Manager', 'Member', 'Viewer'], default: 'Member' },
      },
    ],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true }
);

teamSchema.index({ workspace: 1, name: 1 });

module.exports = mongoose.model('Team', teamSchema);
