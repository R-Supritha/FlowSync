# FlowSync client: foundation + workspaces, projects and board

Drop-in replacement for the Vite scaffold in `client/`. Nothing here touches the server.

## Install

1. Copy `client/src/`, `client/index.html` and `client/.env.example` over your `client/` folder.
2. Delete the old scaffold files: `src/App.css`, `src/assets/` (nothing imports them now).
3. `cp .env.example .env` and set `VITE_API_URL` (default `http://localhost:5000/api`).
4. `npm install && npm run lint && npm run dev`

No new dependencies. It uses what `package.json` already lists (React 19, Redux Toolkit, react-router-dom, axios).

## Not run end to end

The sandbox it was written in could not reach the npm registry, so `npm run build`, `npm run lint`
and a live run against your API never happened. What was checked: every file parses, and all
internal imports and named exports resolve (an esbuild bundle with third-party packages left external).
Expect to fix small lint nits (the repo uses the strict react-hooks v7 rules) on the first run.

## What is in this drop

Phase 1 (foundation): 4 themes + system default as CSS variables, IDE shell (title bar, activity bar,
sidebar, main, bottom panel, status bar), axios layer (token, 401 sign-out, friendly 429), Redux slices,
login/register, protected routes, not-found, toasts, confirm dialogs, Ctrl+B / Ctrl+J.

Phase 2, partly: workspaces (list, switch, create, members, invite, remove), projects (list,
archived toggle, create with template, edit, archive/restore, delete with confirm), Kanban board
(columns, cards with badges, drag and drop with rollback, filters, list view, manage columns),
task drawer (edit fields, checklist, status, assignee, archive, delete, dependencies, copy `FS-xxxxxx`).

## Not in this drop

Comments, files, task history and the drawer's GitHub section; milestones UI; teams; dashboard;
notifications; search (Ctrl+K box is disabled); activity feed; presence selector and heartbeat;
calendar; analytics; profile; settings; GitHub panel; AI screens. The activity-bar icons for these
are greyed out.

## Things worth knowing about the backend

- Login with wrong credentials returns 401, so the 401 sign-out skips `/auth/*`.
- Workspace members come back as bare ids. Names are joined in from `GET /workspaces/:id/presence`.
- `PATCH /projects/:id/board/reorder` requires every task in the column, archived ones included, but
  `GET .../board` hides archived tasks. A column holding an archived task can refuse same-column
  reordering (the card snaps back and a toast shows the server message). Cross-column moves keep the
  move even if that reorder is refused.
- Because reorder needs the full column, drag and drop is disabled while any filter is active.
- Only Admin/Manager can create projects; the "New project" buttons are hidden for other roles.
- Rate limit is 100 requests / 15 min for most routes. The API health check in the status bar polls once a minute.
