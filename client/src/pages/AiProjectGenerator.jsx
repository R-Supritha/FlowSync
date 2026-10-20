import { useMemo, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertTriangle,
  Check,
  FileText,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import { aiProjectApi, ocrApi } from '../api/endpoints'
import { errorMessage } from '../api/client'
import { pushToast } from '../store/uiSlice'
import { fetchProjects } from '../store/projectsSlice'
import { selectCurrentWorkspace, selectMyRole } from '../store/workspacesSlice'
import { canManageColumns } from '../utils/roles'
import { EmptyState } from '../components/ui'

const MAX_FILE_SIZE = 15 * 1024 * 1024
const ACCEPTED_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]
const PRIORITIES = ['Low', 'Medium', 'High']
const MIN_REQUIREMENTS = 30

const splitLines = (text) =>
  String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

const newKey = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `gen-${Date.now()}-${Math.random().toString(36).slice(2)}`

// The editable preview the user confirms. Accepts the plan returned by the
// backend or whatever edits the user made afterwards.
function toEditablePlan(plan) {
  return {
    name: plan.name || '',
    description: plan.description || '',
    objectives: Array.isArray(plan.objectives) ? plan.objectives : [],
    milestones: (Array.isArray(plan.milestones) ? plan.milestones : []).map((m) => ({
      title: m.title || '',
      description: m.description || '',
      offsetDays: Number.isFinite(Number(m.offsetDays)) ? Number(m.offsetDays) : 30,
    })),
    tasks: (Array.isArray(plan.tasks) ? plan.tasks : []).map((t) => ({
      title: t.title || '',
      description: t.description || '',
      priority: PRIORITIES.includes(t.priority) ? t.priority : 'Medium',
      estimatedHours: Number.isFinite(Number(t.estimatedHours)) ? Number(t.estimatedHours) : 0,
      acceptanceCriteria: Array.isArray(t.acceptanceCriteria) ? t.acceptanceCriteria : [],
      subtasks: Array.isArray(t.subtasks) ? t.subtasks : [],
      labels: Array.isArray(t.labels) ? t.labels : [],
      milestoneIndex:
        Number.isInteger(t.milestoneIndex) && t.milestoneIndex >= 0 ? t.milestoneIndex : null,
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.filter(Number.isInteger) : [],
    })),
  }
}

