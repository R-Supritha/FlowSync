// Human wording for every activity type the backend can record.
export const ACTIVITY_LABELS = {
  task_created: 'Task created',
  task_updated: 'Task updated',
  task_status_changed: 'Status changed',
  task_completed: 'Task completed',
  task_assigned: 'Task assigned',
  task_deleted: 'Task deleted',
  comment_added: 'Comment',
  file_uploaded: 'File uploaded',
  commit_pushed: 'Commit',
  pr_opened: 'Pull request',
  pr_merged: 'PR merged',
  review_submitted: 'Review',
}

// Colour bucket used by the weekly contribution dots (mirrors utils/activity.js on the server).
export const CATEGORY_COLOR = {
  completed: 'green',
  collaboration: 'yellow',
  planning: 'blue',
}

export const CATEGORY_LABEL = {
  completed: 'Completed work',
  collaboration: 'Collaboration',
  planning: 'Planning',
}

export const DOT_VAR = {
  green: 'var(--ok)',
  yellow: 'var(--warn)',
  blue: 'var(--accent)',
  gray: 'var(--border)',
}
