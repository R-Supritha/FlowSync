export const ROLES = ['Admin', 'Manager', 'Member', 'Viewer']

export const isManager = (role) => role === 'Admin' || role === 'Manager'
export const canWrite = (role) => role === 'Admin' || role === 'Manager' || role === 'Member'
export const isAdmin = (role) => role === 'Admin'

// Manager-level abilities (the backend enforces the same rules).
export const canManageProject = isManager
export const canManageColumns = isManager
export const canManageMilestones = isManager
export const canManageTeams = isManager
export const canInviteMembers = isManager
export const canLinkGithub = isManager
export const canRemoveMembers = isAdmin

// Mirrors the server: managers edit any task, a Member only their own or assigned ones.
export function canModifyTask(role, task, userId) {
  if (isManager(role)) return true
  if (role !== 'Member' || !task) return false
  const reporterId = task.reporter?._id || task.reporter
  const assigneeId = task.assignee?._id || task.assignee
  return String(reporterId) === String(userId) || (assigneeId && String(assigneeId) === String(userId))
}

// A short human explanation for read-only users.
export const readOnlyReason = (role, task, userId) => {
  if (role === 'Viewer') return 'Viewers have read-only access.'
  if (task && !canModifyTask(role, task, userId)) {
    return 'You can move this card, but only its reporter, assignee or a manager can edit it.'
  }
  return ''
}
