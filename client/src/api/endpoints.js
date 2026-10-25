import api from './client'

const data = (res) => res.data

export const authApi = {
  login: (body) => api.post('/auth/login', body).then(data),
  register: (body) => api.post('/auth/register', body).then(data),
  forgot: (email) => api.post('/auth/forgot-password', { email }).then(data),
  reset: (token, password) => api.post('/auth/reset-password', { token, password }).then(data),
  verify: (token) => api.post('/auth/verify-email', { token }).then(data),
  resend: () => api.post('/auth/resend-verification').then(data),
}

export const workspaceApi = {
  list: () => api.get('/workspaces').then(data),
  create: (body) => api.post('/workspaces', body).then(data),
  invite: (id, body) => api.post(`/workspaces/${id}/invite`, body).then(data),
  removeMember: (id, userId) => api.delete(`/workspaces/${id}/members/${userId}`).then(data),
  update: (id, body) => api.patch(`/workspaces/${id}`, body).then(data),
  setRole: (id, userId, role) => api.patch(`/workspaces/${id}/members/${userId}`, { role }).then(data),
  remove: (id, confirmName) => api.delete(`/workspaces/${id}`, { data: { confirmName } }).then(data),
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
  addMilestone: (id, body) => api.post(`/projects/${id}/milestones`, body).then(data),
  updateMilestone: (id, milestoneId, body) =>
    api.put(`/projects/${id}/milestones/${milestoneId}`, body).then(data),
  deleteMilestone: (id, milestoneId) =>
    api.delete(`/projects/${id}/milestones/${milestoneId}`).then(data),
}

export const taskApi = {
  list: (projectId, params) => api.get(`/projects/${projectId}/tasks`, { params }).then(data),
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

export const commentApi = {
  list: (taskId) => api.get(`/tasks/${taskId}/comments`).then(data),
  create: (taskId, body) => api.post(`/tasks/${taskId}/comments`, body).then(data),
  update: (id, text) => api.put(`/comments/${id}`, { text }).then(data),
  remove: (id) => api.delete(`/comments/${id}`).then(data),
  react: (id, emoji) => api.post(`/comments/${id}/reactions`, { emoji }).then(data),
}

export const fileApi = {
  listProject: (projectId) => api.get(`/projects/${projectId}/files`).then(data),
  listTask: (taskId) => api.get(`/tasks/${taskId}/files`).then(data),
  upload: (scope, id, file, onProgress) => {
    const form = new FormData()
    form.append('file', file)
    const url = scope === 'task' ? `/tasks/${id}/files` : `/projects/${id}/files`
    return api
      .post(url, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
        },
      })
      .then(data)
  },
  uploadToComment: (commentId, file, onProgress) => {
    const form = new FormData()
    form.append('file', file)
    return api
      .post(`/comments/${commentId}/files`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
        },
      })
      .then(data)
  },
  get: (id) => api.get(`/files/${id}`).then(data),
  // Downloads go through the authenticated endpoint and become a blob URL.
  download: (id) => api.get(`/files/${id}/download`, { responseType: 'blob' }).then((r) => r.data),
  remove: (id) => api.delete(`/files/${id}`).then(data),
}

export const teamApi = {
  list: (workspaceId) => api.get(`/workspaces/${workspaceId}/teams`).then(data),
  get: (id) => api.get(`/teams/${id}`).then(data),
  create: (workspaceId, body) => api.post(`/workspaces/${workspaceId}/teams`, body).then(data),
  update: (id, body) => api.put(`/teams/${id}`, body).then(data),
  remove: (id) => api.delete(`/teams/${id}`).then(data),
  addMember: (id, body) => api.post(`/teams/${id}/members`, body).then(data),
  setMemberRole: (id, userId, role) => api.put(`/teams/${id}/members/${userId}`, { role }).then(data),
  removeMember: (id, userId) => api.delete(`/teams/${id}/members/${userId}`).then(data),
  assignProject: (id, projectId) => api.post(`/teams/${id}/projects/${projectId}`).then(data),
  unassignProject: (id, projectId) => api.delete(`/teams/${id}/projects/${projectId}`).then(data),
  projectTeams: (projectId) => api.get(`/projects/${projectId}/teams`).then(data),
}

export const dashboardApi = {
  get: () => api.get('/dashboard').then(data),
}

export const notificationApi = {
  list: (params) => api.get('/notifications', { params }).then(data),
  markRead: (id) => api.patch(`/notifications/${id}/read`).then(data),
  markAllRead: () => api.patch('/notifications/read-all').then(data),
  remove: (id) => api.delete(`/notifications/${id}`).then(data),
}

export const searchApi = {
  run: (params) => api.get('/search', { params }).then(data),
}

export const profileApi = {
  me: () => api.get('/profile').then(data),
  update: (body) => api.put('/profile', body).then(data),
  user: (id) => api.get(`/users/${id}/profile`).then(data),
  uploadAvatar: (file) => {
    const form = new FormData()
    form.append('avatar', file)
    return api.post('/profile/avatar', form).then(data)
  },
  removeAvatar: () => api.delete('/profile/avatar').then(data),
}