export default function AiProjectGenerator() {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const workspace = useSelector(selectCurrentWorkspace)
  const role = useSelector(selectMyRole)

  const [step, setStep] = useState('input') // input | review | preview
  const [requirements, setRequirements] = useState('')
  const [files, setFiles] = useState([])
  const [busyFiles, setBusyFiles] = useState(0)
  const [plan, setPlan] = useState(null)
  const [planWarnings, setPlanWarnings] = useState([])
  const [planError, setPlanError] = useState(null)
  const [aiUnavailable, setAiUnavailable] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState(null)
  const generationKey = useRef(newKey())
  const fileInput = useRef(null)

  const tooLong = requirements.length > 40000
  const canGenerate = requirements.trim().length >= MIN_REQUIREMENTS && !tooLong

  async function handleFiles(event) {
    const chosen = [...(event.target.files || [])]
    event.target.value = ''
    for (const file of chosen) {
      const id = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`
      if (!ACCEPTED_TYPES.includes(file.type)) {
        setFiles((list) => [
          ...list,
          { id, name: file.name, status: 'error', error: 'Unsupported type. Use PDF, DOCX, PPTX, PNG or JPEG.' },
        ])
        continue
      }
      if (file.size > MAX_FILE_SIZE) {
        setFiles((list) => [
          ...list,
          { id, name: file.name, status: 'error', error: 'File is too large (max 15MB).' },
        ])
        continue
      }

      setFiles((list) => [...list, { id, name: file.name, status: 'uploading' }])
      setBusyFiles((n) => n + 1)
      try {
        const res = await ocrApi.extract(file)
        setFiles((list) =>
          list.map((f) =>
            f.id === id
              ? { ...f, status: 'done', text: res.text, method: res.source?.method }
              : f,
          ),
        )
        setRequirements((current) => {
          const sep = current.trim() ? '\n\n' : ''
          return `${current}${sep}--- ${file.name} ---\n${res.text}`
        })
        for (const warning of res.warnings || []) {
          dispatch(pushToast(`${file.name}: ${warning}`, 'info'))
        }
      } catch (e) {
        setFiles((list) =>
          list.map((f) => (f.id === id ? { ...f, status: 'error', error: errorMessage(e) } : f)),
        )
      } finally {
        setBusyFiles((n) => n - 1)
      }
    }
  }

  function removeFile(id) {
    setFiles((list) => list.filter((f) => f.id !== id))
  }

  async function generate() {
    setGenerating(true)
    setPlanError(null)
    setAiUnavailable(false)
    try {
      const res = await aiProjectApi.generatePlan(requirements)
      setPlan(toEditablePlan(res.plan))
      setPlanWarnings(res.warnings || [])
      setStep('preview')
    } catch (e) {
      const status = e.response?.status
      const unavailable = e.response?.data?.aiUnavailable || status === 503
      setAiUnavailable(Boolean(unavailable))
      setPlanError(errorMessage(e, 'Failed to generate a project plan'))
    } finally {
      setGenerating(false)
    }
  }

  const updateTask = (index, patch) =>
    setPlan((p) => ({
      ...p,
      tasks: p.tasks.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    }))

  const updateMilestone = (index, patch) =>
    setPlan((p) => ({
      ...p,
      milestones: p.milestones.map((m, i) => (i === index ? { ...m, ...patch } : m)),
    }))

  function addTask() {
    setPlan((p) => ({
      ...p,
      tasks: [
        ...p.tasks,
        {
          title: '',
          description: '',
          priority: 'Medium',
          estimatedHours: 4,
          acceptanceCriteria: [],
          subtasks: [],
          labels: [],
          milestoneIndex: null,
          dependsOn: [],
        },
      ],
    }))
  }

  function removeTask(index) {
    setPlan((p) => ({
      ...p,
      tasks: p.tasks
        .filter((_, i) => i !== index)
        .map((t) => ({
          ...t,
          dependsOn: t.dependsOn.filter((d) => d !== index).map((d) => (d > index ? d - 1 : d)),
        })),
    }))
  }

  function toggleDependency(taskIndex, depIndex) {
    setPlan((p) => ({
      ...p,
      tasks: p.tasks.map((t, i) => {
        if (i !== taskIndex) return t
        const has = t.dependsOn.includes(depIndex)
        return {
          ...t,
          dependsOn: has ? t.dependsOn.filter((d) => d !== depIndex) : [...t.dependsOn, depIndex].sort((a, b) => a - b),
        }
      }),
    }))
  }

  async function confirmCreate() {
    if (!workspace) return
    if (!plan.name.trim()) {
      setCreateError('Project name is required')
      return
    }
    if (!plan.tasks.length || plan.tasks.some((t) => !t.title.trim())) {
      setCreateError('Every task needs a title')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const res = await aiProjectApi.createFromPlan(workspace._id, {
        generationKey: generationKey.current,
        plan: {
          ...plan,
          name: plan.name.trim(),
          tasks: plan.tasks.map((t, i) => ({
            ...t,
            estimatedHours: Number(t.estimatedHours) || 0,
            dependsOn: t.dependsOn.filter((d) => d !== i && plan.tasks[d]),
          })),
        },
      })
      dispatch(pushToast(res.duplicate ? 'Project was already created' : 'AI project created', 'success'))
      dispatch(fetchProjects({ workspaceId: workspace._id, archived: false }))
      navigate(`/projects/${res.project._id}/board`)
    } catch (e) {
      setCreateError(errorMessage(e, 'Failed to create the project'))
    } finally {
      setCreating(false)
    }
  }

  const totalHours = useMemo(
    () => plan ? plan.tasks.reduce((sum, t) => sum + (Number(t.estimatedHours) || 0), 0) : 0,
    [plan],
  )

  if (!workspace) return <EmptyState title="No workspace selected" />
  if (!canManageColumns(role)) {
    return <EmptyState title="Only Admin or Manager can create projects" />
  }

  return (
    <div className="page">
      <div className="fs-row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <h1><Sparkles size={20} aria-hidden="true" /> Generate project with AI</h1>
          <p className="fs-muted" style={{ marginTop: 0 }}>
            Upload requirement documents or paste a description — FlowSync drafts a full project plan you can edit before anything is saved.
          </p>
        </div>
        <ol className="fs-row fs-muted" style={{ gap: 6, fontSize: 13, listStyle: 'none', margin: 0, padding: 0 }}>
          <li className={step === 'input' ? 'chip chip-ok' : 'chip'}>1. Requirements</li>
          <li className={step === 'review' ? 'chip chip-ok' : 'chip'}>2. Review text</li>
          <li className={step === 'preview' ? 'chip chip-ok' : 'chip'}>3. Edit plan</li>
        </ol>
      </div>

      {step === 'input' && (
        <section className="panel" style={{ marginTop: 12 }}>
          <div className="panel-head"><h3>Project requirements</h3></div>

          <label className="fs-label" htmlFor="req-text">
            Describe the project (features, audience, constraints…)
          </label>
          <textarea
            id="req-text"
            className="fs-textarea"
            style={{ minHeight: 180 }}
            value={requirements}
            placeholder="Example: Build a campus lost-and-found web app where students can post found items, browse claims, and get email notifications…"
            onChange={(e) => setRequirements(e.target.value)}
          />
          <p className="fs-muted" style={{ fontSize: 12, margin: '4px 0 12px' }}>
            {requirements.trim().length} characters
            {tooLong ? ' — too long, trim before generating' : ` · at least ${MIN_REQUIREMENTS} needed`}
          </p>

          <div className="fs-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="fs-btn" onClick={() => fileInput.current?.click()}>
              <Upload size={14} aria-hidden="true" /> Add PDF / DOCX / PPTX / image
            </button>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".pdf,.docx,.pptx,.png,.jpg,.jpeg"
              style={{ display: 'none' }}
              onChange={handleFiles}
            />
          </div>
          <p className="fs-muted" style={{ fontSize: 12 }}>
            Images and scanned PDFs are OCR-extracted; the text is appended above so you can edit it. Max 15MB per file.
          </p>

          {files.length > 0 && (
            <ul style={{ listStyle: 'none', padding: 0, margin: '10px 0 0', display: 'grid', gap: 6 }}>
              {files.map((f) => (
                <li key={f.id} className="fs-row" style={{ gap: 8, justifyContent: 'space-between' }}>
                  <span className="fs-row" style={{ gap: 6, minWidth: 0 }}>
                    <FileText size={14} aria-hidden="true" className="fs-muted" />
                    <span className="ellipsis">{f.name}</span>
                    {f.status === 'uploading' && <span className="fs-muted">Extracting text…</span>}
                    {f.status === 'done' && <Check size={13} aria-hidden="true" style={{ color: 'var(--ok)' }} />}
                  </span>
                  <span className="fs-row" style={{ gap: 6 }}>
                    {f.status === 'error' && <span className="fs-error" role="alert">{f.error}</span>}
                    <button
                      type="button"
                      className="fs-btn small ghost"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => removeFile(f.id)}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="fs-row" style={{ marginTop: 16, gap: 8 }}>
            <Link to="/projects" className="fs-btn">Cancel</Link>
            <button type="button" className="fs-btn primary" disabled={!canGenerate || busyFiles > 0} onClick={() => setStep('review')}>
              Continue
            </button>
            {busyFiles > 0 && <span className="fs-muted">Waiting for file extraction…</span>}
          </div>
        </section>
      )}

      {step === 'review' && (
        <section className="panel" style={{ marginTop: 12 }}>
          <div className="panel-head"><h3>Review the extracted requirements</h3></div>
          <p className="fs-muted" style={{ marginTop: 0 }}>
            Edit anything the extraction got wrong — this text is what the AI analyses.
          </p>
          <textarea
            className="fs-textarea"
            style={{ minHeight: 260 }}
            value={requirements}
            onChange={(e) => setRequirements(e.target.value)}
            aria-label="Extracted requirements"
          />
          {planError && (
            <div className="state-box" role="alert" style={{ marginTop: 12 }}>
              <p className="fs-error" style={{ margin: '0 0 8px' }}>
                <AlertTriangle size={14} aria-hidden="true" /> {planError}
              </p>
              {aiUnavailable && (
                <p className="fs-muted" style={{ margin: '0 0 10px' }}>
                  Your requirements are preserved here. You can retry, or create the project manually without AI.
                </p>
              )}
              <div className="fs-row" style={{ gap: 8 }}>
                {aiUnavailable && <Link to="/projects/new" className="fs-btn">Create manually</Link>}
              </div>
            </div>
          )}
          <div className="fs-row" style={{ marginTop: 16, gap: 8 }}>
            <button type="button" className="fs-btn" onClick={() => setStep('input')} disabled={generating}>
              Back
            </button>
            <button type="button" className="fs-btn primary" onClick={generate} disabled={generating || !canGenerate}>
              {generating ? (
                <>Analysing requirements…</>
              ) : (
                <>
                  <Sparkles size={14} aria-hidden="true" /> Generate plan
                </>
              )}
            </button>
            <Link to="/projects" className="fs-btn ghost">Cancel</Link>
          </div>
        </section>
      )}

      {step === 'preview' && plan && (
        <section className="panel" style={{ marginTop: 12 }}>
          <div className="panel-head"><h3>Generated plan — review and edit</h3></div>
          {planWarnings.length > 0 && (
            <p className="fs-muted" style={{ marginTop: 0 }}>
              {planWarnings.join(' ')}
            </p>
          )}

          <label className="fs-label" htmlFor="gen-name">Project name</label>
          <input id="gen-name" className="fs-input" value={plan.name} onChange={(e) => setPlan({ ...plan, name: e.target.value })} />
          <label className="fs-label" htmlFor="gen-desc">Description</label>
          <textarea id="gen-desc" className="fs-textarea" value={plan.description} onChange={(e) => setPlan({ ...plan, description: e.target.value })} />

          <h3 style={{ marginTop: 18 }}>Milestones ({plan.milestones.length})</h3>
          {plan.milestones.length === 0 && <p className="fs-muted">No milestones suggested.</p>}
          {plan.milestones.map((m, i) => (
            <div key={i} className="fs-row" style={{ gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <input
                className="fs-input"
                style={{ flex: 2, minWidth: 160 }}
                value={m.title}
                aria-label={`Milestone ${i + 1} title`}
                onChange={(e) => updateMilestone(i, { title: e.target.value })}
              />
              <input
                className="fs-input"
                type="number"
                min="0"
                max="365"
                style={{ width: 110 }}
                value={m.offsetDays}
                aria-label={`Milestone ${i + 1} days from start`}
                onChange={(e) => updateMilestone(i, { offsetDays: Number(e.target.value) })}
              />
              <span className="fs-muted" style={{ fontSize: 12 }}>days from start</span>
              <button
                type="button"
                className="fs-btn small ghost"
                aria-label={`Remove milestone ${i + 1}`}
                onClick={() =>
                  setPlan((p) => ({
                    ...p,
                    milestones: p.milestones.filter((_, mi) => mi !== i),
                    tasks: p.tasks.map((t) => ({
                      ...t,
                      milestoneIndex:
                        t.milestoneIndex === i ? null : t.milestoneIndex > i ? t.milestoneIndex - 1 : t.milestoneIndex,
                    })),
                  }))
                }
              >
                <Trash2 size={13} aria-hidden="true" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="fs-btn small"
            onClick={() => setPlan((p) => ({ ...p, milestones: [...p.milestones, { title: '', description: '', offsetDays: 30 }] }))}
          >
            <Plus size={13} aria-hidden="true" /> Add milestone
          </button>

          <h3 style={{ marginTop: 18 }}>
            Tasks ({plan.tasks.length}) · ~{totalHours} h total
          </h3>
          {plan.tasks.map((t, i) => (
            <div key={i} className="panel" style={{ marginBottom: 10, padding: 12 }}>
              <div className="fs-row" style={{ gap: 8, flexWrap: 'wrap' }}>
                <input
                  className="fs-input"
                  style={{ flex: 2, minWidth: 200, fontWeight: 600 }}
                  value={t.title}
                  placeholder={`Task ${i + 1} title`}
                  aria-label={`Task ${i + 1} title`}
                  onChange={(e) => updateTask(i, { title: e.target.value })}
                />
                <select
                  className="fs-select"
                  style={{ width: 120 }}
                  value={t.priority}
                  aria-label={`Task ${i + 1} priority`}
                  onChange={(e) => updateTask(i, { priority: e.target.value })}
                >
                  {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <input
                  className="fs-input"
                  type="number"
                  min="0"
                  step="0.5"
                  style={{ width: 90 }}
                  value={t.estimatedHours}
                  aria-label={`Task ${i + 1} estimated hours`}
                  onChange={(e) => updateTask(i, { estimatedHours: e.target.value })}
                />
                <span className="fs-muted" style={{ fontSize: 12 }}>hours</span>
                <select
                  className="fs-select"
                  style={{ maxWidth: 180 }}
                  value={t.milestoneIndex ?? ''}
                  aria-label={`Task ${i + 1} milestone`}
                  onChange={(e) => updateTask(i, { milestoneIndex: e.target.value === '' ? null : Number(e.target.value) })}
                >
                  <option value="">No milestone</option>
                  {plan.milestones.map((m, mi) => (
                    <option key={mi} value={mi}>{m.title || `Milestone ${mi + 1}`}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="fs-btn small ghost"
                  aria-label={`Remove task ${i + 1}`}
                  onClick={() => removeTask(i)}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </div>

              <textarea
                className="fs-textarea"
                style={{ minHeight: 48, marginTop: 8 }}
                value={t.description}
                placeholder="Description"
                aria-label={`Task ${i + 1} description`}
                onChange={(e) => updateTask(i, { description: e.target.value })}
              />

              <div className="fs-row" style={{ gap: 12, marginTop: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <span className="fs-label" style={{ display: 'block' }}>Acceptance criteria (one per line)</span>
                  <textarea
                    className="fs-textarea"
                    style={{ minHeight: 60 }}
                    value={t.acceptanceCriteria.join('\n')}
                    aria-label={`Task ${i + 1} acceptance criteria`}
                    onChange={(e) => updateTask(i, { acceptanceCriteria: splitLines(e.target.value) })}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <span className="fs-label" style={{ display: 'block' }}>Subtasks (one per line)</span>
                  <textarea
                    className="fs-textarea"
                    style={{ minHeight: 60 }}
                    value={t.subtasks.join('\n')}
                    aria-label={`Task ${i + 1} subtasks`}
                    onChange={(e) => updateTask(i, { subtasks: splitLines(e.target.value) })}
                  />
                </div>
              </div>

              {plan.tasks.length > 1 && (
                <details style={{ marginTop: 8 }}>
                  <summary className="fs-muted" style={{ cursor: 'pointer', fontSize: 13 }}>
                    Dependencies ({t.dependsOn.length})
                  </summary>
                  <div className="fs-row" style={{ flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
                    {plan.tasks.map((other, oi) =>
                      oi === i ? null : (
                        <label key={oi} className="fs-row" style={{ gap: 6, fontSize: 13 }}>
                          <input
                            type="checkbox"
                            checked={t.dependsOn.includes(oi)}
                            onChange={() => toggleDependency(i, oi)}
                          />
                          <span className="ellipsis" style={{ maxWidth: 220 }}>
                            {oi + 1}. {other.title || '(untitled)'}
                          </span>
                        </label>
                      ),
                    )}
                  </div>
                </details>
              )}
            </div>
          ))}
          <button type="button" className="fs-btn small" onClick={addTask}>
            <Plus size={13} aria-hidden="true" /> Add task
          </button>

          {createError && <p className="fs-error" role="alert" style={{ marginTop: 12 }}>{createError}</p>}

          <div className="fs-row" style={{ marginTop: 18, gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="fs-btn"
              disabled={generating || creating}
              onClick={async () => {
                setGenerating(true)
                setPlanError(null)
                try {
                  const res = await aiProjectApi.generatePlan(requirements)
                  setPlan(toEditablePlan(res.plan))
                  setPlanWarnings(res.warnings || [])
                } catch (e) {
                  setAiUnavailable(Boolean(e.response?.data?.aiUnavailable || e.response?.status === 503))
                  setPlanError(errorMessage(e, 'Failed to regenerate the plan'))
                  setStep('review')
                } finally {
                  setGenerating(false)
                }
              }}
            >
              <RefreshCw size={14} aria-hidden="true" /> Regenerate
            </button>
            <button type="button" className="fs-btn" onClick={() => setStep('review')} disabled={creating}>
              Back
            </button>
            <button type="button" className="fs-btn primary" onClick={confirmCreate} disabled={creating}>
              {creating ? 'Creating project…' : 'Create project'}
            </button>
            <Link to="/projects" className="fs-btn ghost">Cancel</Link>
          </div>
          <p className="fs-muted" style={{ fontSize: 12, marginTop: 8 }}>
            Nothing is saved until you press “Create project”. Cancelling leaves your workspace untouched.
          </p>
        </section>
      )}
    </div>
  )
}
