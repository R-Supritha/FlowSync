export const ROLES = ['Admin', 'Manager', 'Member', 'Viewer']

export const isManager = (role) => role === 'Admin' || role === 'Manager'
export const canWrite = (role) => role === 'Admin' || role === 'Manager' || role === 'Member'
export const isAdmin = (role) => role === 'Admin'

// Mirrors the server: managers edit any task, a Member only their own or assigned ones.
export function canModifyTask(role, task, userId) {
  if (isManager(role)) return true
  if (role !== 'Member' || !task) return false
  const reporterId = task.reporter?._id || task.reporter
  const assigneeId = task.assignee?._id || task.assignee
  return String(reporterId) === String(userId) || (assigneeId && String(assigneeId) === String(userId))
}
