# FlowSync frontend: complete

This is your teammate's client plus everything that was missing, so every icon in the app now works.
It is a drop-in replacement for `client/src`. No new runtime dependencies.

## Install

1. Copy `client/src/`, `client/index.html` and `client/.env.example` over your `client/` folder.
2. Delete `src/App.css` and `src/assets/` if they are still there.
3. Copy `.env.example` to `.env` (the default `http://localhost:5000/api` is right for local use).
4. `npm install` then `npm run dev`, with the API running.

Optional automatic tests (62 checks): copy `client/review/` and `client/vitest.config.js` too, then
`npm install -D vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event`
and run `npx vitest run`.

## Screens and where they are

| Address | What | FR |
| --- | --- | --- |
| `/login`, `/register` | Sign in, create an account | FR1 |
| `/` | Dashboard: counts, my tasks, deadlines, milestones, recent projects | FR18 |
| `/projects` | Project list, create from a template, edit, archive, delete | FR3 |
| `/members` | Workspace members, invite, remove | FR2 |
| `/teams` | Create teams, add members, change team roles, delete | FR4 |
| `/projects/:id/board` | Kanban board, drag and drop, filters, list view, columns, task drawer | FR5, FR6 |
| task drawer | Edit fields, assign, milestone, checklist, **comments** (threads, @mentions, reactions), **files** | FR8, FR9 |
| `/projects/:id/calendar`, `/calendar` | Week and month view, project or whole workspace | FR7 |
| `/projects/:id/files` | Project files: upload, download, delete | FR9 |
| `/projects/:id/milestones` | Add, edit, complete, delete | FR3 |
| `/projects/:id/teams` | Assign and unassign teams | FR4 |
| `/projects/:id/github` | Link a repository, sync, results, task references, unlink | FR13, FR14 |
| `/projects/:id/activity`, `/activity` | Activity feed with load more | FR15 |
| `/projects/:id/analytics`, `/analytics` | Health, totals, charts, workload, risks, forecast | FR19 |
| bell in the title bar, `/notifications` | Unread count, mark read, delete | FR10 |
| Ctrl+K or the search box | Search projects, tasks, comments, files, people | FR20 |
| `/profile`, `/users/:id` | Edit your profile, view a teammate's, with the weekly dots | FR16, FR21 |
| bottom panel (Ctrl+J) | Activity feed and "My week" dots | FR15, FR16 |
| status and work mode in the title bar | Heartbeat and manual status | FR17 |
| `/settings` | Theme, text size, privacy | FR22 (part) |

A task deep link works everywhere: `/projects/:id/board?task=TASK_ID` opens the board with that task's drawer.
The dashboard, search results and notifications all use it.

## What changed in your teammate's code

- Changing the assignee in the drawer now uses the assign call, so the new assignee gets a notification and the feed gets an "assigned" line.
- Dialogs: Escape closes only the top dialog, focus moves into it and stays there, `aria-modal` is set.
- The open task is kept in the address (`?task=`), so it can be linked to.
- The health check polls every 2 minutes instead of every minute.

## Two small server changes recommended (not part of this zip)

1. `src/controllers/kanbanController.js`, in `reorderColumn`: the check counts archived tasks but the board hides them,
   so reordering a column that holds an archived task can be refused. Change
   `Task.find({ project: project._id, status }).select('_id')` to
   `Task.find({ project: project._id, status, isArchived: false }).select('_id')`.
2. `src/server.js`: the limit is 100 requests per 15 minutes per computer. The app now also checks
   notifications (every 90 s), sends a heartbeat (every 2 min) and checks health (every 2 min), so a busy
   session can reach it. Change `limit: 100` to `limit: Number(process.env.RATE_LIMIT) || 100` and put
   `RATE_LIMIT=1000` in your local `.env`.

## What was checked

Lint is clean, the production build compiles, and 62 checks pass in a simulated browser against a pretend API that
returns the exact response shapes the real server returned in our tests. They cover every screen above, role
differences (Admin, Member, Viewer), error messages, deep links, uploads, and no React warnings.

Not checked: how it looks on a real screen, real drag and drop in a browser, and a live run against your API.

## Still not possible (needs the backend first)

Forgot and reset password; renaming or deleting a workspace and changing a member's workspace role; uploading a
profile picture (only a link works); notification and language settings; deadline and status notifications;
live updates of the feed (use Refresh); the AI screens (FR11, FR12, FR23, FR24, FR25).
