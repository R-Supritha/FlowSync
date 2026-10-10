const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    role: {
      type: String,
      enum: ['Admin', 'Manager', 'Member', 'Viewer'],
      default: 'Member',
    },
    bio: { type: String, trim: true, maxlength: 500, default: '' },
    skills: { type: [String], default: [] },
    avatarUrl: { type: String, trim: true, default: '' },
    githubUsername: { type: String, trim: true, default: '' },
    privacy: {
      statusVisibility: { type: String, enum: ['everyone', 'team', 'managers', 'private'], default: 'team' },
      contributionVisibility: { type: String, enum: ['everyone', 'team', 'managers', 'private'], default: 'private' },
      // Allow guessing my work mode (Coding/Reviewing/Testing) from my project activity.
      inferWorkMode: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);