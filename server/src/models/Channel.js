const mongoose = require('mongoose');

// A chat channel inside a workspace (FR26). Every member of the workspace can see it.
//   general: one per workspace, always there
//   project: one per project, created by FlowSync
//   custom:  made by an Admin or Manager
const channelSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true, lowercase: true, maxlength: 40 },
    description: { type: String, default: '', trim: true, maxlength: 200 },
    kind: { type: String, enum: ['general', 'project', 'custom'], default: 'custom' },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Names are unique inside a workspace.
channelSchema.index({ workspace: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Channel', channelSchema);
