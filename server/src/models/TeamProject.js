const mongoose = require('mongoose');

// Join collection linking a Team to a Project it's assigned to (many-to-many).
const teamProjectSchema = new mongoose.Schema(
  {
    team: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', required: true, index: true },
    project: { type: mongoose.Schema.Types.ObjectId, ref: 'Project', required: true, index: true },
  },
  { timestamps: true }
);

teamProjectSchema.index({ team: 1, project: 1 }, { unique: true });

module.exports = mongoose.model('TeamProject', teamProjectSchema);
