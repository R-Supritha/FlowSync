const mongoose = require('mongoose');

// When a person last read a channel, so we can show how many messages are new for them.
const channelReadSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    channel: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true },
    lastReadAt: { type: Date, required: true },
  },
  { timestamps: true }
);

channelReadSchema.index({ user: 1, channel: 1 }, { unique: true });

module.exports = mongoose.model('ChannelRead', channelReadSchema);
