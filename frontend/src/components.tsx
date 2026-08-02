import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from './api'
import { useApp } from './AppContext'
import amexLogo from './assets/amex.svg'
import { Arrow, CheckMark, CloseIcon, CopyIcon, Flag } from './icons'
import { ACCOUNT_TYPE_LABELS, ENV_LABELS } from './lib'
import type { AccountType, ApiSpec, EnvStage, MarketDocument, Role } from './types'

/* ---------- Masthead ---------- */

export function Masthead() {
  return (
    <header className="masthead">
      <div className="masthead-inner">
        {/* The lockup is the way home from anywhere in the app. */}
        <Link className="brand" to="/" aria-label="Billpay Market Onboarding — back to markets">
          <img src={amexLogo} alt="American Express" className="brand-logo" />
          <span className="brand-rule" aria-hidden="true" />
          <span className="brand-name">
            <span className="brand-title">Billpay</span>
            <span className="brand-sub">Market Onboarding</span>
          </span>
        </Link>
        <div className="mast-right">
          <RoleMenu />
        </div>
      </div>
    </header>
  )
}

/* ---------- Who you are acting as ---------- */

const ROLE_LABELS: Record<Role, string> = {
  OPERATOR: 'Operator',
  ADMIN: 'Admin',
}

const ROLE_NOTES: Record<Role, string> = {
  OPERATOR: 'Onboards markets and edits account profiles.',
  ADMIN: 'Also defines the custom behaviors a market carries.',
}

const ROLES: Role[] = ['OPERATOR', 'ADMIN']

/**
 * Who the session is acting as. Lives in the masthead alongside the brand,
 * since it is session context rather than part of any one page. Every mutating
 * request is attributed to whoever is named here.
 */
function RoleMenu() {
  const { role, setRole } = useApp()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEscape(() => setOpen(false))

  // A menu that stays open after you have clicked elsewhere is a menu you
  // have to dismiss twice.
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [open])

  return (
    <div className={`role-menu ${open ? 'open' : ''}`} ref={ref}>
      <button
        className="role-trigger"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        <span>
          Logged in as <strong>{ROLE_LABELS[role]}</strong>
        </span>
        <span className="chevron" aria-hidden="true" />
      </button>

      {open && (
        <div className="role-options" role="menu" aria-label="Switch role">
          {ROLES.map((r) => (
            <button
              key={r}
              role="menuitemradio"
              aria-checked={role === r}
              className={`role-option ${role === r ? 'on' : ''}`}
              onClick={() => {
                setRole(r)
                setOpen(false)
              }}
            >
              <span className="role-option-name">
                {ROLE_LABELS[r]}
                {role === r && <CheckMark />}
              </span>
              <span className="role-option-note">{ROLE_NOTES[r]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- Environment pill: e3 = green, e2 = amber, e1 = grey ---------- */

export function StatusSeal({
  status,
  small,
  onDark,
}: {
  status: EnvStage
  small?: boolean
  /** Inverted fill for the navy banner, where the light washes disappear. */
  onDark?: boolean
}) {
  return (
    <span
      className={`seal seal-${status.toLowerCase()} ${small ? 'seal-sm' : ''} ${
        onDark ? 'seal-dark' : ''
      }`}
    >
      <i className="seal-dot" aria-hidden="true" />
      {ENV_LABELS[status]}
    </span>
  )
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
function useEscape(onClose: () => void) {
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
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/* ---------- API identity (wizard, profile editor, API view) ----------

   One shape for naming an API everywhere: the plain-language title, with the
   versioned identifier beneath it in mono as the thing you paste into code.
   The HTTP verb is not part of it — it belongs to the endpoint, which the
   detail body spells out in full. */

export function ApiIdentity({ spec }: { spec: ApiSpec }) {
  return (
    <span className="api-identity">
      <span className="api-title">{spec.title}</span>
      <span className="api-ident-name mono-tag">{spec.name}</span>
    </span>
  )
}

/* ---------- API detail body (wizard selection + API view) ----------

   Shared so both surfaces show the same contract, endpoint and spec link. */

export function ApiDetailBody({ spec }: { spec: ApiSpec }) {
  return (
    <div className="api-detail-body">
      <p className="api-detail-desc">{spec.description}</p>
      <div className="api-detail-meta">
        <span className="api-endpoint-label">Billpay-Core endpoint</span>
        <span className="mono-tag">
          <b>{spec.method}</b> {spec.path}
        </span>
      </div>
      <a className="api-spec-link" href={spec.specUrl} target="_blank" rel="noreferrer">
        View API spec
        <Arrow direction="up-right" />
      </a>
    </div>
  )
}

/* ---------- Rich JSON viewer ---------- */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** Token-colorized JSON: keys, strings, numbers, booleans, null. */
function highlightJson(json: string): string {
  return escapeHtml(json).replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'jn'
      if (match.startsWith('"')) cls = match.endsWith(':') ? 'jk' : 'js'
      else if (match === 'true' || match === 'false') cls = 'jb'
      else if (match === 'null') cls = 'j0'
      return `<span class="${cls}">${match}</span>`
    },
  )
}

/**
 * The rendered JSON pane, without the disclosure around it — the market view
 * wraps it in a `<details>`, the revision diffs place two side by side.
 */
export function JsonBlock({ json, filename }: { json: string; filename: string }) {
  const html = useMemo(() => highlightJson(json), [json])
  const [copied, setCopied] = useState(false)

  async function copy() {
    // The async clipboard API is unavailable outside secure contexts and can
    // be denied outright; without a fallback it rejects and the button never
    // acknowledges the click.
    try {
      await navigator.clipboard.writeText(json)
    } catch {
      const ta = document.createElement('textarea')
      ta.value = json
      ta.setAttribute('readonly', '')
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      ta.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div className="json-block">
      <div className="json-head">
        <span className="json-dots" aria-hidden="true">
          <i /> <i /> <i />
        </span>
        <span className="json-name">{filename}</span>
        <span className="json-meta">{json.split('\n').length} lines</span>
        <button
          className={`json-copy ${copied ? 'copied' : ''}`}
          onClick={copy}
          aria-label={copied ? 'Copied' : 'Copy JSON'}
          title={copied ? 'Copied' : 'Copy JSON'}
        >
          {copied ? <CheckMark /> : <CopyIcon />}
        </button>
      </div>
      <pre dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

export function JsonView({ data, filename }: { data: unknown; filename: string }) {
  const json = useMemo(() => JSON.stringify(data, null, 2), [data])

  return (
    <details className="json-view">
      <summary>Market profile</summary>
      <JsonBlock json={json} filename={filename} />
    </details>
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
        Copies the selected profiles — API selections, behavior and custom-behavior
        definitions — from <strong>{source.market.name}</strong>. Cloned profiles start in
        e1.
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
