import { useEffect, useId, useRef, useState } from 'react'
import { useDispatch, useSelector } from 'react-redux'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { dismissToast } from '../store/uiSlice'
import { initials } from '../utils/format'

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="state-box" role="status">
      <div className="spinner" />
      {label}
    </div>
  )
}

export function EmptyState({ title, children, action }) {
  return (
    <div className="state-box">
      <p style={{ color: 'var(--fg)', fontWeight: 600, margin: '0 0 6px' }}>{title}</p>
      {children && <p className="fs-muted" style={{ margin: 0 }}>{children}</p>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
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

export function Skeleton({ lines = 3 }) {
  return (
    <div aria-hidden="true" style={{ display: 'grid', gap: 8, padding: 12 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - i * 10}%` }} />
      ))}
    </div>
  )
}

export function Chip({ children, tone = 'default', title }) {
  return (
    <span className={`chip chip-${tone}`} title={title}>
      {children}
    </span>
  )
}

export function PriorityBadge({ priority }) {
  const tone = String(priority || '').toLowerCase()
  return <span className={`badge ${tone}`}>{priority}</span>
}

export function Avatar({ name, url, size = 24, presence, title }) {
  const [broken, setBroken] = useState(false)
  const label = initials(name)
  return (
    <span
      className="avatar-wrap"
      title={title || name}
      style={{ width: size, height: size }}
    >
      {url && !broken ? (
        <img
          className="avatar-img"
          src={url}
          alt={name || 'avatar'}
          onError={() => setBroken(true)}
        />
      ) : (
        <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38 }}>
          {label}
        </span>
      )}
      {presence && <span className="presence-dot" style={{ background: presence }} />}
    </span>
  )
}

// A small accessible popover used for menus (account, presence, notifications, filters).
export function Dropdown({ label, button, children, align = 'right', width = 260, className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const id = useId()

  useEffect(() => {
    if (!open) return undefined
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className={`dropdown ${className}`} ref={ref}>
      <button
        type="button"
        className="fs-btn ghost dropdown-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
      >
        {button}
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          className="dropdown-menu"
          style={{ [align]: 0, width }}
          onClick={(e) => {
            // Close when a menu item is activated, but not when interacting with form fields.
            if (e.target.closest('[data-menu-close]')) setOpen(false)
          }}
        >
          {typeof children === 'function' ? children({ close: () => setOpen(false) }) : children}
        </div>
      )}
    </div>
  )
}

export function MenuItem({ icon: Icon, children, onClick, disabled, danger, ...rest }) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item${danger ? ' danger' : ''}`}
      disabled={disabled}
      onClick={onClick}
      data-menu-close
      {...rest}
    >
      {Icon && <Icon size={15} aria-hidden="true" />}
      <span>{children}</span>
    </button>
  )
}

export function Modal({ title, onClose, children, side = false, wide = false, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const body = (
    <div
      className={side ? 'drawer' : `modal${wide ? ' wide' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {title && (
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="fs-btn small ghost" aria-label="Close" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      <div className="modal-body">{children}</div>
      {footer && <div className="modal-foot">{footer}</div>}
    </div>
  )

  return createPortal(
    <div className={`overlay${side ? ' right' : ''}`} onMouseDown={onClose}>
      {body}
    </div>,
    document.body,
  )
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, busy, onConfirm, onCancel, children }) {
  return (
    <Modal
      title={title}
      onClose={onCancel}
      footer={
        <>
          <button type="button" className="fs-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`fs-btn ${danger ? 'danger' : 'primary'}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </>
      }
    >
      {message && <p>{message}</p>}
      {children}
    </Modal>
  )
}

export function Pagination({ page, pages, onChange, busy }) {
  if (!pages || pages <= 1) return null
  return (
    <div className="pagination" role="navigation" aria-label="Pagination">
      <button type="button" className="fs-btn small" disabled={busy || page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span className="fs-muted">Page {page} of {pages}</span>
      <button type="button" className="fs-btn small" disabled={busy || page >= pages} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </div>
  )
}

export function Tabs({ tabs, value, onChange, ariaLabel }) {
  return (
    <div className="tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          className={`tab${value === t.id ? ' active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.icon && <t.icon size={14} aria-hidden="true" />}
          {t.label}
          {t.count != null && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function Field({ label, htmlFor, hint, error, children }) {
  return (
    <div className="field">
      {label && <label className="fs-label" htmlFor={htmlFor}>{label}</label>}
      {children}
      {hint && !error && <p className="field-hint">{hint}</p>}
      {error && <p className="fs-error" role="alert">{error}</p>}
    </div>
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
