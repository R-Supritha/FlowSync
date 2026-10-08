const mongoose = require('mongoose');
const { DEFAULT_COLUMNS } = require('../config/projectTemplates');

const milestoneSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    targetDate: { type: Date, required: true },
    completed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const projectSchema = new mongoose.Schema(
  {
    workspace: { type: mongoose.Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    startDate: { type: Date, default: Date.now },
    deadline: { type: Date },
    template: { type: String, default: 'blank' },
    // Kanban columns live on the project so templates can shape the board (Module 6 will manage them).
    columns: { type: [String], default: DEFAULT_COLUMNS },
    // Suggested task categories, seeded by the template.
    labels: { type: [String], default: [] },
    milestones: [milestoneSchema],
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isArchived: { type: Boolean, default: false },
    archivedAt: { type: Date },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Project', projectSchema);
