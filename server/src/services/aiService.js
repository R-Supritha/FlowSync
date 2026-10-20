// Configurable server-side AI integration.
// Supports Google Gemini (native generateContent API) and any OpenAI-compatible
// chat-completions API. The API key never reaches the frontend; everything runs
// behind authenticated routes.
//
// Env vars: AI_PROVIDER ('gemini' | 'openai'), AI_API_KEY, AI_MODEL, AI_BASE_URL.

const PRIORITIES = ['Low', 'Medium', 'High'];

const MAX_TASKS = 40;
const MAX_MILESTONES = 12;
const MAX_REQUIREMENTS_CHARS = 40000;

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const GEMINI_MODEL = 'gemini-2.5-flash';

class AiUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiUnavailableError';
  }
}

class AiInvalidResponseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AiInvalidResponseError';
  }
}

// AI_PROVIDER wins; otherwise a Google base URL implies Gemini, else OpenAI-compatible.
function resolveProvider() {
  const explicit = String(process.env.AI_PROVIDER || '').toLowerCase();
  if (explicit === 'gemini' || explicit === 'openai') return explicit;
  if (String(process.env.AI_BASE_URL || '').includes('generativelanguage.googleapis.com')) return 'gemini';
  return 'openai';
}

function aiConfig() {
  const provider = resolveProvider();
  const isGemini = provider === 'gemini';
  const baseUrl = (
    process.env.AI_BASE_URL || (isGemini ? GEMINI_BASE_URL : DEFAULT_BASE_URL)
  )
    .replace(/\/+$/, '')
    .replace(/\/openai$/, ''); // tolerate Gemini's OpenAI-compat URL being pasted in
  return {
    provider,
    key: process.env.AI_API_KEY,
    baseUrl,
    model: process.env.AI_MODEL || (isGemini ? GEMINI_MODEL : DEFAULT_MODEL),
  };
}

function isAiConfigured() {
  return Boolean(process.env.AI_API_KEY);
}

const SYSTEM_PROMPT = `You are a senior project planner inside a project-management tool.
Given raw project requirements, produce a structured project plan as JSON with this exact shape:
{
  "name": "project name (max 100 chars)",
  "description": "1-3 sentence project description",
  "objectives": ["short objective", "..."],
  "milestones": [
    { "title": "milestone title", "description": "optional", "offsetDays": 14 }
  ],
  "tasks": [
    {
      "title": "task title",
      "description": "what to do and why",
      "priority": "Low" | "Medium" | "High",
      "estimatedHours": 8,
      "acceptanceCriteria": ["verifiable criterion", "..."],
      "subtasks": ["concrete subtask", "..."],
      "labels": ["backend", "frontend", "testing", ...],
      "milestoneIndex": 0 or null,
      "dependsOn": [indexes of earlier tasks in this list]
    }
  ],
  "sprintPlan": [
    { "name": "Sprint 1", "taskIndices": [0, 1, 2] }
  ]
}

Rules:
- Output JSON only, no prose, no markdown fences.
- 3-8 milestones with increasing offsetDays (0-365).
- 5-${MAX_TASKS} tasks, ordered so dependencies only point to earlier tasks (lower indexes).
- Every task needs at least one acceptance criterion and a realistic estimatedHours (0.5-200).
- milestoneIndex must reference a milestone in the plan or be null.
- Keep titles concise; put detail in descriptions.`;

