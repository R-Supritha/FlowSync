// FR24: propose which Backlog tasks fit the next sprint.
// The PLAN is computed by rules (priority, deadline, dependencies, capacity), so it can never exceed the
// capacity or start a task before its prerequisites. The AI only adds an optional goal, summary and risks.
const { generateJson } = require('./aiService');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_ESTIMATE_HOURS = 4; // used for tasks that have no estimate
const PRIORITY_WEIGHT = { High: 3, Medium: 2, Low: 1 };
const BACKLOG = 'Backlog';
const DONE = 'Done';

const idOf = (v) => String((v && v._id) || v || '');
const round1 = (n) => Math.round(n * 10) / 10;

// Checks and normalises the sprint settings from the request. Returns { value } or { error }.
function parseSprintSettings(body = {}, defaultPeople = 1) {
  const num = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));
  const sprintDays = num(body.sprintDays) ?? 14;
  const hoursPerPerson = num(body.hoursPerPerson) ?? 30;
  const people = num(body.people) ?? Math.max(1, defaultPeople);
  let capacityHours = num(body.capacityHours);

  if (!Number.isFinite(sprintDays) || sprintDays < 1 || sprintDays > 60) return { error: 'sprintDays must be between 1 and 60' };
  if (!Number.isFinite(people) || people < 1 || people > 50 || !Number.isInteger(people)) return { error: 'people must be a whole number between 1 and 50' };
  if (!Number.isFinite(hoursPerPerson) || hoursPerPerson < 0.5 || hoursPerPerson > 200) return { error: 'hoursPerPerson must be between 0.5 and 200' };
  if (capacityHours === undefined) capacityHours = people * hoursPerPerson;
  if (!Number.isFinite(capacityHours) || capacityHours <= 0 || capacityHours > 5000) return { error: 'capacityHours must be between 1 and 5000' };

  return { value: { sprintDays, people, hoursPerPerson, capacityHours: round1(capacityHours) } };
}

// tasks: every non-archived task of the project:
//   { _id, title, status, priority, estimatedHours, deadline, position, dependencies: [id] }
function planSprint({ tasks, capacityHours, sprintDays, now = new Date() }) {
  const byId = new Map(tasks.map((t) => [idOf(t), t]));
  const horizon = now.getTime() + sprintDays * DAY_MS;
  const backlog = tasks.filter((t) => t.status === BACKLOG);
  let assumed = 0;

  const info = (t) => {
    const hasEstimate = Number(t.estimatedHours) > 0;
    if (!hasEstimate) assumed += 1;
    return { hours: hasEstimate ? Number(t.estimatedHours) : DEFAULT_ESTIMATE_HOURS, assumedEstimate: !hasEstimate };
  };
  const meta = new Map(backlog.map((t) => [idOf(t), info(t)]));

  // Priority first, then deadlines that fall inside the sprint, then earlier deadlines, then board order.
  const urgent = (t) => (t.deadline && new Date(t.deadline).getTime() <= horizon ? 1 : 0);
  const sorted = [...backlog].sort((a, b) =>
    (PRIORITY_WEIGHT[b.priority] || 2) - (PRIORITY_WEIGHT[a.priority] || 2)
    || urgent(b) - urgent(a)
    || (a.deadline ? new Date(a.deadline).getTime() : Infinity) - (b.deadline ? new Date(b.deadline).getTime() : Infinity)
    || (a.position || 0) - (b.position || 0)
    || String(a.title).localeCompare(String(b.title)));

  const selected = [];
  const selectedIds = new Set();
  let remaining = capacityHours;
  const ready = (t) => (t.dependencies || []).every((d) => {
    const dep = byId.get(idOf(d));
    return !dep || dep.status === DONE || selectedIds.has(idOf(dep));
  });

  // Take the best ready task that fits, then start again from the top (a pick can unlock others).
  for (;;) {
    const next = sorted.find((t) => !selectedIds.has(idOf(t)) && ready(t) && meta.get(idOf(t)).hours <= remaining + 1e-9);
    if (!next) break;
    selected.push(next);
    selectedIds.add(idOf(next));
    remaining -= meta.get(idOf(next)).hours;
  }

  const deferredReason = (t) => {
    const waiting = (t.dependencies || []).map((d) => byId.get(idOf(d))).filter((d) => d && d.status !== DONE && !selectedIds.has(idOf(d)));
    if (waiting.length) {
      return `Waiting on ${waiting.map((d) => `"${d.title}" (${d.status === BACKLOG ? 'not in this sprint' : d.status})`).join(', ')}`;
    }
    const { hours } = meta.get(idOf(t));
    if (hours > capacityHours) return `Needs ${hours} h, more than the whole sprint (${capacityHours} h). Split it into smaller tasks`;
    return `Needs ${hours} h but only ${round1(Math.max(remaining, 0))} h are left`;
  };

  const present = (t) => {
    const m = meta.get(idOf(t));
    return {
      _id: idOf(t),
      title: t.title,
      priority: t.priority || 'Medium',
      estimatedHours: m.hours,
      assumedEstimate: m.assumedEstimate,
      deadline: t.deadline || null,
    };
  };

  const plannedHours = round1(capacityHours - Math.max(remaining, 0));
  const warnings = [];
  if (assumed) warnings.push(`${assumed} ${assumed === 1 ? 'task has' : 'tasks have'} no estimate, so ${DEFAULT_ESTIMATE_HOURS} h was assumed for each.`);
  if (backlog.length === 0) warnings.push('The Backlog column is empty, so there is nothing to plan.');

  return {
    sprint: {
      days: sprintDays,
      capacityHours,
      plannedHours,
      remainingHours: round1(Math.max(remaining, 0)),
      utilisation: capacityHours ? Math.min(1, plannedHours / capacityHours) : 0,
      tasks: selected.map((t) => ({
        ...present(t),
        dependsOn: (t.dependencies || []).map((d) => byId.get(idOf(d))).filter((d) => d && d.status !== DONE).map((d) => d.title),
      })),
    },
    deferred: sorted.filter((t) => !selectedIds.has(idOf(t))).map((t) => ({ ...present(t), reason: deferredReason(t) })),
    backlogCount: backlog.length,
    warnings,
  };
}

