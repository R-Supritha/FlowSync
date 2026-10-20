import api from './client'

const data = (res) => res.data

export const authApi = {
  login: (body) => api.post('/auth/login', body).then(data),
  register: (body) => api.post('/auth/register', body).then(data),
}

export const workspaceApi = {
  list: () => api.get('/workspaces').then(data),
  create: (body) => api.post('/workspaces', body).then(data),
  invite: (id, body) => api.post(`/workspaces/${id}/invite`, body).then(data),
  removeMember: (id, userId) => api.delete(`/workspaces/${id}/members/${userId}`).then(data),
  // The only endpoint that returns member names, so it doubles as the people lookup.
  people: (id) => api.get(`/workspaces/${id}/presence`).then(data),
}

export const projectApi = {
  templates: () => api.get('/project-templates').then(data),
  list: (workspaceId, archived = false) =>
    api.get(`/workspaces/${workspaceId}/projects`, { params: { archived } }).then(data),
  get: (id) => api.get(`/projects/${id}`).then(data),
  create: (workspaceId, body) => api.post(`/workspaces/${workspaceId}/projects`, body).then(data),
  update: (id, body) => api.put(`/projects/${id}`, body).then(data),
  archive: (id) => api.patch(`/projects/${id}/archive`).then(data),
  unarchive: (id) => api.patch(`/projects/${id}/unarchive`).then(data),
  remove: (id) => api.delete(`/projects/${id}`, { params: { confirm: true } }).then(data),
}

export const taskApi = {
  get: (id) => api.get(`/tasks/${id}`).then(data),
  create: (projectId, body) => api.post(`/projects/${projectId}/tasks`, body).then(data),
  update: (id, body) => api.put(`/tasks/${id}`, body).then(data),
  assign: (id, assignee) => api.patch(`/tasks/${id}/assign`, { assignee }).then(data),
  move: (id, body) => api.patch(`/tasks/${id}/status`, body).then(data),
  archive: (id) => api.patch(`/tasks/${id}/archive`).then(data),
  unarchive: (id) => api.patch(`/tasks/${id}/unarchive`).then(data),
  remove: (id) => api.delete(`/tasks/${id}`).then(data),
}

export const boardApi = {
  get: (projectId, params) => api.get(`/projects/${projectId}/board`, { params }).then(data),
  reorder: (projectId, body) => api.patch(`/projects/${projectId}/board/reorder`, body).then(data),
  setColumns: (projectId, columns) => api.put(`/projects/${projectId}/columns`, { columns }).then(data),
}

// ---------------------------------------------------------------------------
// Everything below was added to finish the frontend (FR4, FR7-FR10, FR13-FR22).
// ---------------------------------------------------------------------------

export const dashboardApi = {
  get: () => api.get('/dashboard').then(data),
}

export const searchApi = {
  query: (q, workspace) => api.get('/search', { params: { q, ...(workspace ? { workspace } : {}) } }).then(data),
}

export const notificationApi = {
  list: (params) => api.get('/notifications', { params }).then(data),
  read: (id) => api.patch(`/notifications/${id}/read`).then(data),
  readAll: () => api.patch('/notifications/read-all').then(data),
  remove: (id) => api.delete(`/notifications/${id}`).then(data),
}

export const commentApi = {
  list: (taskId) => api.get(`/tasks/${taskId}/comments`).then(data),
  create: (taskId, body) => api.post(`/tasks/${taskId}/comments`, body).then(data),
  update: (id, text) => api.put(`/comments/${id}`, { text }).then(data),
  remove: (id) => api.delete(`/comments/${id}`).then(data),
  react: (id, emoji) => api.post(`/comments/${id}/reactions`, { emoji }).then(data),
}

function upload(url, file, onProgress) {
  const form = new FormData()
  form.append('file', file)
  return api
    .post(url, form, {
      timeout: 120000,
      onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)),
    })
    .then(data)
}

export const fileApi = {
  forProject: (projectId) => api.get(`/projects/${projectId}/files`).then(data),
  forTask: (taskId) => api.get(`/tasks/${taskId}/files`).then(data),
  uploadToProject: (projectId, file, onProgress) => upload(`/projects/${projectId}/files`, file, onProgress),
  uploadToTask: (taskId, file, onProgress) => upload(`/tasks/${taskId}/files`, file, onProgress),
  // The download address needs the login token, so it is fetched as a file, not opened as a link.
  download: (id) => api.get(`/files/${id}/download`, { responseType: 'blob' }),
  remove: (id) => api.delete(`/files/${id}`).then(data),
}

export const teamApi = {
  list: (workspaceId) => api.get(`/workspaces/${workspaceId}/teams`).then(data),
  create: (workspaceId, body) => api.post(`/workspaces/${workspaceId}/teams`, body).then(data),
  remove: (id) => api.delete(`/teams/${id}`).then(data),
  addMember: (id, body) => api.post(`/teams/${id}/members`, body).then(data),
  removeMember: (id, userId) => api.delete(`/teams/${id}/members/${userId}`).then(data),
  setRole: (id, userId, role) => api.put(`/teams/${id}/members/${userId}`, { role }).then(data),
  assign: (id, projectId) => api.post(`/teams/${id}/projects/${projectId}`).then(data),
  unassign: (id, projectId) => api.delete(`/teams/${id}/projects/${projectId}`).then(data),
  forProject: (projectId) => api.get(`/projects/${projectId}/teams`).then(data),
}

export const milestoneApi = {
  add: (projectId, body) => api.post(`/projects/${projectId}/milestones`, body).then(data),
  update: (projectId, id, body) => api.put(`/projects/${projectId}/milestones/${id}`, body).then(data),
  remove: (projectId, id) => api.delete(`/projects/${projectId}/milestones/${id}`).then(data),
}

export const calendarApi = {
  project: (id, params) => api.get(`/projects/${id}/calendar`, { params }).then(data),
  workspace: (id, params) => api.get(`/workspaces/${id}/calendar`, { params }).then(data),
}

export const activityApi = {
  project: (id, params) => api.get(`/projects/${id}/activity`, { params }).then(data),
  workspace: (id, params) => api.get(`/workspaces/${id}/activity`, { params }).then(data),
}

export const contributionApi = {
  week: (userId, params) => api.get(`/users/${userId}/contributions`, { params }).then(data),
  day: (userId, params) => api.get(`/users/${userId}/contributions/day`, { params }).then(data),
}

export const presenceApi = {
  heartbeat: (active) => api.post('/presence/heartbeat', { active }).then(data),
  me: () => api.get('/presence/me').then(data),
  setStatus: (body) => api.put('/presence/status', body).then(data),
  getPrivacy: () => api.get('/settings/privacy').then(data),
  setPrivacy: (body) => api.put('/settings/privacy', body).then(data),
}

export const analyticsApi = {
  project: (id, params) => api.get(`/projects/${id}/analytics`, { params }).then(data),
}

export const profileApi = {
  me: () => api.get('/profile').then(data),
  update: (body) => api.put('/profile', body).then(data),
  user: (id) => api.get(`/users/${id}/profile`).then(data),
}

export const githubApi = {
  get: (projectId) => api.get(`/projects/${projectId}/github`).then(data),
  link: (projectId, body) => api.post(`/projects/${projectId}/github`, body).then(data),
  unlink: (projectId) => api.delete(`/projects/${projectId}/github`).then(data),
  sync: (projectId) => api.post(`/projects/${projectId}/github/sync`).then(data),
  refs: (projectId) => api.get(`/projects/${projectId}/github/task-refs`).then(data),
}
