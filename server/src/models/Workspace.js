const mongoose = require('mongoose');

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [
      {
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        role: {
          type: String,
          enum: ['Admin', 'Manager', 'Member', 'Viewer'],
          default: 'Member',
        },
      },
    ],
  },
  { timestamps: true }
);

module.exports = mongoose.model('Workspace', workspaceSchema);