const SYSTEM_PROMPT = `You help a team lead describe a proposed sprint. The plan is already decided: do not change it.
Return JSON only, with exactly this shape:
{ "goal": "one sentence", "summary": "2 sentences", "risks": ["short risk", "..."] }

Rules:
- Base everything on the plan JSON. Never invent tasks, numbers or people.
- At most 3 risks (for example: tasks without estimates, a big task, important tasks deferred, a tight deadline).
- Plain, friendly tone. No markdown.`;

const clip = (value, max) => String(value || '').trim().slice(0, max);

function sanitizeNarrative(raw) {
  const risks = (raw && Array.isArray(raw.risks) ? raw.risks : []).map((r) => clip(r, 200)).filter(Boolean).slice(0, 3);
  const out = { goal: clip(raw && raw.goal, 240), summary: clip(raw && raw.summary, 500), risks };
  if (!out.goal && !out.summary && !risks.length) throw new Error('The AI reply had no usable text.');
  return out;
}

// Optional extra. Never throws: returns { used: false, error } when the AI cannot be used.
async function sprintNarrative({ plan, projectName }) {
  try {
    const compact = {
      project: projectName,
      days: plan.sprint.days,
      capacityHours: plan.sprint.capacityHours,
      plannedHours: plan.sprint.plannedHours,
      selected: plan.sprint.tasks.map((t) => ({ title: t.title, priority: t.priority, hours: t.estimatedHours, assumedEstimate: t.assumedEstimate, deadline: t.deadline })),
      deferred: plan.deferred.slice(0, 12).map((t) => ({ title: t.title, priority: t.priority, hours: t.estimatedHours, reason: t.reason })),
    };
    const raw = await generateJson({ system: SYSTEM_PROMPT, user: `PLAN:\n${JSON.stringify(compact)}` }, { timeoutMs: 45 * 1000 });
    return { used: true, ...sanitizeNarrative(raw) };
  } catch (error) {
    return { used: false, error: String(error.message || 'The AI could not be used.').slice(0, 300) };
  }
}

module.exports = { planSprint, parseSprintSettings, sprintNarrative, sanitizeNarrative, DEFAULT_ESTIMATE_HOURS };
