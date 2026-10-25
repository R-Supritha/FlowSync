// What the API shows about an uploaded file (never the name it has on the disk).
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

module.exports = { assetView };
