const mongoose = require('mongoose');

const PRESENCE_STATUSES = ['Active', 'Idle', 'Offline', 'Do Not Disturb'];
const WORK_MODES = ['Coding', 'Reviewing', 'Testing', 'Designing'];

const presenceSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    // Set only when the user picked a status by hand; unset = automatic.
    manualStatus: { type: String, enum: PRESENCE_STATUSES },
    workMode: { type: String, enum: WORK_MODES },
    // Optional "what I'm working on" pointer.
    workingOn: { type: mongoose.Schema.Types.ObjectId, ref: 'Task' },
    // Last time the app told us it is open (heartbeat).
    lastSeenAt: { type: Date },
    // Last time the user was actually using the page (tab visible/focused).
    lastActiveAt: { type: Date },
  },
  { timestamps: true }
);

const Presence = mongoose.model('Presence', presenceSchema);
Presence.STATUSES = PRESENCE_STATUSES;
Presence.WORK_MODES = WORK_MODES;

module.exports = Presence;