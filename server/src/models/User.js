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
    // Per-user preferences (theme, language, notification categories) - FR22.
    settings: {
      theme: { type: String, enum: ['system', 'light', 'dark', 'midnight', 'contrast'], default: 'system' },
      fontSize: { type: Number, min: 12, max: 22, default: 14 },
      language: { type: String, enum: ['en'], default: 'en' },
      notifications: {
        taskAssigned: { type: Boolean, default: true },
        taskUpdates: { type: Boolean, default: true },
        comments: { type: Boolean, default: true },
        mentions: { type: Boolean, default: true },
        dueDates: { type: Boolean, default: true },
      },
      // Set the first time the user saves settings, so clients can tell
      // "never saved" apart from "saved the default values".
      configuredAt: { type: Date },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);