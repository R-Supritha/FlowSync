const DEFAULT_COLUMNS = ['Backlog', 'To Do', 'In Progress', 'Review', 'Testing', 'Done'];

// offsetDays is added to the project's start date to get the milestone target date.
const templates = {
  blank: {
    name: 'Blank Project',
    description: 'Empty project with the default Kanban columns.',
    columns: DEFAULT_COLUMNS,
    labels: [],
    milestones: [],
  },
  'web-app-starter': {
    name: 'Web App Starter',
    description: 'Default Kanban columns plus common web-app task categories.',
    columns: DEFAULT_COLUMNS,
    labels: ['frontend', 'backend', 'database', 'auth', 'testing', 'deployment'],
    milestones: [
      { title: 'Design & Setup Complete', offsetDays: 7 },
      { title: 'MVP Demo', offsetDays: 30 },
      { title: 'Final Release', offsetDays: 60 },
    ],
  },
  'course-project': {
    name: 'Course Project',
    description: 'Semester-style project with proposal, review and submission checkpoints.',
    columns: DEFAULT_COLUMNS,
    labels: ['documentation', 'implementation', 'testing', 'presentation'],
    milestones: [
      { title: 'Proposal', offsetDays: 14 },
      { title: 'Mid-term Review', offsetDays: 45 },
      { title: 'Final Submission', offsetDays: 90 },
    ],
  },
  hackathon: {
    name: 'Hackathon',
    description: 'Short, fast-moving project with a trimmed-down board.',
    columns: ['To Do', 'In Progress', 'Review', 'Done'],
    labels: ['idea', 'prototype', 'demo', 'pitch'],
    milestones: [
      { title: 'Working Prototype', offsetDays: 1 },
      { title: 'Demo / Pitch', offsetDays: 2 },
    ],
  },
};

module.exports = { DEFAULT_COLUMNS, templates };
