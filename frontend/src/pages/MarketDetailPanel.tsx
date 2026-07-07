import { useState } from 'react'
import { api } from '../api'
import { useApp } from '../AppContext'
import { CloneDialog, CustomDimValueInput, ErrorNote, Flag, StatusSeal } from '../components'
import { ACCOUNT_TYPE_LABELS, CATEGORY_LABELS, CATEGORY_ORDER, yn } from '../lib'
import type { CustomDimensionDef, CustomDimensionType, MarketDocument, MarketProfile } from '../types'

export function MarketDetailPanel({
  market,
  onClose,
  onAddAccountType,
  onCloned,
}: {
  market: MarketDocument
  onClose: () => void
  onAddAccountType: (code: string) => void
  onCloned: (targetCode: string) => void
}) {
  const { refreshMarkets, role } = useApp()
  const [showClone, setShowClone] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refreshMarkets()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const canAddType = market.profiles.length < 3
  const draftCount = market.profiles.filter((p) => p.status === 'DRAFT').length

  return (
    <div className="detail-panel">
      <div className="detail-panel-head">
        <div className="detail-title">
          <Flag code={market.code} size={26} />
          <h3>{market.name}</h3>
          <span className="mono-tag">
            {market.code} · {market.currency} · {market.region}
          </span>
          <StatusSeal status={market.status} />
        </div>
        <div className="detail-actions">
          {canAddType && (
            <button className="btn sm ghost" onClick={() => onAddAccountType(market.code)}>
              + Account type
            </button>
          )}
          <button className="btn sm ghost" onClick={() => setShowClone(true)}>
            Clone
          </button>
          {draftCount > 1 && (
            <button
              className="btn sm ghost"
              disabled={busy}
              onClick={() => run(() => api.activate(market.code))}
            >
              Activate all profiles
            </button>
          )}
          <button className="icon-btn" onClick={onClose} aria-label="Collapse details">
            ✕
          </button>
        </div>
      </div>

      <ErrorNote message={error} />

      <div className="profile-list">
        {market.profiles.map((p) => (
          <ProfileCard
            key={p.id ?? p.accountType}
            market={market}
            profile={p}
            busy={busy}
            onActivate={() => run(() => api.activate(market.code, p.id))}
          />
        ))}
      </div>

      {role === 'ADMIN' && <AdminDefsSection market={market} busy={busy} run={run} />}

      <details className="json-view">
        <summary>Market JSON document</summary>
        <pre>{JSON.stringify(market, null, 2)}</pre>
      </details>

      <div className="danger-zone">
        {confirmDelete ? (
          <>
            <span>Remove {market.name} and all its profiles?</span>
            <button
              className="btn sm danger"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await api.deleteMarket(market.code)
                  onClose()
                })
              }
            >
              Yes, remove market
            </button>
            <button className="btn sm ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="link-btn danger" onClick={() => setConfirmDelete(true)}>
            Remove this market…
          </button>
        )}
      </div>

      {showClone && (
        <CloneDialog
          source={market}
          onClose={() => setShowClone(false)}
          onDone={(target) => {
            setShowClone(false)
            onCloned(target)
          }}
        />
      )}
    </div>
  )
}

