import { useState } from 'react'
import { useDispatch } from 'react-redux'
import { githubApi } from '../../api/endpoints'
import { errorMessage } from '../../api/client'
import { pushToast } from '../../store/uiSlice'
import { Field, Modal } from '../ui'

export default function LinkGitHubModal({ projectId, onClose, onLinked }) {
  const dispatch = useDispatch()
  const [repo, setRepo] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await githubApi.link(projectId, { repo, token })
      dispatch(pushToast(`Linked ${res.link.repo}`, 'success'))
      onLinked?.(res.link)
      onClose()
    } catch (err) {
      setError(errorMessage(err, 'Could not link repository'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Link a GitHub repository"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="fs-btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="submit" form="link-github" className="fs-btn primary" disabled={busy || !repo.trim() || !token.trim()}>
            {busy ? 'Linking…' : 'Link repository'}
          </button>
        </>
      }
    >
      <form id="link-github" onSubmit={submit}>
        <Field label="Repository" htmlFor="gh-repo" hint="e.g. ssndev/flow-api or https://github.com/ssndev/flow-api">
          <input id="gh-repo" className="fs-input" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name" autoFocus required />
        </Field>
        <Field
          label="Fine-grained access token"
          htmlFor="gh-token"
          hint="Stored encrypted on the server and never shown again. Needs Contents:Read. Rotate by re-linking."
        >
          <input
            id="gh-token"
            className="fs-input"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="github_pat_…"
            required
          />
        </Field>
        <p className="fs-muted" style={{ fontSize: 12 }}>Commits referencing <code>FS-xxxxxx</code> move linked tasks forward automatically.</p>
        {error && <p className="fs-error" role="alert">{error}</p>}
      </form>
    </Modal>
  )
}