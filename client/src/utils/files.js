// Mirrors server/src/config/upload.js. Kept here so the UI can validate before uploading.
export const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB

export const ACCEPTED_MIME = {
  'application/pdf': '.pdf',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.ms-powerpoint': '.ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'application/zip': '.zip',
  'application/x-zip-compressed': '.zip',
}

export const ACCEPT_ATTR = Object.values(ACCEPTED_MIME).join(',')

export const isImage = (mimetype = '') => mimeTypeIsImage(mimetype)
const mimeTypeIsImage = (mimetype) => String(mimetype).startsWith('image/')

export function fileKind(mimetype = '', name = '') {
  const m = String(mimetype)
  if (m.startsWith('image/')) return 'image'
  if (m === 'application/pdf' || /\.pdf$/i.test(name)) return 'pdf'
  if (/word|\.docx?$/i.test(m) || /\.docx?$/i.test(name)) return 'document'
  if (/presentation|powerpoint|\.pptx?$/i.test(m) || /\.pptx?$/i.test(name)) return 'slides'
  if (/zip/i.test(m) || /\.zip$/i.test(name)) return 'zip'
  return 'file'
}

// Returns an error string, or null when the file is acceptable.
export function validateFile(file) {
  if (!file) return 'Choose a file first'
  if (!ACCEPTED_MIME[file.type]) {
    return 'Unsupported file type. Allowed: PDF, Word, PowerPoint, images and ZIP.'
  }
  if (file.size > MAX_FILE_SIZE) return 'File is too large (max 20 MB)'
  return null
}
