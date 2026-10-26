const GithubReview = require('../models/GithubReview');
const { generateJson, isAiConfigured } = require('./aiService');
const { listPullFiles } = require('../utils/githubClient');

const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 };
const MAX_PATCH_CHARS = 60000;
const MAX_FILES = 40;

const asString = (value, max) => {
  const text = value == null ? '' : String(value).trim();
  return text.length > max ? text.slice(0, max) : text;
};
const asNumber = (value, min, max, fallback = 0) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
};
const severityOf = (value) => {
  const s = String(value || '').trim().toLowerCase();
  return SEVERITY_RANK[s] ? s : 'low';
};

function reviewPrompt(task, pull, files) {
  const criteria = (task.checklist || []).map((c) => `- [${c.done ? 'x' : ' '}] ${c.text}`).join('\n');
  const changeList = (files || [])
    .filter((f) => f && f.filename)
    .slice(0, MAX_FILES)
    .map((f) => {
      const patch = f.patch ? String(f.patch).slice(0, 6000) : '(no text patch: binary, rename or too large)';
      return `### ${f.filename} (${f.status || 'changed'}, +${f.additions || 0}/-${f.deletions || 0})\n${patch}`;
    })
    .join('\n\n')
    .slice(0, MAX_PATCH_CHARS);

  return {
    system: `You are a careful senior code reviewer inside a project-management tool.
Review ONLY the supplied pull request diff against the task. Do not invent files or lines that are not in the diff.
Be conservative: report a finding only when the change in front of you clearly supports it.
Output JSON only, no markdown fences, exactly this shape:
{
  "verdict": "changes_requested" | "no_blocking_issues" | "approved" | "inconclusive",
  "summary": "1-3 sentences for the task assignee",
  "findings": [
    { "title": "short", "detail": "why it matters and how to fix it", "file": "path", "line": 0, "severity": "low" | "medium" | "high" | "critical", "confidence": 0.0 }
  ],
  "acceptanceCriteria": [
    { "criterion": "the task criterion", "met": true, "confidence": 0.0, "note": "evidence or what is missing" }
  ]
}
Rules:
- The diff may be truncated. If there is not enough evidence, use "inconclusive" and low confidence.
- A high severity finding (security bug, data loss, broken core requirement) must have confidence >= 0.7.
- Do not request changes for style preferences.
- No prose outside the JSON.`,
    user: `Task: ${asString(task.title, 300)}
Task description: ${asString(task.description, 4000) || '(none)'}
Acceptance checklist:
${criteria || '(none)'}

Pull request #${pull.number}: ${asString(pull.title, 300)}
PR description: ${asString(pull.body, 4000) || '(none)'}
Branch: ${asString(pull.branch || (pull.head && pull.head.ref), 200)}

Diff:
${changeList || '(the diff could not be read; review cannot be conclusive)'}`,
  };
}

function normalizeReview(raw, workflow) {
  const verdicts = ['changes_requested', 'no_blocking_issues', 'approved', 'inconclusive'];
  const findings = Array.isArray(raw && raw.findings)
    ? raw.findings.slice(0, 50).map((f) => ({
      title: asString(f && f.title, 300),
      detail: asString(f && f.detail, 2000),
      file: asString(f && f.file, 300),
      line: Number.isFinite(Number(f && f.line)) ? Number(f.line) : undefined,
      severity: severityOf(f && f.severity),
      confidence: asNumber(f && f.confidence, 0, 1, 0),
      actionable: false,
    })).filter((f) => f.title || f.detail)
    : [];

  const threshold = SEVERITY_RANK[workflow.reviewSeverityThreshold] || SEVERITY_RANK.high;
  for (const f of findings) {
    f.actionable = Boolean(
      SEVERITY_RANK[f.severity] >= threshold &&
      f.confidence >= workflow.reviewConfidenceThreshold
    );
  }

  const criteria = Array.isArray(raw && raw.acceptanceCriteria)
    ? raw.acceptanceCriteria.slice(0, 30).map((c) => ({
      criterion: asString(c && c.criterion, 500),
      met: c && typeof c.met === 'boolean' ? c.met : undefined,
      confidence: asNumber(c && c.confidence, 0, 1, 0),
      note: asString(c && c.note, 1000),
    })).filter((c) => c.criterion)
    : [];

  let verdict = String((raw && raw.verdict) || '').trim().toLowerCase();
  const anyActionable = findings.some((f) => f.actionable);
  if (!verdicts.includes(verdict)) verdict = anyActionable ? 'changes_requested' : 'inconclusive';
  // A model cannot say "approved" while also reporting a blocking issue.
  if (anyActionable) verdict = 'changes_requested';
  if (verdict === 'no_blocking_issues' && anyActionable) verdict = 'changes_requested';

  const blocking = findings.filter((f) => f.actionable);
  const severity = blocking.reduce((worst, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[worst] ? f.severity : worst), 'low');
  const confidence = findings.length
    ? Math.max(...findings.map((f) => f.confidence))
    : asNumber(raw && raw.confidence, 0, 1, 0);

  return {
    verdict,
    summary: asString(raw && raw.summary, 3000),
    findings,
    acceptanceCriteria: criteria,
    severity: blocking.length ? severity : undefined,
    confidence,
    blockingCount: blocking.length,
  };
}