function ProfileCard({
  market,
  profile,
  busy,
  onActivate,
}: {
  market: MarketDocument
  profile: MarketProfile
  busy: boolean
  onActivate: () => void
}) {
  const { catalog } = useApp()
  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    apis: (catalog?.apis ?? []).filter(
      (a) => a.category === cat && profile.apis.includes(a.name),
    ),
  })).filter((g) => g.apis.length > 0)

  const dims = catalog?.dimensions ?? []
  const customEntries = Object.entries(profile.customDimensions)

  return (
    <article className="profile-card">
      <div className="profile-card-head">
        <h4>{ACCOUNT_TYPE_LABELS[profile.accountType]}</h4>
        <StatusSeal status={profile.status} small />
        {profile.status === 'DRAFT' && (
          <button className="btn sm primary" disabled={busy} onClick={onActivate}>
            Activate
          </button>
        )}
      </div>

      <div className="profile-dims">
        {dims.map((d) => (
          <span
            key={d.key}
            className={`chip ${profile.dimensions[d.key] ? 'chip-yes' : 'chip-off'}`}
            title={d.description}
          >
            {d.label}: {yn(profile.dimensions[d.key])}
          </span>
        ))}
        {customEntries.map(([k, v]) => {
          const def = market.customDimensionDefs.find((d) => d.key === k)
          return (
            <span key={k} className="chip chip-custom" title={def?.description ?? k}>
              {def?.label ?? k}: {def?.type === 'BOOLEAN' ? yn(v) : v}
            </span>
          )
        })}
      </div>

      <div className="profile-apis">
        {byCategory.map(({ cat, apis }) => (
          <div key={cat} className="profile-api-group">
            <span className={`profile-api-cat cat-${cat.toLowerCase()}`}>
              {CATEGORY_LABELS[cat]}
            </span>
            <div className="review-chips">
              {apis.map((a) => (
                <span key={a.name} className="chip" title={a.summary}>
                  {a.name}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </article>
  )
}

/* ---------- Admin: market-level custom dimension definitions ---------- */

function AdminDefsSection({
  market,
  busy,
  run,
}: {
  market: MarketDocument
  busy: boolean
  run: (a: () => Promise<unknown>) => Promise<void>
}) {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [type, setType] = useState<CustomDimensionType>('BOOLEAN')
  const [values, setValues] = useState('')
  const [formError, setFormError] = useState<string | null>(null)

  function saveDefs(defs: CustomDimensionDef[], alsoStripKey?: string) {
    const profiles = alsoStripKey
      ? market.profiles.map((p) => {
          const cd = { ...p.customDimensions }
          delete cd[alsoStripKey]
          return { ...p, customDimensions: cd }
        })
      : market.profiles
    return run(() =>
      api.updateMarket(market.code, { ...market, customDimensionDefs: defs, profiles }),
    )
  }

  function addDef() {
    const k = key.trim()
    if (!k || !label.trim()) {
      setFormError('Key and label are required.')
      return
    }
    if (market.customDimensionDefs.some((d) => d.key === k)) {
      setFormError(`'${k}' is already defined.`)
      return
    }
    const allowedValues =
      type === 'ENUM' ? values.split(',').map((v) => v.trim()).filter(Boolean) : []
    if (type === 'ENUM' && allowedValues.length === 0) {
      setFormError('Enum dimensions need at least one allowed value.')
      return
    }
    setFormError(null)
    saveDefs([...market.customDimensionDefs, { key: k, label: label.trim(), type, allowedValues }])
    setKey('')
    setLabel('')
    setValues('')
  }

  function setProfileValue(profile: MarketProfile, defKey: string, value: string) {
    const profiles = market.profiles.map((p) =>
      p === profile
        ? {
            ...p,
            customDimensions:
              value === ''
                ? Object.fromEntries(
                    Object.entries(p.customDimensions).filter(([k]) => k !== defKey),
                  )
                : { ...p.customDimensions, [defKey]: value },
          }
        : p,
    )
    run(() => api.updateMarket(market.code, { ...market, profiles }))
  }

  return (
    <section className="admin-dims">
      <div className="admin-dims-head">
        <h4>Custom dimensions</h4>
        <span className="admin-badge">Admin</span>
      </div>
      <p className="step-hint">
        Hidden from operators. Definitions apply to {market.name}; values are per profile.
      </p>

      {market.customDimensionDefs.length === 0 && (
        <p className="muted">No custom dimensions defined for this market.</p>
      )}

      {market.customDimensionDefs.map((def) => (
        <div key={def.key} className="custom-dim-row">
          <div>
            <span className="dim-name">{def.label}</span>{' '}
            <span className="mono-tag">
              {def.key} · {def.type}
              {def.type === 'ENUM' ? ` (${def.allowedValues.join(', ')})` : ''}
            </span>
            <button
              className="link-btn danger"
              disabled={busy}
              onClick={() =>
                saveDefs(market.customDimensionDefs.filter((d) => d.key !== def.key), def.key)
              }
            >
              remove
            </button>
          </div>
          <div className="custom-dim-values">
            {market.profiles.map((p) => (
              <label key={p.id ?? p.accountType} className="custom-dim-value">
                <span>{ACCOUNT_TYPE_LABELS[p.accountType]}</span>
                <CustomDimValueInput
                  def={def}
                  value={p.customDimensions[def.key] ?? ''}
                  onChange={(v) => setProfileValue(p, def.key, v)}
                />
              </label>
            ))}
          </div>
        </div>
      ))}

      <div className="def-form">
        <input placeholder="key (camelCase)" value={key} onChange={(e) => setKey(e.target.value)} aria-label="Dimension key" />
        <input placeholder="Label" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Dimension label" />
        <select value={type} onChange={(e) => setType(e.target.value as CustomDimensionType)} aria-label="Dimension type">
          <option value="BOOLEAN">Boolean</option>
          <option value="ENUM">Enum</option>
          <option value="TEXT">Text</option>
        </select>
        {type === 'ENUM' && (
          <input
            placeholder="Allowed values, comma-separated"
            value={values}
            onChange={(e) => setValues(e.target.value)}
            aria-label="Allowed values"
          />
        )}
        <button className="btn sm ghost" disabled={busy} onClick={addDef}>
          Add dimension
        </button>
      </div>
      <ErrorNote message={formError} />
    </section>
  )
}
