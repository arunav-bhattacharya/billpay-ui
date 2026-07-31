import { useLayoutEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useApp } from '../AppContext'
import {
  CloneDialog,
  CloseIcon,
  CopyIcon,
  CustomDimValueInput,
  dimOptions,
  ErrorNote,
  Flag,
  JsonView,
  StatusSeal,
  TriToggle,
} from '../components'
import {
  ACCOUNT_TYPE_LABELS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  chipClass,
  DIM_LABELS,
  ENV_LABELS,
  isDimLocked,
  nextEnv,
  setDimension,
  yn,
} from '../lib'
import type {
  AccountType,
  CustomDimensionDef,
  CustomDimensionType,
  Dimensions,
  MarketDocument,
  MarketProfile,
} from '../types'

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
  const panelRef = useRef<HTMLDivElement>(null)
  const [showClone, setShowClone] = useState(false)

  // The expanded card fuses with this panel as a folder tab. Tell the card
  // which sides have a "shoulder" (panel extends past the tab) so CSS can
  // draw a rounded fillet there — a flush side must stay a straight edge.
  useLayoutEffect(() => {
    const panel = panelRef.current
    const card = panel?.previousElementSibling
    if (!panel || !(card instanceof HTMLElement) || !card.classList.contains('market-card')) return
    const place = () => {
      const c = card.getBoundingClientRect()
      const p = panel.getBoundingClientRect()
      card.classList.toggle('shoulder-l', c.left - p.left > 2)
      card.classList.toggle('shoulder-r', p.right - c.right > 2)
    }
    place()
    window.addEventListener('resize', place)
    return () => {
      window.removeEventListener('resize', place)
      card.classList.remove('shoulder-l', 'shoulder-r')
    }
  }, [])
  const [confirmDeleteMarket, setConfirmDeleteMarket] = useState(false)
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
  const promotableCount = market.profiles.filter((p) => p.status !== 'E3').length

  return (
    <div ref={panelRef} className={`detail-panel region-${market.market.region.toLowerCase()}`}>
      <div className="detail-panel-head">
        <div className="detail-title">
          <Flag code={market.market.code} size={26} />
          <h3>{market.market.name}</h3>
          <span className="mono-tag">
            {market.market.code} · {market.market.currency} · {market.market.region}
          </span>
          <StatusSeal status={market.status} />
        </div>
        <div className="detail-actions">
          {canAddType && (
            <button className="btn sm primary" onClick={() => onAddAccountType(market.market.code)}>
              + Account type
            </button>
          )}
          <button
            className="act-btn act-blue"
            title="Clone this market's setup to another market"
            aria-label="Clone market"
            onClick={() => setShowClone(true)}
          >
            <CopyIcon />
          </button>
          {promotableCount > 1 && (
            <button
              className="btn sm ghost"
              disabled={busy}
              onClick={() => run(() => api.promoteAll(market.market.code))}
            >
              Promote all profiles
            </button>
          )}
          <button
            className="act-btn act-red"
            title="Delete market"
            aria-label="Delete market"
            disabled={busy}
            onClick={() => setConfirmDeleteMarket(true)}
          >
            <TrashIcon />
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Collapse details">
            <CloseIcon />
          </button>
        </div>
      </div>

      {confirmDeleteMarket && (
        <div className="confirm-bar" role="alertdialog" aria-label="Confirm market removal">
          <span>
            Remove <strong>{market.market.name}</strong> and all {market.profiles.length} of its
            profiles?
          </span>
          <button
            className="btn sm danger"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api.deleteMarket(market.market.code)
                onClose()
              })
            }
          >
            Yes, remove market
          </button>
          <button className="btn sm ghost" onClick={() => setConfirmDeleteMarket(false)}>
            Cancel
          </button>
        </div>
      )}

      <ErrorNote message={error} />

      <div className="profile-list">
        {market.profiles.length === 0 && (
          <p className="muted">No profiles yet — add an account type to get started.</p>
        )}
        {market.profiles.map((p) => (
          <ProfileCard
            key={p.id ?? p.accountType}
            market={market}
            profile={p}
            busy={busy}
            run={run}
            onPromote={() => p.id && run(() => api.promoteProfile(market.market.code, p.id!))}
            onDelete={() => p.id && run(() => api.deleteProfile(market.market.code, p.id!))}
          />
        ))}
      </div>

      {role === 'ADMIN' && <AdminDefsSection market={market} busy={busy} run={run} />}

      <JsonView data={market} filename={`${market.market.code.toLowerCase()}-market.json`} />

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
  run,
  onPromote,
  onDelete,
}: {
  market: MarketDocument
  profile: MarketProfile
  busy: boolean
  run: (a: () => Promise<unknown>) => Promise<void>
  onPromote: () => void
  onDelete: () => void
}) {
  const { catalog } = useApp()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showCloneTargets, setShowCloneTargets] = useState(false)
  const [editing, setEditing] = useState(false)

  // Account types this profile could be cloned to: allowed for the market
  // and not already carrying a profile.
  const curated = catalog?.markets.find((m) => m.code === market.market.code)
  const allowedTypes: AccountType[] =
    curated?.allowedAccountTypes?.length
      ? curated.allowedAccountTypes
      : (catalog?.accountTypes ?? []).map((t) => t.key)
  const cloneTargets = allowedTypes.filter(
    (t) => !market.profiles.some((p) => p.accountType === t),
  )

  function cloneTo(target: AccountType) {
    setShowCloneTargets(false)
    const copy: MarketProfile = {
      accountType: target,
      status: 'E1',
      apis: [...profile.apis],
      dimensions: { ...profile.dimensions },
      customDimensions: { ...profile.customDimensions },
    }
    run(() =>
      api.updateMarket(market.market.code, { ...market, profiles: [...market.profiles, copy] }),
    )
  }

  const byCategory = CATEGORY_ORDER.map((cat) => ({
    cat,
    apis: (catalog?.apis ?? []).filter(
      (a) => a.category === cat && profile.apis.includes(a.name),
    ),
  })).filter((g) => g.apis.length > 0)

  const dims = catalog?.dimensions ?? []
  const customEntries = Object.entries(profile.customDimensions)

  if (editing) {
    return (
      <article className="profile-card editing">
        <div className="profile-card-head">
          <h4>{ACCOUNT_TYPE_LABELS[profile.accountType]}</h4>
          <StatusSeal status={profile.status} small />
          <span className="mono-tag">editing</span>
        </div>
        <ProfileEditor
          market={market}
          profile={profile}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSave={async (updated) => {
            const profiles = market.profiles.map((p) => (p.id === profile.id ? updated : p))
            await run(() => api.updateMarket(market.market.code, { ...market, profiles }))
            setEditing(false)
          }}
        />
      </article>
    )
  }

  return (
    <article className="profile-card">
      <div className="profile-card-head">
        <h4>{ACCOUNT_TYPE_LABELS[profile.accountType]}</h4>
        <StatusSeal status={profile.status} small />
        <span className="spacer" />
        {nextEnv(profile.status) && (
          <button className="btn sm primary" disabled={busy} onClick={onPromote}>
            Promote to {ENV_LABELS[nextEnv(profile.status)!]}
          </button>
        )}
        <button
          className="act-btn act-blue"
          title="Edit profile"
          aria-label={`Edit ${ACCOUNT_TYPE_LABELS[profile.accountType]} profile`}
          disabled={busy}
          onClick={() => setEditing(true)}
        >
          <PencilIcon />
        </button>
        {cloneTargets.length > 0 && (
          <button
            className="act-btn act-blue"
            title="Clone to another account type"
            aria-label={`Clone ${ACCOUNT_TYPE_LABELS[profile.accountType]} profile to another account type`}
            disabled={busy}
            onClick={() => setShowCloneTargets((v) => !v)}
          >
            <CopyIcon />
          </button>
        )}
        <button
          className="act-btn act-red"
          title="Delete profile"
          aria-label={`Delete ${ACCOUNT_TYPE_LABELS[profile.accountType]} profile`}
          disabled={busy}
          onClick={() => setConfirmDelete(true)}
        >
          <TrashIcon />
        </button>
      </div>

      {showCloneTargets && (
        <div className="confirm-bar" role="dialog" aria-label="Clone profile to another account type">
          <span>
            Copy the <strong>{ACCOUNT_TYPE_LABELS[profile.accountType]}</strong> setup to:
          </span>
          {cloneTargets.map((t) => (
            <button key={t} className="btn sm primary" disabled={busy} onClick={() => cloneTo(t)}>
              {ACCOUNT_TYPE_LABELS[t]}
            </button>
          ))}
          <button className="btn sm ghost" onClick={() => setShowCloneTargets(false)}>
            Cancel
          </button>
        </div>
      )}

      {confirmDelete && (
        <div className="confirm-bar" role="alertdialog" aria-label="Confirm profile removal">
          <span>
            Remove the <strong>{ACCOUNT_TYPE_LABELS[profile.accountType]}</strong> profile from{' '}
            {market.market.name}?
          </span>
          <button
            className="btn sm danger"
            disabled={busy}
            onClick={() => {
              setConfirmDelete(false)
              onDelete()
            }}
          >
            Yes, remove profile
          </button>
          <button className="btn sm ghost" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
        </div>
      )}

      <div className="profile-dims">
        {dims.map((d) => (
          <span
            key={d.key}
            className={`chip ${chipClass(profile.dimensions[d.key])}`}
            title={d.description}
          >
            {d.label}: {DIM_LABELS[profile.dimensions[d.key]]}
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
                <span
                  key={a.name}
                  className={`chip chip-grad cat-${cat.toLowerCase()}`}
                  title={a.summary}
                >
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

/* ---------- action icons ---------- */

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" y1="11" x2="10" y2="17" />
      <line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  )
}

/* ---------- Inline profile editor: APIs, dimensions, custom values ---------- */

function ProfileEditor({
  market,
  profile,
  busy,
  onCancel,
  onSave,
}: {
  market: MarketDocument
  profile: MarketProfile
  busy: boolean
  onCancel: () => void
  onSave: (updated: MarketProfile) => void
}) {
  const { catalog, role } = useApp()
  const [apis, setApis] = useState<string[]>(profile.apis)
  const [dims, setDims] = useState<Dimensions>({ ...profile.dimensions })
  const [customValues, setCustomValues] = useState<Record<string, string>>({
    ...profile.customDimensions,
  })

  function toggleApi(name: string) {
    setApis((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]))
  }

  const canSave = apis.length > 0

  return (
    <div className="profile-editor">
      <div className="pe-section">
        <h5>APIs</h5>
        <div className="pe-api-groups">
          {CATEGORY_ORDER.map((cat) => (
            <div key={cat} className="pe-api-group">
              <span className={`pe-cat cat-${cat.toLowerCase()}`}>{CATEGORY_LABELS[cat]}</span>
              {(catalog?.apis ?? [])
                .filter((a) => a.category === cat)
                .map((a) => (
                  <label key={a.name} className="pe-api" title={a.summary}>
                    <input
                      type="checkbox"
                      checked={apis.includes(a.name)}
                      onChange={() => toggleApi(a.name)}
                    />
                    <span>{a.name}</span>
                  </label>
                ))}
            </div>
          ))}
        </div>
      </div>

      <div className="pe-section">
        <h5>Dimensions</h5>
        <div className="pe-dims">
          {(catalog?.dimensions ?? []).map((d) => {
            const locked = isDimLocked(d.key, dims)
            return (
              <div
                key={d.key}
                className={`pe-dim ${locked ? 'locked' : ''}`}
                title={
                  locked ? 'Locked to N while Realtime Clearing is Y.' : d.description
                }
              >
                <span>{d.label}</span>
                <TriToggle
                  value={dims[d.key]}
                  options={dimOptions(d)}
                  locked={locked}
                  small
                  label={d.label}
                  onChange={(next) => setDims(setDimension(dims, d.key, next))}
                />
              </div>
            )
          })}
        </div>
      </div>

      {market.customDimensionDefs.length > 0 && role === 'ADMIN' && (
        <div className="pe-section">
          <h5>Custom dimensions</h5>
          <div className="custom-dim-values">
            {market.customDimensionDefs.map((def) => (
              <label key={def.key} className="custom-dim-value">
                <span>{def.label}</span>
                <CustomDimValueInput
                  def={def}
                  value={customValues[def.key] ?? ''}
                  onChange={(v) => setCustomValues({ ...customValues, [def.key]: v })}
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {!canSave && <p className="hint-warn">Select at least one API.</p>}

      <div className="pe-actions">
        <button className="btn sm ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn sm primary"
          disabled={busy || !canSave}
          onClick={() =>
            onSave({
              ...profile,
              apis,
              dimensions: dims,
              customDimensions: Object.fromEntries(
                Object.entries(customValues).filter(([, v]) => v !== ''),
              ),
            })
          }
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
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
      api.updateMarket(market.market.code, { ...market, customDimensionDefs: defs, profiles }),
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
    run(() => api.updateMarket(market.market.code, { ...market, profiles }))
  }

  return (
    <section className="admin-dims">
      <div className="admin-dims-head">
        <h4>Custom dimensions</h4>
        <span className="admin-badge">Admin</span>
      </div>
      <p className="step-hint">
        Hidden from operators. Definitions apply to {market.market.name}; values are per profile.
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
