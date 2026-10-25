// FR25: break ONE task into smaller subtasks with the AI. Nothing is saved here: the caller shows the
// suggestions and the person chooses which ones to keep.
const { generateJson, AiInvalidResponseError } = require('./aiService');

const MAX_SUBTASKS = 10;
const MAX_TITLE = 120;

const SYSTEM_PROMPT = `You break ONE task of a software project into smaller, concrete subtasks.
Return JSON only, with exactly this shape:
{ "subtasks": [ { "title": "short imperative title" } ] }

Rules:
- 3-8 subtasks, in the order they should be done.
- Each title is concrete and actionable (start with a verb) and at most 100 characters.
- Do not repeat the parent task's title, and do not repeat the existing subtasks listed.
- No prose and no markdown.`;

function asText(value, max) {
  const s = value === undefined || value === null ? '' : String(value).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function buildBreakdownPrompt({ project, task, hint }) {
  const lines = [
    `Project: ${asText(project && project.name, 120)}`,
    project && project.description ? `Project description: ${asText(project.description, 500)}` : null,
    `Task to break down: ${asText(task.title, 200)}`,
    task.description ? `Task description: ${asText(task.description, 1500)}` : null,
  ];
  const criteria = (task.checklist || []).map((c) => asText(c.text, 160)).filter(Boolean).slice(0, 12);
  if (criteria.length) lines.push(`Acceptance criteria / checklist:\n- ${criteria.join('\n- ')}`);
  const existing = (task.subtasks || []).map((s) => asText(s.title, 160)).filter(Boolean).slice(0, 20);
  if (existing.length) lines.push(`Existing subtasks (do not repeat):\n- ${existing.join('\n- ')}`);
  if (hint) lines.push(`Extra guidance from the user: ${asText(hint, 300)}`);
  return lines.filter(Boolean).join('\n');
}

// Accepts strings or { title } objects. Drops blanks, duplicates, repeats of the parent title
// and of the existing subtasks. Throws AiInvalidResponseError when nothing usable is left.
function sanitizeBreakdown(raw, { parentTitle = '', existing = [] } = {}) {
  const list = raw && Array.isArray(raw.subtasks) ? raw.subtasks : null;
  if (!list) throw new AiInvalidResponseError('The AI response did not contain a list of subtasks.');

  const seen = new Set([String(parentTitle).trim().toLowerCase(), ...existing.map((t) => String(t).trim().toLowerCase())]);
  const subtasks = [];
  for (const item of list) {
    const title = asText(typeof item === 'string' ? item : item && item.title, MAX_TITLE).replace(/\s+/g, ' ');
    const key = title.toLowerCase();
    if (!title || seen.has(key)) continue;
    seen.add(key);
    subtasks.push({ title });
    if (subtasks.length >= MAX_SUBTASKS) break;
  }
  if (!subtasks.length) throw new AiInvalidResponseError('The AI did not return any usable new subtasks. Try again or add more detail to the task.');
  return { subtasks };
}

async function breakdownTask({ project, task, hint }) {
  const raw = await generateJson(
    { system: SYSTEM_PROMPT, user: buildBreakdownPrompt({ project, task, hint }) },
    { timeoutMs: 90 * 1000 }
  );
  return sanitizeBreakdown(raw, {
    parentTitle: task.title,
    existing: (task.subtasks || []).map((s) => s.title),
  });
}

module.exports = { breakdownTask, sanitizeBreakdown, buildBreakdownPrompt, MAX_SUBTASKS };
