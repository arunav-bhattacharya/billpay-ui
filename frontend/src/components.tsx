import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import { useApp } from './AppContext'
import amexLogo from './assets/amex.svg'
import { ACCOUNT_TYPE_LABELS, DIM_LABELS, ENV_LABELS, flagEmoji } from './lib'
import type {
  AccountType,
  ApiSpec,
  CustomDimensionDef,
  DimValue,
  EnvStage,
  MarketDocument,
} from './types'

/* ---------- Masthead ---------- */

export function Masthead() {
  const { role, setRole } = useApp()
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <div className="brand">
          <img src={amexLogo} alt="American Express" className="brand-logo" />
          <span className="brand-rule" aria-hidden="true" />
          <span className="brand-name">
            <span className="brand-title">Billpay</span>
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

/* ---------- Environment pill: e3 = green, e2 = amber, e1 = grey ---------- */

export function StatusSeal({ status, small }: { status: EnvStage; small?: boolean }) {
  return (
    <span className={`seal seal-${status.toLowerCase()} ${small ? 'seal-sm' : ''}`}>
      <i className="seal-dot" aria-hidden="true" />
      {ENV_LABELS[status]}
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

/* ---------- Shared icons ---------- */

export function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/** Filled green tick — "already onboarded", distinct from the outline CheckIcon. */
export function TickIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="11" fill="currentColor" />
      <path
        d="M7 12.4l3.4 3.3L17 9"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
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
            <CloseIcon />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/* ---------- Dimension value control (wizard + profile editor) ----------

   Shared so the two edit surfaces cannot drift. Width follows the segment
   count, so the strictly-Y/N dimensions degrade to two segments with no
   separate component and no conditional markup. */

export function TriToggle({
  value,
  options,
  locked,
  small,
  label,
  onChange,
}: {
  value: DimValue
  options: DimValue[]
  locked?: boolean
  small?: boolean
  label: string
  onChange: (v: DimValue) => void
}) {
  return (
    <div
      className={`tri ${small ? 'tri-sm' : ''} ${locked ? 'locked' : ''}`}
      role="radiogroup"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="radio"
          aria-checked={value === o}
          disabled={locked}
          className={`tri-opt ${value === o ? 'on' : ''}`}
          onClick={() => onChange(o)}
        >
          {DIM_LABELS[o]}
        </button>
      ))}
    </div>
  )
}

/** Segment set for a dimension, from its catalog metadata. */
export function dimOptions(meta: { allowsBoth?: boolean }): DimValue[] {
  return meta.allowsBoth === false ? ['Y', 'N'] : ['Y', 'N', 'BOTH']
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
        View API spec ↗
      </a>
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

export function JsonView({ data, filename }: { data: unknown; filename: string }) {
  const json = useMemo(() => JSON.stringify(data, null, 2), [data])
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
    <details className="json-view">
      <summary>Market JSON</summary>
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
            {copied ? <CheckIcon /> : <CopyIcon />}
          </button>
        </div>
        <pre dangerouslySetInnerHTML={{ __html: html }} />
      </div>
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
