import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import { useApp } from './AppContext'
import amexLogo from './assets/amex.svg'
import { ACCOUNT_TYPE_LABELS, flagEmoji } from './lib'
import type { AccountType, CustomDimensionDef, LifecycleStatus, MarketDocument } from './types'

/* ---------- Masthead ---------- */

export function Masthead() {
  const { role, setRole } = useApp()
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <div className="brand">
          <img src={amexLogo} alt="American Express" className="brand-logo" />
          <span className="brand-name">
            Billpay
            <span className="brand-sub">Market Onboarding</span>
          </span>
        </div>
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
    </header>
  )
}

/* ---------- Status pill: active = green, draft = grey ---------- */

export function StatusSeal({ status, small }: { status: LifecycleStatus; small?: boolean }) {
  const active = status === 'ACTIVE'
  return (
    <span className={`seal ${active ? 'seal-active' : 'seal-draft'} ${small ? 'seal-sm' : ''}`}>
      <i className="seal-dot" aria-hidden="true" />
      {active ? 'Active' : 'Draft'}
    </span>
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

/** Shared Escape-to-close behavior for modal & drawer overlays. */
export function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
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
  useEscape(onClose)
  useEffect(() => {
    ref.current?.focus()
  }, [])
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

/* ---------- Custom dimension value input (wizard + detail panel) ---------- */

export function CustomDimValueInput({
  def,
  value,
  onChange,
}: {
  def: CustomDimensionDef
  value: string
  onChange: (v: string) => void
}) {
  if (def.type === 'BOOLEAN') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={def.label}>
        <option value="">Not set</option>
        <option value="true">Y</option>
        <option value="false">N</option>
      </select>
    )
  }
  if (def.type === 'ENUM') {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={def.label}>
        <option value="">Not set</option>
        {def.allowedValues.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    )
  }
  return (
    <input
      value={value}
      placeholder="Value"
      onChange={(e) => onChange(e.target.value)}
      aria-label={def.label}
    />
  )
}

/* ---------- Clone dialog ---------- */

export function CloneDialog({
  source,
  onDone,
  onClose,
}: {
  source: MarketDocument
  onDone: (targetCode: string) => void
  onClose: () => void
}) {
  const { catalog, markets, refreshMarkets } = useApp()
  const [target, setTarget] = useState<string | null>(null)
  const [included, setIncluded] = useState<AccountType[]>(
    source.profiles.map((p) => p.accountType),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const onboarded = new Set(markets.map((m) => m.market.code))
  const candidates = (catalog?.markets ?? []).filter((m) => !onboarded.has(m.code))

  function toggleType(t: AccountType) {
    setIncluded((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    )
  }

  async function doClone() {
    if (!target || included.length === 0) return
    setBusy(true)
    setError(null)
    try {
      await api.clone(source.market.code, target, included)
      await refreshMarkets()
      onDone(target)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal title={`Clone ${source.market.code} configuration`} onClose={onClose}>
      <p className="modal-lede">
        Copies the selected profiles — API selections, dimensions and custom-dimension
        definitions — from <strong>{source.market.name}</strong>. Cloned profiles start as
        drafts.
      </p>

      <h3 className="modal-section">Profiles to include</h3>
      <div className="clone-profiles">
        {source.profiles.map((p) => (
          <label key={p.accountType} className="clone-profile">
            <input
              type="checkbox"
              checked={included.includes(p.accountType)}
              onChange={() => toggleType(p.accountType)}
            />
            <span>{ACCOUNT_TYPE_LABELS[p.accountType]}</span>
            <span className="mono-tag">{p.apis.length} APIs</span>
          </label>
        ))}
      </div>
      {included.length === 0 && (
        <p className="hint-warn">Select at least one profile to clone.</p>
      )}

      <h3 className="modal-section">Target market</h3>
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
        <button
          className="btn primary"
          disabled={!target || included.length === 0 || busy}
          onClick={doClone}
        >
          {busy ? 'Cloning…' : target ? `Clone to ${target}` : 'Clone'}
        </button>
      </div>
    </Modal>
  )
}
