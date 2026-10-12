export const PRESENCE_STATUSES = ['Active', 'Idle', 'Offline', 'Do Not Disturb']
export const WORK_MODES = ['Coding', 'Reviewing', 'Testing', 'Designing']

export const STATUS_COLOR = {
  Active: 'var(--ok)',
  Idle: 'var(--warn)',
  Offline: 'var(--fg-muted)',
  'Do Not Disturb': 'var(--danger)',
}

// A person is "online" when they are not Offline and are not hiding.
export const isOnline = (member) => member && !member.hidden && member.status && member.status !== 'Offline'

// Indexes a raw /workspaces/:id/presence members array by user id.
export function presenceByUser(members = []) {
  const map = {}
  for (const m of members) {
    if (m.user?._id) map[m.user._id] = m
  }
  return map
}
