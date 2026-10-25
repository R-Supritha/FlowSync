const fs = require('fs');
const path = require('path');
const FileAsset = require('../models/FileAsset');
const Comment = require('../models/Comment');
const { UPLOAD_DIR } = require('../config/upload');

// Deletes the file records matching `filter` and the uploaded files on the disk. Returns how many records went.
async function removeFileAssets(filter) {
  const files = await FileAsset.find(filter).select('storedName').lean();
  for (const f of files) {
    if (f.storedName) fs.unlink(path.join(UPLOAD_DIR, f.storedName), () => {}); // best effort
  }
  const result = await FileAsset.deleteMany(filter);
  return (result && result.deletedCount) || 0;
}

// Everything that belongs to one task: its comments, and the files attached to the task or to those comments.
async function removeTaskData(taskId) {
  const comments = await Comment.find({ task: taskId }).select('_id').lean();
  const commentIds = comments.map((c) => c._id);
  await removeFileAssets({ $or: [{ task: taskId }, { comment: { $in: commentIds } }] });
  await Comment.deleteMany({ task: taskId });
}

module.exports = { removeFileAssets, removeTaskData };