async function saveReview({ project, task, repoFullName, pull, result, commitSha, aiUsed, reason, source = 'ai' }) {
  const filter = {
    project: project._id,
    repoFullName,
    prNumber: pull.number,
    task: task._id,
  };
  let doc = await GithubReview.findOne(filter);
  const historyEntry = {
    at: new Date(),
    source,
    commitSha: commitSha || undefined,
    verdict: result.verdict,
    summary: result.summary,
    findingsCount: (result.findings || []).length,
    blockingCount: result.blockingCount || 0,
    severity: result.severity,
    confidence: result.confidence,
    aiUsed: Boolean(aiUsed),
    reason: reason || undefined,
  };

  if (!doc) {
    doc = new GithubReview({
      project: project._id,
      workspace: project.workspace,
      task: task._id,
      repoFullName,
      prNumber: pull.number,
      prUrl: pull.url || pull.html_url,
      ...result,
      aiUsed: Boolean(aiUsed),
      commitSha,
      reviewedAt: new Date(),
      history: [historyEntry],
    });
  } else {
    doc.workspace = project.workspace;
    doc.task = task._id;
    doc.prUrl = pull.url || pull.html_url || doc.prUrl;
    doc.verdict = result.verdict;
    doc.summary = result.summary;
    doc.findings = result.findings || [];
    doc.acceptanceCriteria = result.acceptanceCriteria || [];
    doc.severity = result.severity;
    doc.confidence = result.confidence;
    doc.aiUsed = Boolean(aiUsed);
    doc.commitSha = commitSha;
    doc.reviewedAt = new Date();
    doc.history = [...(doc.history || []), historyEntry].slice(-20);
  }
  await doc.save();
  return doc;
}

// Runs the configured AI reviewer. Missing AI configuration is not an error: the pull request is
// still synchronized, the review is reported as unavailable, and no status changes because of it.
async function reviewPullRequest({ project, task, repoFullName, pull, token, commitSha, workflow }) {
  if (!isAiConfigured()) {
    return { verdict: 'unavailable', summary: 'AI review is not configured on this server.', aiUsed: false, reason: 'AI_API_KEY is not set', findings: [], blockingCount: 0 };
  }

  let files = [];
  try {
    const [owner, name] = repoFullName.split('/');
    files = await listPullFiles(token, owner, name, pull.number);
  } catch (error) {
    files = [];
  }

  const timeoutMs = Number(process.env.GITHUB_REVIEW_TIMEOUT_MS) || 45000;
  try {
    const raw = await generateJson(reviewPrompt(task, pull, files), { timeoutMs, useFallbacks: true });
    const result = normalizeReview(raw, workflow);
    const saved = await saveReview({ project, task, repoFullName, pull, result, commitSha, aiUsed: true });
    return { ...result, aiUsed: true, _id: saved._id, review: saved };
  } catch (error) {
    const result = {
      verdict: 'unavailable',
      summary: asString(error && error.message, 1000) || 'The AI reviewer could not be used.',
      findings: [],
      acceptanceCriteria: [],
      blockingCount: 0,
      confidence: 0,
    };
    // Keep the reason visible in the history without changing the task based on a failed review.
    const saved = await saveReview({ project, task, repoFullName, pull, result, commitSha, aiUsed: false, reason: result.summary });
    return { ...result, aiUsed: false, _id: saved._id, review: saved };
  }
}

module.exports = {
  SEVERITY_RANK,
  normalizeReview,
  reviewPullRequest,
  saveReview,
};
