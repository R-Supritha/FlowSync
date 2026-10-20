import { useEffect, useRef } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { dismissToast } from '../store/uiSlice'

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="state-box" role="status">
      <div className="spinner" />
      {label}
    </div>
  )
}

export function EmptyState({ title, children }) {
  return (
    <div className="state-box">
      <p style={{ color: 'var(--fg)', fontWeight: 600, margin: '0 0 6px' }}>{title}</p>
      {children}
    </div>
  )
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="state-box" role="alert">
      <p className="fs-error" style={{ margin: '0 0 10px' }}>
        {message || 'Something went wrong'}
      </p>
      {onRetry && (
        <button type="button" className="fs-btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

// Open dialogs, newest last. Only the newest one answers Escape and Tab, so a confirmation
// inside the task drawer closes alone instead of closing both.
const modalStack = []
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'

export function Modal({ title, onClose, children, side = false }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const id = Symbol('modal')
    modalStack.push(id)
    const previous = document.activeElement
    const focusable = () => (ref.current ? [...ref.current.querySelectorAll(FOCUSABLE)] : [])
    if (ref.current && !ref.current.contains(document.activeElement)) (focusable()[0] || ref.current).focus()

    const onKey = (e) => {
      if (modalStack[modalStack.length - 1] !== id) return
      if (e.key === 'Escape') {
        e.stopPropagation()
        closeRef.current()
      } else if (e.key === 'Tab') {
        const items = focusable()
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      modalStack.splice(modalStack.indexOf(id), 1)
      if (previous && previous.focus) previous.focus()
    }
  }, [])

  const body = side ? (
    <div ref={ref} tabIndex={-1} className="drawer" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
      {children}
    </div>
  ) : (
    <div ref={ref} tabIndex={-1} className="modal" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
      <h2>{title}</h2>
      {children}
    </div>
  )

  return (
    <div className={`overlay${side ? ' right' : ''}`} onMouseDown={onClose}>
      {body}
    </div>
  )
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, busy, onConfirm, onCancel }) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p>{message}</p>
      <div className="modal-actions">
        <button type="button" className="fs-btn" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className={`fs-btn ${danger ? 'danger' : 'primary'}`}
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  )
}

function ToastItem({ toast }) {
  const dispatch = useDispatch()
  useEffect(() => {
    const t = setTimeout(() => dispatch(dismissToast(toast.id)), 4500)
    return () => clearTimeout(t)
  }, [dispatch, toast.id])
  return (
    <div
      className={`toast ${toast.type}`}
      role="status"
      onClick={() => dispatch(dismissToast(toast.id))}
    >
      {toast.message}
    </div>
  )
}

export function Toasts() {
  const toasts = useSelector((s) => s.ui.toasts)
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}
