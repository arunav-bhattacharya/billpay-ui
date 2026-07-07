import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import { useApp } from './AppContext'
import { flagEmoji, navigate } from './lib'
import type { LifecycleStatus } from './types'

/* ---------- Guilloché: engraved concentric line-work (the signature) ---------- */

export function Guilloche({ rings = 22, className }: { rings?: number; className?: string }) {
  return (
    <svg viewBox="0 0 600 600" className={className} aria-hidden="true">
      {Array.from({ length: rings }).map((_, i) => (
        <ellipse
          key={i}
          cx={300}
          cy={300}
          rx={286}
          ry={118}
          transform={`rotate(${(i * 180) / rings} 300 300)`}
          fill="none"
          stroke="currentColor"
          strokeWidth="0.7"
        />
      ))}
    </svg>
  )
}

/* ---------- Status seal ---------- */

export function StatusSeal({ status, small }: { status: LifecycleStatus; small?: boolean }) {
  const active = status === 'ACTIVE'
  return (
    <span className={`seal ${active ? 'seal-active' : 'seal-draft'} ${small ? 'seal-sm' : ''}`}>
      {active ? (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1" />
          <circle cx="8" cy="8" r="4" fill="none" stroke="currentColor" strokeWidth="0.8" />
          <circle cx="8" cy="8" r="1.5" fill="currentColor" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle
            cx="8" cy="8" r="6.5" fill="none" stroke="currentColor"
            strokeWidth="1" strokeDasharray="2.5 2.2"
          />
        </svg>
      )}
      {active ? 'Active' : 'Draft'}
    </span>
  )
}

/* ---------- Masthead ---------- */

export function Masthead({ route }: { route: string }) {
  const { role, setRole } = useApp()
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <a className="brand" href="#/">
          <span className="bluebox" aria-hidden="true">
            AMERICAN
            <br />
            EXPRESS
          </span>
          <span className="brand-name">
            Billpay
            <span className="brand-sub">Market Onboarding</span>
          </span>
        </a>
        <nav className="mast-nav" aria-label="Primary">
          <a href="#/" className={route === 'dashboard' ? 'active' : ''}>
            Ledger
          </a>
          <a href="#/onboard" className={route === 'onboard' ? 'active' : ''}>
            Onboard
          </a>
        </nav>
        <div className="mast-right">
          <div className="role-switch" role="group" aria-label="Profile">
            <button
              className={role === 'OPERATOR' ? 'on' : ''}
              onClick={() => setRole('OPERATOR')}
            >
              Operator
            </button>
            <button className={role === 'ADMIN' ? 'on' : ''} onClick={() => setRole('ADMIN')}>
              Admin
            </button>
          </div>
        </div>
      </div>
      <Guilloche className="mast-guilloche" />
    </header>
  )
}

/* ---------- Small bits ---------- */

export function Flag({ code, size = 22 }: { code: string; size?: number }) {
  return (
    <span className="flag" style={{ fontSize: size }} role="img" aria-label={`${code} flag`}>
      {flagEmoji(code)}
    </span>
  )
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="eyebrow">{children}</div>
}

export function ErrorNote({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <div className="error-note" role="alert">
      {message}
    </div>
  )
}

/* ---------- Modal ---------- */

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/* ---------- Clone dialog (shared by dashboard + detail) ---------- */

export function CloneDialog({
  sourceCode,
  onClose,
}: {
  sourceCode: string
  onClose: () => void
}) {
  const { catalog, markets, refreshMarkets } = useApp()
  const [target, setTarget] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onboarded = new Set(markets.map((m) => m.code))
  const candidates = (catalog?.markets ?? []).filter((m) => !onboarded.has(m.code))

  async function doClone() {
    if (!target) return
    setBusy(true)
    setError(null)
    try {
      await api.clone(sourceCode, target)
      await refreshMarkets()
      onClose()
      navigate(`#/market/${target}`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title={`Clone ${sourceCode} configuration`} onClose={onClose}>
      <p className="modal-lede">
        Copies every profile, API selection, dimension and custom-dimension definition from{' '}
        <strong>{sourceCode}</strong>. Cloned profiles start as drafts.
      </p>
      {candidates.length === 0 ? (
        <p className="muted">Every Amex market is already onboarded.</p>
      ) : (
        <div className="clone-grid">
          {candidates.map((m) => (
            <button
              key={m.code}
              className={`clone-cell ${target === m.code ? 'sel' : ''}`}
              onClick={() => setTarget(m.code)}
            >
              <Flag code={m.code} size={20} />
              <span className="clone-name">{m.name}</span>
              <span className="mono-tag">
                {m.code} · {m.currency}
              </span>
            </button>
          ))}
        </div>
      )}
      <ErrorNote message={error} />
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={!target || busy} onClick={doClone}>
          {busy ? 'Cloning…' : target ? `Clone to ${target}` : 'Clone'}
        </button>
      </div>
    </Modal>
  )
}