function asString(value, max) {
  if (value === undefined || value === null) return '';
  const s = String(value).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function asStringList(value, maxItems, maxLen) {
  if (!Array.isArray(value)) return [];
  const list = value
    .map((v) => asString(v, maxLen))
    .filter(Boolean);
  return [...new Set(list)].slice(0, maxItems);
}

function asNumber(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

// Validates and normalises a plan that may come from the AI or from the user's
// edited preview. Throws AiInvalidResponseError when unusable; returns
// { plan, warnings } otherwise.
function sanitizePlan(raw) {
  const warnings = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new AiInvalidResponseError('The plan must be a JSON object.');
  }

  const name = asString(raw.name, 120);
  if (!name) throw new AiInvalidResponseError('The plan is missing a project name.');

  const description = asString(raw.description, 2000);
  const objectives = asStringList(raw.objectives, 15, 200);

  const rawMilestones = Array.isArray(raw.milestones) ? raw.milestones.slice(0, MAX_MILESTONES) : [];
  const milestones = [];
  for (const m of rawMilestones) {
    const title = asString(m && m.title, 120);
    if (!title) continue;
    milestones.push({
      title,
      description: asString(m && m.description, 500),
      offsetDays: Math.round(asNumber(m && m.offsetDays, 0, 365, 30)),
    });
  }

  const rawTasks = Array.isArray(raw.tasks) ? raw.tasks.slice(0, MAX_TASKS) : [];
  if (!rawTasks.length) throw new AiInvalidResponseError('The plan does not contain any tasks.');

  const tasks = [];
  rawTasks.forEach((t, index) => {
    const title = asString(t && t.title, 200);
    if (!title) {
      warnings.push(`Skipped task ${index + 1} because it had no title.`);
      return;
    }

    let priority = asString(t && t.priority, 20);
    priority = PRIORITIES.find((p) => p.toLowerCase() === priority.toLowerCase()) || 'Medium';

    let milestoneIndex = t && t.milestoneIndex;
    if (milestoneIndex === null || milestoneIndex === '' || milestoneIndex === undefined) {
      milestoneIndex = null;
    } else {
      const mi = Number(milestoneIndex);
      milestoneIndex = Number.isInteger(mi) && mi >= 0 && mi < milestones.length ? mi : null;
    }

    const dependsOn = [];
    for (const dep of Array.isArray(t && t.dependsOn) ? t.dependsOn : []) {
      const di = Number(dep);
      // Only earlier tasks may be dependencies: keeps the graph acyclic by construction.
      if (Number.isInteger(di) && di >= 0 && di < tasks.length && di !== index && !dependsOn.includes(di)) {
        dependsOn.push(di);
      }
    }

    tasks.push({
      title,
      description: asString(t && t.description, 2000),
      priority,
      estimatedHours: Math.round(asNumber(t && t.estimatedHours, 0, 1000, 0) * 2) / 2,
      acceptanceCriteria: asStringList(t && t.acceptanceCriteria, 12, 300),
      subtasks: asStringList(t && t.subtasks, 20, 200),
      labels: asStringList(t && t.labels, 8, 30),
      milestoneIndex,
      dependsOn,
    });
  });

  if (!tasks.length) throw new AiInvalidResponseError('The plan does not contain any usable tasks.');

  const sprintPlan = [];
  for (const s of Array.isArray(raw.sprintPlan) ? raw.sprintPlan.slice(0, 12) : []) {
    const sprintName = asString(s && s.name, 80);
    if (!sprintName) continue;
    const taskIndices = (Array.isArray(s.taskIndices) ? s.taskIndices : [])
      .map(Number)
      .filter((i) => Number.isInteger(i) && i >= 0 && i < tasks.length);
    sprintPlan.push({ name: sprintName, taskIndices: [...new Set(taskIndices)] });
  }

  return {
    plan: { name, description, objectives, milestones, tasks, sprintPlan },
    warnings,
  };
}

// Pulls the first JSON object out of a model response (tolerates code fences / prose).
function parseModelJson(content) {
  let text = String(content || '').trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new AiInvalidResponseError('The AI response did not contain JSON.');
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    throw new AiInvalidResponseError('The AI response was not valid JSON.');
  }
}

// Builds the HTTP request + response-extractor for the configured provider.
function buildAiRequest(config, text) {
  const userText = `Project requirements:\n\n${text}`;
  if (config.provider === 'gemini') {
    return {
      url: `${config.baseUrl}/models/${encodeURIComponent(config.model)}:generateContent`,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.key,
      },
      body: {
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userText }] }],
        generationConfig: {
          temperature: 0.3,
          responseMimeType: 'application/json',
        },
      },
      extract: (data) => {
        const parts = (data && data.candidates && data.candidates[0]
          && data.candidates[0].content && data.candidates[0].content.parts) || [];
        return parts.map((part) => part.text || '').join('');
      },
    };
  }
  return {
    url: `${config.baseUrl}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.key}`,
    },
    body: {
      model: config.model,
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userText },
      ],
    },
    extract: (data) => data && data.choices && data.choices[0]
      && data.choices[0].message && data.choices[0].message.content,
  };
}

// Asks the model for a structured plan from free-form requirements text.
async function generateProjectPlan(requirements) {
  const config = aiConfig();
  if (!config.key) {
    throw new AiUnavailableError(
      'AI project generation is not configured on this server. Set AI_API_KEY (and optionally AI_PROVIDER / AI_BASE_URL / AI_MODEL), or create the project manually.'
    );
  }

  const text = String(requirements || '').trim();
  if (text.length < 30) {
    throw new AiInvalidResponseError('Describe the project in at least 30 characters so the AI has enough context.');
  }
  if (text.length > MAX_REQUIREMENTS_CHARS) {
    throw new AiInvalidResponseError(`Requirements are too long (max ${MAX_REQUIREMENTS_CHARS} characters).`);
  }

  const request = buildAiRequest(config, text);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60 * 1000);

  let response;
  try {
    response = await fetch(request.url, {
      method: 'POST',
      headers: request.headers,
      signal: controller.signal,
      body: JSON.stringify(request.body),
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new AiUnavailableError('The AI service timed out. Please try again.');
    }
    throw new AiUnavailableError('The AI service could not be reached. Please try again later.');
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    const detail = data && data.error && data.error.message ? String(data.error.message) : '';
    const badCredentials = response.status === 401 || response.status === 403
      || /api key|api_key|unauthenticated|permission/i.test(detail);
    if (badCredentials) {
      throw new AiUnavailableError(
        `The AI service rejected the server credentials (${config.provider}). Check AI_API_KEY / AI_PROVIDER / AI_BASE_URL.`
      );
    }
    throw new AiUnavailableError(`The AI service returned an error (HTTP ${response.status}). Please try again later.`);
  }

  const raw = parseModelJson(request.extract(data));
  return sanitizePlan(raw);
}

module.exports = {
  AiUnavailableError,
  AiInvalidResponseError,
  isAiConfigured,
  generateProjectPlan,
  sanitizePlan,
  parseModelJson,
  PRIORITIES,
  MAX_TASKS,
  MAX_MILESTONES,
  MAX_REQUIREMENTS_CHARS,
};