export const activityApi = {
  project: (projectId, params) => api.get(`/projects/${projectId}/activity`, { params }).then(data),
  workspace: (workspaceId, params) =>
    api.get(`/workspaces/${workspaceId}/activity`, { params }).then(data),
  // Read-only SSE endpoint consumed via fetch() so the JWT stays in the
  // Authorization header instead of the URL.
  streamUrl: (projectId) => {
    const base = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
    return `${base}/projects/${projectId}/activity/stream`
  },
}

export const contributionApi = {
  week: (userId, params) => api.get(`/users/${userId}/contributions`, { params }).then(data),
  day: (userId, params) => api.get(`/users/${userId}/contributions/day`, { params }).then(data),
}

export const presenceApi = {
  heartbeat: (active) => api.post('/presence/heartbeat', { active }).then(data),
  setStatus: (body) => api.put('/presence/status', body).then(data),
  me: () => api.get('/presence/me').then(data),
  workspace: (workspaceId) => api.get(`/workspaces/${workspaceId}/presence`).then(data),
  user: (id) => api.get(`/users/${id}/presence`).then(data),
}

export const privacyApi = {
  get: () => api.get('/settings/privacy').then(data),
  update: (body) => api.put('/settings/privacy', body).then(data),
}

export const analyticsApi = {
  project: (projectId, params) => api.get(`/projects/${projectId}/analytics`, { params }).then(data),
  workspace: (workspaceId) => api.get(`/workspaces/${workspaceId}/analytics`).then(data),
}

export const githubApi = {
  get: (projectId) => api.get(`/projects/${projectId}/github`).then(data),
  link: (projectId, body) => api.post(`/projects/${projectId}/github`, body).then(data),
  unlink: (projectId) => api.delete(`/projects/${projectId}/github`).then(data),
  sync: (projectId) => api.post(`/projects/${projectId}/github/sync`).then(data),
  taskRefs: (projectId) => api.get(`/projects/${projectId}/github/task-refs`).then(data),
}

export const calendarApi = {
  project: (projectId, params) => api.get(`/projects/${projectId}/calendar`, { params }).then(data),
  workspace: (workspaceId, params) =>
    api.get(`/workspaces/${workspaceId}/calendar`, { params }).then(data),
}

// FR12: extract readable text from images, scanned PDFs, DOCX and PPTX.
export const ocrApi = {
  extract: (file, onProgress) => {
    const form = new FormData()
    form.append('file', file)
    return api
      .post('/ocr/extract', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (onProgress && e.total) onProgress(Math.round((e.loaded / e.total) * 100))
        },
      })
      .then(data)
  },
}

// FR11: AI project bootstrap (requirements -> structured plan -> real project).
export const aiProjectApi = {
  generatePlan: (requirements) => api.post('/ai/generate-plan', { requirements }).then(data),
  createFromPlan: (workspaceId, body) =>
    api.post(`/workspaces/${workspaceId}/projects/generate`, body).then(data),
}

export const settingsApi = {
  get: () => api.get('/settings').then(data),
  update: (body) => api.put('/settings', body).then(data),
}

// FR23 stand-up report, FR24 sprint planning, FR25 task breakdown.
export const aiAssistApi = {
  breakdown: (taskId, body) => api.post(`/tasks/${taskId}/ai/breakdown`, body).then(data),
  standup: (projectId, body) => api.post(`/projects/${projectId}/ai/standup`, body).then(data),
  sprintPlan: (projectId, body) => api.post(`/projects/${projectId}/ai/sprint-plan`, body).then(data),
  applySprint: (projectId, body) => api.post(`/projects/${projectId}/sprint/apply`, body).then(data),
}

// FR26 channels, FR27 live messaging.
export const chatApi = {
  channels: (workspaceId, params) => api.get(`/workspaces/${workspaceId}/channels`, { params }).then(data),
  taskRefs: (workspaceId, refs) => api.post(`/workspaces/${workspaceId}/chat/task-refs`, { refs }).then(data),
  createChannel: (workspaceId, body) => api.post(`/workspaces/${workspaceId}/channels`, body).then(data),
  updateChannel: (channelId, body) => api.patch(`/channels/${channelId}`, body).then(data),
  removeChannel: (channelId) => api.delete(`/channels/${channelId}`).then(data),
  clear: (channelId) => api.delete(`/channels/${channelId}/messages`).then(data),
  messages: (channelId, params) => api.get(`/channels/${channelId}/messages`, { params }).then(data),
  send: (channelId, text) => api.post(`/channels/${channelId}/messages`, { text }).then(data),
  edit: (messageId, text) => api.patch(`/messages/${messageId}`, { text }).then(data),
  remove: (messageId) => api.delete(`/messages/${messageId}`).then(data),
  react: (messageId, emoji) => api.post(`/messages/${messageId}/reactions`, { emoji }).then(data),
  markRead: (channelId) => api.post(`/channels/${channelId}/read`).then(data),
  // Server-Sent Events, read with fetch() so the JWT stays in the Authorization header.
  streamUrl: (workspaceId) => {
    const base = import.meta.env.VITE_API_URL || 'http://localhost:5000/api'
    return `${base}/workspaces/${workspaceId}/chat/stream`
  },
}
