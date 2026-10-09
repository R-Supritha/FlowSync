const fs = require('fs');
const path = require('path');
const FileAsset = require('../models/FileAsset');
const Project = require('../models/Project');
const Task = require('../models/Task');
const Comment = require('../models/Comment');
const { canWrite, isManagerRole, getWorkspaceRole, serverError } = require('../utils/access');
const { UPLOAD_DIR } = require('../config/upload');

function fail(res, status, message) {
  res.status(status).json({ success: false, message });
  return null;
}

function removeFromDisk(storedName) {
  const filePath = path.join(UPLOAD_DIR, storedName);
  fs.unlink(filePath, () => {}); // best effort; missing file is not an error for the caller
}

function assetView(asset) {
  return {
    _id: asset._id,
    originalName: asset.originalName,
    url: asset.url,
    mimetype: asset.mimetype,
    size: asset.size,
    uploadedBy: asset.uploadedBy,
    project: asset.project,
    task: asset.task,
    comment: asset.comment,
    createdAt: asset.createdAt,
  };
}

async function saveUploadedFile(req, res, { workspace, project, task, comment }) {
  if (!req.file) return fail(res, 400, 'No file was uploaded (field name must be "file")');

  const asset = await FileAsset.create({
    workspace,
    uploadedBy: req.user.id,
    originalName: req.file.originalname,
    storedName: req.file.filename,
    url: `/uploads/${req.file.filename}`,
    mimetype: req.file.mimetype,
    size: req.file.size,
    project,
    task,
    comment,
  });

  res.status(201).json({ success: true, file: assetView(asset) });
}

async function uploadToProject(req, res) {
  try {
    const project = await Project.findById(req.params.projectId);
    if (!project) return fail(res, 404, 'Project not found');
    const role = await getWorkspaceRole(project.workspace, req.user.id);
    if (!role) return fail(res, 404, 'Project not found');
    if (!canWrite(role)) return fail(res, 403, 'Viewers cannot upload files');

    await saveUploadedFile(req, res, { workspace: project.workspace, project: project._id });
  } catch (error) {
    serverError(res, 'Failed to upload file', error);
  }
}

async function uploadToTask(req, res) {
  try {
    const task = await Task.findById(req.params.taskId);
    if (!task) return fail(res, 404, 'Task not found');
    const role = await getWorkspaceRole(task.workspace, req.user.id);
    if (!role) return fail(res, 404, 'Task not found');
    if (!canWrite(role)) return fail(res, 403, 'Viewers cannot upload files');

    await saveUploadedFile(req, res, { workspace: task.workspace, task: task._id });
  } catch (error) {
    serverError(res, 'Failed to upload file', error);
  }
}

async function uploadToComment(req, res) {
  try {
    const comment = await Comment.findById(req.params.commentId);
    if (!comment) return fail(res, 404, 'Comment not found');
    const task = await Task.findById(comment.task);
    const role = task && (await getWorkspaceRole(task.workspace, req.user.id));
    if (!role) return fail(res, 404, 'Comment not found');
    if (!canWrite(role)) return fail(res, 403, 'Viewers cannot upload files');
    if (String(comment.author) !== String(req.user.id)) {
      return fail(res, 403, 'Only the comment author can attach files to it');
    }

    await saveUploadedFile(req, res, { workspace: task.workspace, comment: comment._id });
  } catch (error) {
    serverError(res, 'Failed to upload file', error);
  }
}

function listFiles(ownerField, idParam) {
  return async function (req, res) {
    try {
      const ownerId = req.params[idParam];
      let workspace;
      if (ownerField === 'project') {
        const project = await Project.findById(ownerId);
        if (!project) return fail(res, 404, 'Project not found');
        workspace = project.workspace;
      } else {
        const task = await Task.findById(ownerId);
        if (!task) return fail(res, 404, 'Task not found');
        workspace = task.workspace;
      }
      const role = await getWorkspaceRole(workspace, req.user.id);
      if (!role) return fail(res, 404, 'Not found');

      const files = await FileAsset.find({ [ownerField]: ownerId }).sort({ createdAt: -1 });
      res.json({ success: true, files: files.map(assetView) });
    } catch (error) {
      serverError(res, 'Failed to list files', error);
    }
  };
}

async function getFile(req, res) {
  try {
    const asset = await FileAsset.findById(req.params.id);
    if (!asset) return fail(res, 404, 'File not found');
    const role = await getWorkspaceRole(asset.workspace, req.user.id);
    if (!role) return fail(res, 404, 'File not found');

    res.json({ success: true, file: assetView(asset) });
  } catch (error) {
    serverError(res, 'Failed to fetch file', error);
  }
}

async function downloadFile(req, res) {
  try {
    const asset = await FileAsset.findById(req.params.id);
    if (!asset) return fail(res, 404, 'File not found');
    const role = await getWorkspaceRole(asset.workspace, req.user.id);
    if (!role) return fail(res, 404, 'File not found');

    const filePath = path.join(UPLOAD_DIR, asset.storedName);
    res.download(filePath, asset.originalName, (err) => {
      if (err && !res.headersSent) fail(res, 404, 'File is missing from storage');
    });
  } catch (error) {
    serverError(res, 'Failed to download file', error);
  }
}

async function deleteFile(req, res) {
  try {
    const asset = await FileAsset.findById(req.params.id);
    if (!asset) return fail(res, 404, 'File not found');
    const role = await getWorkspaceRole(asset.workspace, req.user.id);
    if (!role) return fail(res, 404, 'File not found');

    const isOwner = String(asset.uploadedBy) === String(req.user.id);
    if (!isOwner && !isManagerRole(role)) {
      return fail(res, 403, 'Only the uploader, Admin, or Manager can delete this file');
    }

    await asset.deleteOne();
    removeFromDisk(asset.storedName);

    res.json({ success: true, message: 'File deleted' });
  } catch (error) {
    serverError(res, 'Failed to delete file', error);
  }
}

module.exports = {
  uploadToProject,
  uploadToTask,
  uploadToComment,
  listProjectFiles: listFiles('project', 'projectId'),
  listTaskFiles: listFiles('task', 'taskId'),
  getFile,
  downloadFile,
  deleteFile,
};
