import api from '../src/api/client'
import { ids, token } from './token'
export { ids, token }

// A pretend FlowSync API that answers with the exact response shapes the real server returned in our tests.
const BADGES_RESPONSE = {
  earned: 2,
  total: 8,
  badges: [
    { id: 'first-task', title: 'First task done', description: 'Complete your first task', target: 1, current: 1, earned: true },
    { id: 'task-finisher', title: 'Task finisher', description: 'Complete 10 tasks', target: 10, current: 10, earned: true },
    { id: 'task-master', title: 'Task master', description: 'Complete 50 tasks', target: 50, current: 12, earned: false },
    { id: 'team-voice', title: 'Team voice', description: 'Write 10 comments', target: 10, current: 3, earned: false },
  ],
}

export function makeServer({ role = 'Admin', failMove = false, failReorder = false, githubLinked = false, hiddenDots = false, ai = 'ok', ocrFail = false, breakdown = 'ok', standup = 'ok', sprint = 'ok', githubIgnored = false, manyMessages = false, resend = 'ok', verifiedOnServer = false, moreNotifications = false, achievements = 'shown', avatarFail = false, pictures = false, hasPicture = false, withCommentFiles = false, githubExtras = 'none', botMessage = false, seedReactions = false } = {}) {
  const calls = []
  const iso = (n = 0) => new Date(Date.now() + n * 86400000).toISOString()
  const me = { _id: ids.me, name: 'Sunitha', email: 'sunitha@test.com' }
  const other = { _id: ids.other, name: 'Test User Two', email: 'testuser2@test.com', ...(pictures ? { avatarUrl: '/avatars/raj.png' } : {}) }

  const state = {
    tasks: [
      { _id: ids.t1, title: 'Build login page', status: 'Backlog', position: 0, priority: 'High', labels: ['auth'], deadline: iso(3), reporter: ids.me, assignee: me, checklist: [{ text: 'Design form', done: true }, { text: 'Connect API', done: false }], dependencies: [] },
      { _id: ids.t2, title: 'Add protected routes', status: 'Backlog', position: 1, priority: 'Medium', labels: [], reporter: ids.other, assignee: null, checklist: [], dependencies: [] },
      { _id: ids.t3, title: 'Write tests', status: 'In Progress', position: 0, priority: 'Low', labels: [], reporter: ids.other, assignee: null, checklist: [], dependencies: [] },
    ],
    notifications: [
      { _id: 'n1', type: 'task_assigned', message: 'Test User Two assigned you "Write tests"', isRead: false, createdAt: iso(-0.01), link: { workspace: ids.ws, project: ids.project, task: ids.t3 } },
      { _id: 'n2', type: 'mention', message: 'Test User Two mentioned you in a comment', isRead: false, createdAt: iso(-1), link: { workspace: ids.ws, project: ids.project, task: ids.t1 } },
      { _id: 'n3', type: 'comment_reply', message: 'Test User Two replied to your comment', isRead: true, createdAt: iso(-2), link: { workspace: ids.ws, project: ids.project, task: ids.t1 } },
    ],
    comments: [
      { _id: 'c1', task: ids.t1, author: me, text: 'First comment from me', parentComment: null, reactions: [], createdAt: iso(-1) },
      { _id: 'c2', task: ids.t1, author: other, text: 'A reply from the other user', parentComment: 'c1', reactions: [{ emoji: '👍', users: [ids.other] }], createdAt: iso(-0.5) },
    ],
    files: [
      { _id: 'f1', originalName: 'spec.pdf', mimetype: 'application/pdf', size: 204800, uploadedBy: other, createdAt: iso(-1), task: ids.t1, project: ids.project },
      { _id: 'f2', originalName: 'diagram.png', mimetype: 'image/png', size: 1024, uploadedBy: me, createdAt: iso(-2), task: ids.t1, project: ids.project },
    ],
    teams: [{ _id: 'team1', name: 'Core Team', description: 'The core', members: [{ user: ids.me, role: 'Admin' }], createdBy: ids.me }],
    projectTeams: [],
    milestones: [{ _id: 'm1', title: 'MVP', description: 'first release', targetDate: iso(10), completed: false }],
    github: { linked: githubLinked },
    settings: { theme: 'system', fontSize: 14, language: 'en', notifications: { taskAssigned: true, taskUpdates: true, comments: true, mentions: true, dueDates: true } },
    generated: {},
    channels: [
      { _id: 'ch-general', name: 'general', description: 'Everyone in the workspace', kind: 'general', project: null, unread: 2, lastMessage: null },
      { _id: 'ch-proj', name: 'demo-project', description: 'Chat for Demo Project', kind: 'project', project: ids.project, unread: 0, lastMessage: null },
    ],
    messages: [],
    seq: 0,

    privacy: { statusVisibility: 'team', contributionVisibility: 'private', inferWorkMode: false },
    profile: { ...me, bio: 'Student', skills: ['React'], avatarUrl: '', githubUsername: 'sunithaa42' },
    activities: [
      { _id: 'a1', type: 'task_created', category: 'planning', message: 'created "Build login page"', actor: me, project: { _id: ids.project, name: 'Demo Project' }, createdAt: iso(-0.1) },
      { _id: 'a2', type: 'commit_pushed', category: 'completed', message: 'committed "Add search (FR20)" (3f51928)', actor: me, project: { _id: ids.project, name: 'Demo Project' }, createdAt: iso(-0.2) },
      { _id: 'a3', type: 'comment_added', category: 'collaboration', message: 'commented on "Build login page"', actor: other, project: { _id: ids.project, name: 'Demo Project' }, createdAt: iso(-0.3) },
    ],
  }
  if (withCommentFiles) {
    state.files.push(
      { _id: 'cf1', originalName: 'notes.pdf', mimetype: 'application/pdf', size: 2048, uploadedBy: ids.me, createdAt: iso(-1), comment: 'c1' },
      { _id: 'cf2', originalName: 'mockup.png', mimetype: 'image/png', size: 5 * 1024 * 1024, uploadedBy: ids.other, createdAt: iso(-1), comment: 'c1' },
    )
  }
  if (hasPicture) state.profile.avatarUrl = '/avatars/me-0123456789abcdef.png'
  if (moreNotifications) {
    state.notifications.push(
      { _id: 'n4', type: 'pr_opened', message: 'Pull request #7 "Add search" was opened for "Build login page"', isRead: false, createdAt: iso(-0.02), link: { workspace: ids.ws, project: ids.project, task: ids.t1 } },
      { _id: 'n5', type: 'pr_merged', message: 'Pull request #7 "Add search" was merged for "Build login page"', isRead: false, createdAt: iso(-0.03), link: { workspace: ids.ws, project: ids.project, task: ids.t1 } },
      { _id: 'n6', type: 'deadline_approaching', message: '"Build login page" is due in 5 hours', isRead: false, createdAt: iso(-0.04), link: { workspace: ids.ws, project: ids.project, task: ids.t1 } },
      { _id: 'n7', type: 'deadline_overdue', message: '"Write tests" is overdue (it was due 2026-10-22)', isRead: false, createdAt: iso(-0.05), link: { workspace: ids.ws, project: ids.project, task: ids.t3 } },
    )
  }
  const project = () => ({ _id: ids.project, workspace: ids.ws, name: 'Demo Project', description: 'testing', template: 'web-app-starter', columns: ['Backlog', 'To Do', 'In Progress', 'Review', 'Testing', 'Done'], labels: ['auth', 'frontend'], milestones: state.milestones, isArchived: false })
  const workspace = { _id: ids.ws, name: 'My Test Workspace', description: 'ws', owner: ids.me, members: [{ user: ids.me, role }, { user: ids.other, role: 'Member' }] }
  const board = (q = {}) => {
    const by = {}
    for (const c of project().columns) by[c] = []
    state.tasks
      .filter((t) => (!q.priority || t.priority === q.priority) && (!q.search || t.title.toLowerCase().includes(String(q.search).toLowerCase())))
      .sort((a, b) => a.position - b.position)
      .forEach((t) => by[t.status].push(JSON.parse(JSON.stringify(t))))
    return { success: true, columns: project().columns, tasksByColumn: by }
  }
  const ok = (data, status = 200) => ({ data, status, statusText: 'OK', headers: {} })
  const err = (status, message) => { const e = new Error(message); e.response = { status, data: { success: false, message } }; return e }
  const P = ids.project
  const W = ids.ws

  api.defaults.adapter = async (config) => {
    const method = (config.method || 'get').toLowerCase()
    const url = config.url
    const params = config.params || {}
    let body = config.data
    if (typeof body === 'string') body = JSON.parse(body)
    else if (body instanceof FormData) body = { file: body.get('file') || body.get('avatar') }
    calls.push({ method, url, body, params, auth: config.headers?.Authorization })
    const fail = (e) => { e.config = config; return Promise.reject(e) }
    const is = (m, re) => method === m && re.test(url)
    const viewerBlocked = role === 'Viewer' && method !== 'get'
    const m = (re) => url.match(re)

    if (url === '/health') return ok({ success: true, database: 'connected' })
    if (url === '/auth/login') return ok({ success: true, token, user: { id: ids.me, name: 'Sunitha', email: 'sunitha@test.com', role: 'Member' } })
    if (url === '/workspaces' && method === 'get') return ok({ success: true, workspaces: state.workspaceDeleted ? [] : [JSON.parse(JSON.stringify(workspace))] })
    if (url === `/workspaces/${W}/presence`) return ok({ success: true, members: [{ user: me, hidden: false }, { user: other, hidden: true }] })
    if (url === `/workspaces/${W}/projects`) return ok({ success: true, projects: params.archived ? [] : [project()] })
    if (url === '/project-templates') return ok({ success: true, templates: [{ id: 'blank', name: 'Blank Project', description: 'Empty' }] })
    if (url === `/projects/${P}` && method === 'get') return ok({ success: true, project: project() })

    // board and tasks
    if (url === `/projects/${P}/board`) return ok(board(params))
    if (url === `/projects/${P}/board/reorder`) {
      if (failReorder) return fail(err(400, 'orderedTaskIds must include exactly the tasks currently in this column'))
      body.orderedTaskIds.forEach((id, i) => { state.tasks.find((x) => x._id === id).position = i })
      return ok({ success: true })
    }
    if (url === `/projects/${P}/tasks` && method === 'post') {
      const t = { _id: '6ac87dc3e1de3a64a30140b0', position: 9, labels: [], checklist: [], dependencies: [], reporter: ids.me, status: body.status || 'Backlog', ...body }
      state.tasks.push(t); return ok({ success: true, task: t }, 201)
    }
    let mm = m(/^\/tasks\/(\w+)(\/status|\/assign|\/comments|\/files)?$/)
    if (mm) {
      const t = state.tasks.find((x) => x._id === mm[1])
      const sub = mm[2]
      if (!sub && method === 'get') return ok({ success: true, task: { ...t, reporter: { _id: t.reporter, name: 'Someone' } }, blocks: [] })
      if (!sub && method === 'put') { Object.assign(t, body); return ok({ success: true, task: t }) }
      if (sub === '/status' && method === 'patch') {
        if (failMove) return fail(err(403, 'Viewers have read-only access'))
        t.status = body.status; if (body.position !== undefined) t.position = body.position
        return ok({ success: true, task: t, previousStatus: 'x' })
      }
      if (sub === '/assign' && method === 'patch') {
        t.assignee = body.assignee === ids.other ? other : body.assignee ? me : null
        return ok({ success: true, task: t })
      }
      if (sub === '/comments' && method === 'get') return ok({ success: true, comments: state.comments.filter((c) => c.task === mm[1]).map((c) => ({ ...c, files: state.files.filter((f) => f.comment === c._id) })) })
      if (sub === '/comments' && method === 'post') {
        if (viewerBlocked) return fail(err(403, 'Viewers have read-only access'))
        const c = { _id: `c${state.comments.length + 1}`, task: mm[1], author: me, text: body.text, parentComment: body.parentComment || null, reactions: [], createdAt: iso() }
        state.comments.push(c); return ok({ success: true, comment: c }, 201)
      }
      if (sub === '/files' && method === 'get') return ok({ success: true, files: state.files.filter((f) => f.task === mm[1]) })
      if (sub === '/files' && method === 'post') {
        const f = { _id: `f${state.files.length + 1}`, originalName: body.file.name, mimetype: body.file.type, size: body.file.size, uploadedBy: me, createdAt: iso(), task: mm[1], project: P }
        state.files.push(f); return ok({ success: true, file: f }, 201)
      }
    }
    mm = m(/^\/comments\/(\w+)\/files$/)
    if (mm && method === 'post') {
      if (viewerBlocked) return fail(err(403, 'Viewers cannot upload files'))
      const c = state.comments.find((x) => x._id === mm[1])
      if (!c) return fail(err(404, 'Comment not found'))
      if (state.files.filter((f) => f.comment === c._id).length >= 5) return fail(err(400, 'A comment can have at most 5 attachments'))
      if (body.file.name === 'bad.zip') return fail(err(400, 'This file type is not allowed'))
      const f = { _id: `cf${state.files.length + 1}`, originalName: body.file.name, mimetype: body.file.type, size: body.file.size, uploadedBy: ids.me, createdAt: iso(), comment: c._id }
      state.files.push(f); return ok({ success: true, file: f }, 201)
    }
    mm = m(/^\/comments\/(\w+)(\/reactions)?$/)
    if (mm) {
      const c = state.comments.find((x) => x._id === mm[1])
      if (mm[2]) {
        const r = c.reactions.find((x) => x.emoji === body.emoji) || (c.reactions.push({ emoji: body.emoji, users: [] }), c.reactions[c.reactions.length - 1])
        const at = r.users.indexOf(ids.me); if (at >= 0) r.users.splice(at, 1); else r.users.push(ids.me)
        return ok({ success: true, comment: c, reacted: at < 0 })
      }
      if (method === 'put') { c.text = body.text; c.editedAt = iso(); return ok({ success: true, comment: c }) }
      if (method === 'delete') { const before = state.comments.length; state.comments = state.comments.filter((x) => x._id !== c._id && x.parentComment !== c._id); return ok({ success: true, deletedCount: before - state.comments.length }) }
    }
    if (is('get', new RegExp(`^/projects/${P}/files$`))) return ok({ success: true, files: state.files })
    if (is('post', new RegExp(`^/projects/${P}/files$`))) {
      const f = { _id: `f${state.files.length + 1}`, originalName: body.file.name, mimetype: body.file.type, size: body.file.size, uploadedBy: me, createdAt: iso(), project: P }
      state.files.push(f); return ok({ success: true, file: f }, 201)
    }
    mm = m(/^\/files\/(\w+)(\/download)?$/)
    if (mm) {
      if (mm[2]) return ok(new Blob(['hello']))
      if (method === 'delete') { state.files = state.files.filter((f) => f._id !== mm[1]); return ok({ success: true }) }
    }

    // dashboard, search, notifications
    if (url === '/dashboard') {
      const t1 = { ...state.tasks[0], project: P, projectName: 'Demo Project' }
      return ok({ success: true, summary: { workspaces: 1, projects: 1, openTasks: 3, overdueTasks: 1, dueSoonTasks: 1, unreadNotifications: 2 }, myTasks: [t1], upcomingDeadlines: [t1], upcomingMilestones: [{ _id: 'm1', title: 'MVP', targetDate: iso(10), project: P, projectName: 'Demo Project' }], recentProjects: [{ _id: P, name: 'Demo Project', workspace: W, deadline: iso(30) }] })
    }
    if (url === '/search') {
      if (String(params.q).length < 2) return fail(err(400, 'q must be at least 2 characters'))
      return ok({ success: true, query: params.q, counts: {}, results: {
        projects: [{ _id: P, name: 'Demo Project', workspace: W }],
        tasks: [{ _id: ids.t1, title: 'Build login page', status: 'Backlog', priority: 'High', project: P, workspace: W }],
        comments: [{ _id: 'c1', text: 'First comment from me', task: ids.t1, taskTitle: 'Build login page' }],
        files: [{ _id: 'f1', originalName: 'spec.pdf', url: '/uploads/x', mimetype: 'application/pdf' }],
        users: [{ _id: ids.other, name: 'Test User Two', email: 'testuser2@test.com' }],
      } })
    }
    if (url === '/notifications' && method === 'get') {
      const list = params.unread ? state.notifications.filter((n) => !n.isRead) : state.notifications
      return ok({ success: true, notifications: list, total: list.length, page: 1, pages: 1, unreadCount: state.notifications.filter((n) => !n.isRead).length })
    }
    if (url === '/notifications/read-all') { state.notifications.forEach((n) => { n.isRead = true }); return ok({ success: true }) }
    mm = m(/^\/notifications\/(\w+)(\/read)?$/)
    if (mm) {
      if (mm[2]) { state.notifications.find((n) => n._id === mm[1]).isRead = true; return ok({ success: true }) }
      state.notifications = state.notifications.filter((n) => n._id !== mm[1]); return ok({ success: true })
    }

    // teams, milestones, calendar, activity, analytics
    if (url === `/workspaces/${W}/teams` && method === 'get') return ok({ success: true, teams: state.teams })
    if (url === `/workspaces/${W}/teams` && method === 'post') {
      const t = { _id: `team${state.teams.length + 1}`, name: body.name, description: body.description, members: [{ user: ids.me, role: 'Admin' }], createdBy: ids.me }
      state.teams.push(t); return ok({ success: true, team: t }, 201)
    }
    mm = m(/^\/teams\/(\w+)(?:\/(members|projects))?(?:\/(\w+))?$/)
    if (mm) {
      const t = state.teams.find((x) => x._id === mm[1])
      if (mm[2] === 'members' && method === 'post') { t.members.push({ user: body.userId, role: body.role }); return ok({ success: true, team: t }, 201) }
      if (mm[2] === 'members' && method === 'delete') { t.members = t.members.filter((x) => x.user !== mm[3]); return ok({ success: true, team: t }) }
      if (mm[2] === 'members' && method === 'put') { t.members.find((x) => x.user === mm[3]).role = body.role; return ok({ success: true, team: t }) }
      if (mm[2] === 'projects' && method === 'post') { state.projectTeams.push(t); return ok({ success: true }, 201) }
      if (mm[2] === 'projects' && method === 'delete') { state.projectTeams = state.projectTeams.filter((x) => x._id !== t._id); return ok({ success: true }) }
      if (!mm[2] && method === 'delete') { state.teams = state.teams.filter((x) => x._id !== t._id); return ok({ success: true }) }
    }
    if (url === `/projects/${P}/teams`) return ok({ success: true, teams: state.projectTeams })
    if (url === `/projects/${P}/milestones` && method === 'post') {
      const ms = { _id: `m${state.milestones.length + 1}`, completed: false, ...body }; state.milestones.push(ms); return ok({ success: true, milestone: ms }, 201)
    }
    mm = m(new RegExp(`^/projects/${P}/milestones/(\\w+)$`))
    if (mm) {
      const ms = state.milestones.find((x) => x._id === mm[1])
      if (method === 'put') { Object.assign(ms, body); return ok({ success: true, milestone: ms }) }
      if (method === 'delete') { state.milestones = state.milestones.filter((x) => x._id !== ms._id); return ok({ success: true }) }
    }
    if (url === `/projects/${P}/calendar` || url === `/workspaces/${W}/calendar`) {
      return ok({ success: true, view: params.view, range: {}, events: [
        { _id: ids.t1, type: 'task', title: 'Build login page', date: iso(0), priority: 'High', status: 'Backlog', project: P, projectName: 'Demo Project' },
        { _id: 'm1', type: 'milestone', title: 'MVP', date: iso(0), completed: false, project: P, projectName: 'Demo Project' },
      ] })
    }
    if (url === `/projects/${P}/activity` || url === `/workspaces/${W}/activity`) {
      if (params.before) return ok({ success: true, activities: state.activities.slice(2), count: 1, nextBefore: null })
      return ok({ success: true, activities: state.activities.slice(0, 2), count: 2, nextBefore: state.activities[1].createdAt })
    }
    if (url === `/projects/${P}/analytics`) {
      return ok({ success: true, project: { _id: P, name: 'Demo Project', deadline: iso(30) }, health: { status: 'at_risk', reasons: ['1 open task(s) overdue'] },
        totals: { tasks: 3, completed: 1, open: 2, overdue: 1, atRisk: 1, completionRate: 0.333, estimatedHours: 6, loggedHours: 4, byStatus: { Backlog: 2, Done: 1 }, byPriority: { High: 1 } },
        velocity: [{ weekStart: '2026-09-28', completedTasks: 0, completedHours: 0 }, { weekStart: '2026-10-05', completedTasks: 1, completedHours: 4 }],
        forecast: { projectedFinish: null, tasksPerWeek: null, onTime: false, note: null }, averageCompletionTime: { completedTasks: 1, averageHours: 168, averageDays: 7 },
        burn: { unit: 'tasks', days: 2, series: [{ date: '2026-10-09', scope: 3, completed: 0, remaining: 3, ideal: 3 }, { date: '2026-10-10', scope: 3, completed: 1, remaining: 2, ideal: 2.7 }] },
        workload: [{ assignee: me, openTasks: 1, openHours: 2, overdueTasks: 0, completedTasks: 1, overloaded: false }, { assignee: null, openTasks: 1, openHours: 0, overdueTasks: 1, completedTasks: 0, overloaded: true }],
        deadlineRisk: [{ _id: ids.t2, title: 'Add protected routes', status: 'Backlog', deadline: iso(-1), assignee: null, overdue: true, reasons: ['overdue'] }],
        teamActivity: { days: 7, members: [{ user: me, events: 5, completed: 2, collaboration: 2, planning: 1 }], others: { members: 1, events: 3 } } })
    }

    // people: presence, privacy, profile, contributions
    if (url === '/presence/heartbeat') return ok({ success: true, presence: { status: 'Active', source: 'auto' } })
    if (url === '/presence/me') return ok({ success: true, presence: { status: 'Active', source: 'auto', workMode: null, workModeSource: null, workingOn: null } })
    if (url === '/presence/status') return ok({ success: true, presence: { status: body.status || 'Active', source: 'manual', workMode: body.workMode || null, workModeSource: 'manual' } })
    if (url === '/settings/privacy' && method === 'get') return ok({ success: true, privacy: state.privacy })
    if (url === '/settings/privacy' && method === 'put') { Object.assign(state.privacy, body); return ok({ success: true, privacy: state.privacy }) }
    if (url === '/profile' && method === 'get') return ok({ success: true, emailVerified: verifiedOnServer, achievements: BADGES_RESPONSE, user: state.profile, workspaces: [{ _id: W, name: 'My Test Workspace' }], projects: [{ _id: P, name: 'Demo Project' }] })
    if (url === '/profile' && method === 'put') { Object.assign(state.profile, body); return ok({ success: true, user: state.profile }) }
    if (url === `/users/${ids.other}/profile`) return ok({ success: true, user: { ...other, bio: 'Teammate bio', skills: ['Node'], githubUsername: 'tester2' }, workspaces: [{ _id: ids.ws, name: 'My Test Workspace', role: 'Member' }], projects: [], achievements: achievements === 'shown' ? BADGES_RESPONSE : null, achievementsHidden: achievements !== 'shown' })
    mm = m(/^\/users\/(\w+)\/contributions(\/day)?$/)
    if (mm) {
      if (hiddenDots || mm[1] === ids.other) return fail(err(403, 'This user has not shared their activity with you'))
      if (mm[2]) return ok({ success: true, date: params.date, color: 'green', counts: {}, summary: '2 commits, 1 task completed', events: [{ _id: 'e1', type: 'commit_pushed', category: 'completed', message: 'committed "x" (abc1234)', createdAt: iso() }] })
      const names = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
      const colors = ['green', 'yellow', 'blue', 'gray', 'gray', 'gray', 'green']
      return ok({ success: true, user: me, weekStart: '2026-10-05', weekEnd: '2026-10-11', totals: {}, days: names.map((n, i) => ({ date: `2026-10-0${5 + i}`.replace('2026-10-010', '2026-10-10').replace('2026-10-011', '2026-10-11'), day: n, color: colors[i], counts: {}, total: i, summary: colors[i] === 'gray' ? '' : '2 commits' })) })
    }

    // github
    if (url === `/projects/${P}/github`) {
      if (method === 'get') return ok(state.github.linked ? { success: true, linked: true, link: { repo: 'sunithaa42/FlowSync', defaultBranch: 'main', linkedBy: me, lastSyncedAt: iso(-0.1), lastSyncSummary: githubExtras === 'some' ? { commits: 4, prsOpened: 1, prsMerged: 0, issuesOpened: 2, issuesClosed: 1, releases: 1, newBranches: 1 } : { commits: 4, prsOpened: 1, prsMerged: 0 }, ...(githubExtras === 'none' ? {} : { branchCount: 4, recentNewBranches: githubExtras === 'some' ? [{ name: 'feature/search', seenAt: iso(-0.2) }] : [] }) } } : { success: true, linked: false })
      if (method === 'post') {
        if (role === 'Viewer' || role === 'Member') return fail(err(403, 'Only Admin or Manager can link a repository'))
        if (body.token === 'github_pat_bad') return fail(err(400, 'GitHub rejected the token (wrong, expired or revoked)'))
        state.github.linked = true; return ok({ success: true, link: { repo: 'sunithaa42/FlowSync' } }, 201)
      }
      if (method === 'delete') { state.github.linked = false; return ok({ success: true, message: 'Repository unlinked. Activity already recorded is kept.' }) }
    }
    if (url === `/projects/${P}/github/sync`) {
      if (role === 'Viewer') return fail(err(403, 'Viewers cannot sync a repository'))
      return ok({ success: true, repo: 'sunithaa42/FlowSync', recorded: githubExtras === 'some' ? { commits: 2, prsOpened: 1, prsMerged: 0, issuesOpened: 2, issuesClosed: 1, releases: 1, newBranches: 1 } : { commits: 2, prsOpened: 1, prsMerged: 0 }, skippedAlreadyRecorded: 3,
        unavailable: githubExtras === 'denied' ? ['issues'] : [], notes: githubExtras === 'denied' ? ['Issues were not read. To include them, give the GitHub token read access to Issues.'] : [], newBranches: githubExtras === 'some' ? ['feature/search'] : [],
        skippedNoChanges: githubIgnored ? { commits: 2, pullRequests: 0, alreadyIgnored: 0 } : { commits: 0, pullRequests: 0, alreadyIgnored: 0 },
        tasksMoved: [{ ref: 'FS-0140ad', title: 'Build login page', from: 'Backlog', to: 'In Progress', because: 'commit 03914f7' }],
        taskLinkNotes: githubIgnored ? ['FS-0140ad: commit bbb2222 changes no files, so it did not move the task'] : ['FS-ffffff matches no active task in this project'], unmatchedGithubUsers: ['stranger'], lastSyncedAt: iso() })
    }
    if (url === `/projects/${P}/github/task-refs`) return ok({ success: true, howTo: 'x', tasks: state.tasks.map((t) => ({ _id: t._id, ref: `FS-${t._id.slice(-6)}`, title: t.title, status: t.status })) })


    // ---- FR22 settings, FR12 OCR, FR11 AI project generation ----
    if (url === '/settings' && method === 'get') return ok({ success: true, settings: state.settings, configured: false, privacy: state.privacy, visibilityLevels: ['everyone', 'team', 'managers', 'private'], languages: [{ id: 'en', label: 'English' }] })
    if (url === '/settings' && method === 'put') {
      const { notifications, statusVisibility, contributionVisibility, inferWorkMode, ...rest } = body
      Object.assign(state.settings, rest); if (notifications) Object.assign(state.settings.notifications, notifications)
      Object.assign(state.privacy, { ...(statusVisibility && { statusVisibility }), ...(contributionVisibility && { contributionVisibility }), ...(inferWorkMode !== undefined && { inferWorkMode }) })
      return ok({ success: true, settings: state.settings, configured: true, privacy: state.privacy })
    }
    if (url === '/ocr/extract') {
      if (ocrFail) return fail(err(422, 'The OCR engine could not process this image.'))
      return ok({ success: true, text: 'The system shall let students search and borrow books.', source: { name: body.file.name, size: body.file.size, method: 'docx', pages: null }, warnings: [] })
    }
    if (url === '/ai/generate-plan') {
      if (ai === 'off') { const e = err(503, 'AI project generation is not configured on this server. Set AI_API_KEY.'); e.response.data.aiUnavailable = true; return fail(e) }
      if (ai === 'junk') return fail(err(422, 'The AI response did not contain JSON.'))
      return ok({ success: true, warnings: ['Skipped task 3 because it had no title.'], plan: {
        name: 'Library System', description: 'Borrow and return books', objectives: ['Online catalogue'],
        milestones: [{ title: 'MVP', description: '', offsetDays: 14 }],
        tasks: [
          { title: 'Design database', description: 'ER diagram', priority: 'High', estimatedHours: 6, acceptanceCriteria: ['Schema approved'], subtasks: ['ER diagram'], labels: ['backend'], milestoneIndex: 0, dependsOn: [] },
          { title: 'Build search', description: '', priority: 'Medium', estimatedHours: 10, acceptanceCriteria: [], subtasks: [], labels: ['frontend'], milestoneIndex: 0, dependsOn: [0] },
        ], sprintPlan: [{ name: 'Sprint 1', taskIndices: [0, 1] }] } })
    }
    mm = m(/^\/workspaces\/(\w+)\/projects\/generate$/)
    if (mm && method === 'post') {
      if (role !== 'Admin' && role !== 'Manager') return fail(err(403, 'Only Admin or Manager can create projects'))
      const dup = state.generated[body.generationKey]
      if (dup) return ok({ success: true, project: dup, tasks: [], duplicate: true })
      const proj = { _id: ids.project, ...project(), name: body.plan.name }
      state.generated[body.generationKey] = proj
      return ok({ success: true, project: proj, tasks: body.plan.tasks }, 201)
    }

    // ---- FR25 task breakdown, FR23 stand-up report, FR24 sprint planning ----
    mm = m(/^\/tasks\/(\w+)\/ai\/breakdown$/)
    if (mm && method === 'post') {
      if (role === 'Viewer') return fail(err(403, 'You do not have permission to change this task'))
      if (breakdown === 'off') { const e = err(503, 'AI is not configured on this server. Set AI_API_KEY.'); e.response.data.aiUnavailable = true; return fail(e) }
      if (breakdown === 'junk') return fail(err(422, 'The AI did not return any usable new subtasks. Try again or add more detail to the task.'))
      return ok({ success: true, subtasks: [{ title: 'Design the login form' }, { title: 'Add JWT middleware' }, { title: 'Write password hashing' }], existingCount: 0 })
    }
    mm = m(/^\/projects\/(\w+)\/ai\/standup$/)
    if (mm && method === 'post') {
      const base = { windowHours: body.windowHours, since: iso(-1), until: iso(), team: { events: 5, tasksCompleted: 2, openTasks: 3, overdue: 1, blocked: 1, unassignedBlockers: ['"Orphan" is overdue'] } }
      if (standup === 'empty') return ok({ success: true, report: { ...base, source: 'rules', summary: 'No activity was recorded in the last 24 hours.', team: { events: 0, tasksCompleted: 0, openTasks: 0, overdue: 0, blocked: 0, unassignedBlockers: [] }, people: [] } })
      const people = [
        { userId: ids.me, name: 'Sunitha', text: standup === 'rules' || !body.useAi ? 'In the last 24 hours: 3 commits, completed 1 task.' : 'Shipped the login page and fixed two bugs.', counts: { commits: 3, tasksCompleted: 1, comments: 0 }, inProgress: ['Build login page'], blockers: ['"Search" is waiting on "Build login page"'] },
        { userId: ids.other, name: 'Test User Two', text: 'No recorded activity in the last 24 hours.', counts: { commits: 0 }, inProgress: [], blockers: [] },
      ]
      if (standup === 'rules' || !body.useAi) return ok({ success: true, report: { ...base, source: 'rules', ...(standup === 'rules' && body.useAi ? { aiError: 'The AI service returned an error (HTTP 503) for model main: high demand.' } : {}), summary: 'In the last 24 hours there were 5 activity events from 2 people.', people } })
      return ok({ success: true, report: { ...base, source: 'ai', summary: 'A productive day with the login work finished.', people } })
    }
    mm = m(/^\/projects\/(\w+)\/ai\/sprint-plan$/)
    if (mm && method === 'post') {
      if (role === 'Viewer') return fail(err(403, 'Viewers have read-only access'))
      const capacityHours = (body.people || 3) * body.hoursPerPerson
      const aiPart = !body.useAi ? { used: false, requested: false } : sprint === 'ai-down' ? { used: false, error: 'The AI service timed out. Please try again.' } : { used: true, goal: 'Ship a working login.', summary: 'Focus on the auth tasks first.', risks: ['Task 2 has no estimate'] }
      if (sprint === 'empty') return ok({ success: true, settings: { sprintDays: body.sprintDays, people: 3, hoursPerPerson: body.hoursPerPerson, capacityHours }, sprint: { days: body.sprintDays, capacityHours, plannedHours: 0, remainingHours: capacityHours, utilisation: 0, tasks: [] }, deferred: [], backlogCount: 0, warnings: ['The Backlog column is empty, so there is nothing to plan.'], ai: { used: false, requested: !!body.useAi } })
      return ok({ success: true, settings: { sprintDays: body.sprintDays, people: body.people || 3, hoursPerPerson: body.hoursPerPerson, capacityHours },
        sprint: { days: body.sprintDays, capacityHours, plannedHours: 6, remainingHours: capacityHours - 6, utilisation: 6 / capacityHours, tasks: [
          { _id: ids.t1, title: 'Build login page', priority: 'High', estimatedHours: 4, assumedEstimate: false, deadline: iso(3), dependsOn: [] },
          { _id: ids.t2, title: 'Add protected routes', priority: 'Medium', estimatedHours: 2, assumedEstimate: true, deadline: null, dependsOn: ['Build login page'] } ] },
        deferred: [{ _id: ids.t3, title: 'Write tests', priority: 'Low', estimatedHours: 40, assumedEstimate: false, reason: 'Needs 40 h, more than the whole sprint (30 h). Split it into smaller tasks' }],
        backlogCount: 3, warnings: ['1 task has no estimate, so 4 h was assumed for each.'], ai: aiPart })
    }
    mm = m(/^\/projects\/(\w+)\/sprint\/apply$/)
    if (mm && method === 'post') {
      if (role !== 'Admin' && role !== 'Manager') return fail(err(403, 'Only Admin or Manager can start a sprint'))
      return ok({ success: true, target: 'To Do', moved: body.taskIds.map((id) => ({ _id: id, title: 'Moved task' })), skipped: [] })
    }

    // ---- FR26 channels, FR27 live messaging ----
    const chatMsg = (channel, author, text, over = {}) => { state.seq += 1; return { _id: `m${String(state.seq).padStart(4, '0')}`, channel, author: { _id: author._id, name: author.name }, text, deleted: false, reactions: [], editedAt: null, createdAt: iso(-0.01 * (100 - state.seq)), ...over } }
    if (!state.chatSeeded) {
      state.chatSeeded = true
      if (manyMessages) for (let i = 1; i <= 60; i += 1) state.messages.push(chatMsg('ch-general', i % 2 ? other : me, `old message ${i}`))
      else {
        state.messages.push(chatMsg('ch-general', other, 'Welcome everyone'))
        state.messages.push(chatMsg('ch-general', me, 'Thanks!'))
        state.messages.push(chatMsg('ch-general', other, 'Standup at 10'))
      }
      if (seedReactions) state.messages.find((x) => x.text === 'Welcome everyone').reactions = [{ emoji: '👍', users: [ids.other] }, { emoji: '🎉', users: [ids.me, ids.other] }]
      if (botMessage) state.messages.push({ _id: 'mbot1', channel: 'ch-general', bot: true, author: { _id: 'flowsync-bot', name: 'FlowSync' }, text: '✅ "Build login page" is Done', deleted: false, reactions: [], editedAt: null, createdAt: iso(-0.001) })
    }
    const isManagerRole = role === 'Admin' || role === 'Manager'
    if (url === `/workspaces/${W}/channels` && method === 'get') return ok({ success: true, channels: JSON.parse(JSON.stringify(state.channels)), canPost: role !== 'Viewer', canManage: isManagerRole })
    if (url === `/workspaces/${W}/channels` && method === 'post') {
      if (!isManagerRole) return fail(err(403, 'Only Admin or Manager can create channels'))
      const name = String(body.name || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/^#/, '')
      if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) return fail(err(400, 'Channel names use lowercase letters, numbers and dashes, start with a letter or number, and are at most 40 characters'))
      if (state.channels.some((c) => c.name === name)) return fail(err(409, 'A channel with that name already exists'))
      const channel = { _id: `ch-${name}`, name, description: body.description || '', kind: 'custom', project: null, unread: 0, lastMessage: null }
      state.channels.push(channel)
      return ok({ success: true, channel }, 201)
    }
    mm = m(/^\/channels\/([\w-]+)\/messages$/)
    if (mm && method === 'get') {
      const all = state.messages.filter((x) => x.channel === mm[1])
      const limit = Number(params.limit) || 50
      let list
      if (params.after) list = all.filter((x) => x._id > params.after).slice(0, limit)
      else { const older = params.before ? all.filter((x) => x._id < params.before) : all; list = older.slice(-limit) }
      const hasMore = params.after ? false : (params.before ? all.filter((x) => x._id < params.before).length : all.length) > limit
      return ok({ success: true, messages: JSON.parse(JSON.stringify(list)), hasMore })
    }
    if (mm && method === 'delete') {
      if (!isManagerRole) return fail(err(403, 'Only Admin or Manager can clear a channel'))
      const before = state.messages.length
      state.messages = state.messages.filter((x) => x.channel !== mm[1])
      return ok({ success: true, deleted: before - state.messages.length })
    }
    if (mm && method === 'post') {
      if (role === 'Viewer') return fail(err(403, 'Viewers can read messages but not post'))
      if (!String(body.text || '').trim()) return fail(err(400, 'A message cannot be empty'))
      const msg = chatMsg(mm[1], me, String(body.text).trim(), { createdAt: iso(0) })
      state.messages.push(msg)
      return ok({ success: true, message: msg }, 201)
    }
    mm = m(/^\/messages\/([\w-]+)\/reactions$/)
    if (mm && method === 'post') {
      const msg = state.messages.find((x) => x._id === mm[1])
      if (!msg) return fail(err(404, 'Message not found'))
      if (role === 'Viewer') return fail(err(403, 'Viewers can read messages but not react'))
      if (msg.deleted) return fail(err(400, 'This message was deleted'))
      if (!['👍', '❤️', '🎉', '👀'].includes(body.emoji)) return fail(err(400, 'emoji must be one of 👍 ❤️ 🎉 👀'))
      const entry = msg.reactions.find((r) => r.emoji === body.emoji)
      let reacted = true
      if (!entry) msg.reactions.push({ emoji: body.emoji, users: [ids.me] })
      else if (entry.users.includes(ids.me)) { entry.users = entry.users.filter((u) => u !== ids.me); reacted = false }
      else entry.users.push(ids.me)
      msg.reactions = msg.reactions.filter((r) => r.users.length > 0)
      return ok({ success: true, message: JSON.parse(JSON.stringify(msg)), reacted })
    }
    mm = m(/^\/channels\/([\w-]+)$/)
    if (mm && method === 'patch') {
      if (!isManagerRole) return fail(err(403, 'Only Admin or Manager can change channels'))
      const c = state.channels.find((x) => x._id === mm[1])
      if (!c) return fail(err(404, 'Channel not found'))
      if (c.kind !== 'custom') return fail(err(400, 'This channel is managed by FlowSync and cannot be changed'))
      if (body.name !== undefined) {
        const name = String(body.name).trim().toLowerCase().replace(/\s+/g, '-').replace(/^#/, '')
        if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(name)) return fail(err(400, 'Channel names use lowercase letters, numbers and dashes, start with a letter or number, and are at most 40 characters'))
        if (state.channels.some((x) => x.name === name && x._id !== c._id)) return fail(err(409, 'A channel with that name already exists'))
        c.name = name
      }
      if (body.description !== undefined) c.description = String(body.description).trim()
      return ok({ success: true, channel: JSON.parse(JSON.stringify(c)), archived: false })
    }
    if (mm && method === 'delete') {
      if (!isManagerRole) return fail(err(403, 'Only Admin or Manager can delete channels'))
      const c = state.channels.find((x) => x._id === mm[1])
      if (!c) return fail(err(404, 'Channel not found'))
      if (c.kind !== 'custom') return fail(err(400, 'This channel is managed by FlowSync and cannot be deleted. You can clear its messages instead.'))
      state.channels = state.channels.filter((x) => x._id !== c._id)
      state.messages = state.messages.filter((x) => x.channel !== c._id)
      return ok({ success: true })
    }
    mm = m(/^\/channels\/([\w-]+)\/read$/)
    if (mm && method === 'post') { const c = state.channels.find((x) => x._id === mm[1]); if (c) c.unread = 0; return ok({ success: true }) }
    mm = m(/^\/messages\/([\w-]+)$/)
    if (mm && method === 'patch') {
      const msg = state.messages.find((x) => x._id === mm[1])
      if (!msg || msg.author._id !== ids.me) return fail(err(403, 'You can only edit your own messages'))
      msg.text = String(body.text).trim(); msg.editedAt = iso(0)
      return ok({ success: true, message: JSON.parse(JSON.stringify(msg)) })
    }
    if (mm && method === 'delete') {
      const msg = state.messages.find((x) => x._id === mm[1])
      if (!msg || (msg.author._id !== ids.me && !isManagerRole)) return fail(err(403, 'You can only delete your own messages'))
      msg.deleted = true; msg.text = ''
      return ok({ success: true })
    }

    // ---- FR1 email links and password reset, FR2 workspace settings ----
    if (url === '/auth/forgot-password' && method === 'post') {
      if (!/^\S+@\S+\.\S+$/.test(String(body.email || ''))) return fail(err(400, 'Enter a valid email address'))
      return ok({ success: true, message: 'If that email is registered, a reset link has been sent. Check your inbox.' })
    }
    if (url === '/auth/reset-password' && method === 'post') {
      if (String(body.password || '').length < 8) return fail(err(400, 'Password must be at least 8 characters'))
      if (body.token !== 'a'.repeat(64)) return fail(err(400, 'This reset link is invalid or has expired'))
      return ok({ success: true, message: 'Your password was changed. You can sign in now.' })
    }
    if (url === '/auth/verify-email' && method === 'post') {
      if (body.token !== 'b'.repeat(64)) return fail(err(400, 'This verification link is invalid or has expired'))
      return ok({ success: true, message: 'Your email address is confirmed.' })
    }
    if (url === '/auth/resend-verification' && method === 'post') {
      if (resend === 'limit') return fail(err(429, 'Too many emails requested. Please wait 600 seconds.'))
      return ok({ success: true, message: 'A new confirmation link was sent. Check your inbox.' })
    }
    const adminsNow = () => workspace.members.filter((x) => x.role === 'Admin').length
    if (url === `/workspaces/${W}` && method === 'patch') {
      if (!isManagerRole) return fail(err(403, 'Only Admin or Manager can change workspace settings'))
      const name = String(body.name || '').trim()
      if (!name) return fail(err(400, 'Workspace name is required'))
      workspace.name = name; workspace.description = String(body.description || '').trim()
      return ok({ success: true, workspace: JSON.parse(JSON.stringify(workspace)) })
    }
    if (url === `/workspaces/${W}` && method === 'delete') {
      if (role !== 'Admin') return fail(err(403, 'Only Admin can delete a workspace'))
      if (body.confirmName !== workspace.name) return fail(err(400, 'Type the exact workspace name to confirm the deletion'))
      state.workspaceDeleted = true
      return ok({ success: true, deleted: { projects: 1 } })
    }
    mm = m(/^\/workspaces\/(\w+)\/members\/(\w+)$/)
    if (mm && method === 'patch') {
      if (role !== 'Admin') return fail(err(403, 'Only Admin can change roles'))
      const target = workspace.members.find((x) => String(x.user) === mm[2])
      if (!target) return fail(err(404, 'That person is not a member of this workspace'))
      if (target.role === 'Admin' && body.role !== 'Admin' && adminsNow() === 1) return fail(err(400, 'A workspace must keep at least one Admin. Make someone else Admin first.'))
      target.role = body.role
      return ok({ success: true, workspace: JSON.parse(JSON.stringify(workspace)) })
    }

    // ---- FR21 profile picture ----
    if (url === '/profile/avatar' && method === 'post') {
      if (avatarFail) return fail(err(400, 'The file is not a PNG, JPEG, GIF or WebP picture'))
      state.profile.avatarUrl = '/avatars/me-0123456789abcdef.png'
      return ok({ success: true, user: { avatarUrl: state.profile.avatarUrl } })
    }
    if (url === '/profile/avatar' && method === 'delete') { state.profile.avatarUrl = ''; return ok({ success: true, user: { avatarUrl: '' } }) }

    return fail(err(404, `unmocked ${method} ${url}`))
  }
  return { calls, state, forceUnauthorized: () => { api.defaults.adapter = async (config) => { const e = err(401, 'Invalid or expired token'); e.config = config; return Promise.reject(e) } } }
}
