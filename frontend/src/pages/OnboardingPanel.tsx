import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import { useApp } from '../AppContext'
import { CustomDimValueInput, ErrorNote, Flag, useEscape } from '../components'
import { ACCOUNT_TYPE_LABELS, CATEGORY_LABELS, CATEGORY_ORDER, yn } from '../lib'
import { DIMENSION_KEYS, EMPTY_DIMENSIONS } from '../types'
import type {
  AccountType,
  ApiSpec,
  CustomDimensionDef,
  CustomDimensionType,
  DimensionKey,
  Dimensions,
  MarketDocument,
  MarketProfile,
} from '../types'

const STEPS = ['Market & account type', 'APIs', 'Dimensions', 'Review & save']

export function OnboardingPanel({
  presetMarket,
  onClose,
  onDone,
}: {
  presetMarket: string | null
  onClose: () => void
  onDone: (code: string) => void
}) {
  const { catalog, markets, refreshMarkets, role } = useApp()
  const panelRef = useRef<HTMLElement>(null)

  const [step, setStep] = useState(0)
  const [maxStep, setMaxStep] = useState(0) // furthest step reached
  const [marketCode, setMarketCode] = useState<string | null>(presetMarket)
  const [accountType, setAccountType] = useState<AccountType | null>(null)
  const [selectedApis, setSelectedApis] = useState<string[]>([])
  const [dims, setDims] = useState<Dimensions>({ ...EMPTY_DIMENSIONS })
  const [newDefs, setNewDefs] = useState<CustomDimensionDef[]>([])
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [drawerApi, setDrawerApi] = useState<ApiSpec | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const existing = markets.find((m) => m.code === marketCode) ?? null
  const takenTypes = existing?.profiles.map((p) => p.accountType) ?? []
  const selectedCurated = (catalog?.markets ?? []).find((m) => m.code === marketCode) ?? null

  /** Guidance only: which selected APIs suggest each dimension. Nothing auto-selects. */
  const suggestedBy = useMemo(() => {
    const map = new Map<DimensionKey, string[]>()
    for (const spec of catalog?.apis ?? []) {
      if (!selectedApis.includes(spec.name)) continue
      for (const dim of spec.suggests) {
        map.set(dim, [...(map.get(dim) ?? []), spec.name])
      }
    }
    return map
  }, [catalog, selectedApis])

  const allDefs = [...(existing?.customDimensionDefs ?? []), ...newDefs]

  const stepValid = [
    marketCode !== null && accountType !== null && !takenTypes.includes(accountType!),
    selectedApis.length > 0,
    true,
    true,
  ]

  // Keep the panel in view when it opens and when the step changes.
  useEffect(() => {
    panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [step])

  function goTo(i: number) {
    if (i <= maxStep || (i === step + 1 && stepValid[step])) {
      setStep(i)
      setMaxStep((m) => Math.max(m, i))
    }
  }

  function advance() {
    if (stepValid[step]) goTo(step + 1)
  }

  function stepSummary(i: number): string {
    switch (i) {
      case 0:
        return marketCode && accountType
          ? `${selectedCurated?.name ?? marketCode} · ${ACCOUNT_TYPE_LABELS[accountType]}`
          : ''
      case 1:
        return selectedApis.length > 0 ? `${selectedApis.length} APIs selected` : ''
      case 2: {
        const on = DIMENSION_KEYS.filter((k) => dims[k])
        const parts = [
          on.length === 0 ? 'no dimension flags' : `${on.length} flag${on.length > 1 ? 's' : ''} on`,
        ]
        const set = Object.values(customValues).filter((v) => v !== '').length
        if (set > 0) parts.push(`${set} custom`)
        return parts.join(' · ')
      }
      default:
        return ''
    }
  }

  function buildDocument(activate: boolean): MarketDocument {
    const profile: MarketProfile = {
      accountType: accountType!,
      status: activate ? 'ACTIVE' : 'DRAFT',
      apis: selectedApis,
      dimensions: dims,
      customDimensions: Object.fromEntries(
        Object.entries(customValues).filter(
          ([k, v]) => v !== '' && allDefs.some((d) => d.key === k),
        ),
      ),
    }
    if (existing) {
      return {
        ...existing,
        customDimensionDefs: allDefs,
        profiles: [...existing.profiles, profile],
      }
    }
    return {
      code: marketCode!,
      name: selectedCurated?.name ?? '',
      currency: selectedCurated?.currency ?? '',
      region: selectedCurated?.region ?? '',
      status: 'DRAFT',
      customDimensionDefs: allDefs,
      profiles: [profile],
    }
  }

  async function save(activate: boolean) {
    setSaving(true)
    setSaveError(null)
    try {
      const doc = buildDocument(activate)
      if (existing) await api.updateMarket(existing.code, doc)
      else await api.createMarket(doc)
      await refreshMarkets()
      onDone(marketCode!)
    } catch (e) {
      setSaveError((e as Error).message)
      setSaving(false)
    }
  }

  if (!catalog) return null

  return (
    <section className="onboard-panel" ref={panelRef} aria-label="Onboarding">
      <div className="onboard-head">
        <div>
          <div className="eyebrow">Onboarding journey</div>
          <h2>
            {existing ? `New account type for ${existing.name}` : 'Onboard a market'}
          </h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close onboarding">
          ✕
        </button>
      </div>

      <div className="accordion">
        {STEPS.map((label, i) => {
          const open = i === step
          const done = i < step || (i !== step && i <= maxStep && stepValid[i])
          return (
            <div key={label} className={`acc-step ${open ? 'open' : ''} ${done ? 'done' : ''}`}>
              <button
                className="acc-head"
                aria-expanded={open}
                disabled={!open && i > maxStep && !(i === step + 1 && stepValid[step])}
                onClick={() => goTo(i)}
              >
                <span className="acc-num">{done && !open ? '✓' : i + 1}</span>
                <span className="acc-label">{label}</span>
                {!open && stepSummary(i) && (
                  <span className="acc-summary">{stepSummary(i)}</span>
                )}
                {!open && done && <span className="acc-edit">Edit</span>}
              </button>

              {open && (
                <div className="acc-body">
                  {i === 0 && (
                    <StepMarket
                      markets={markets}
                      marketCode={marketCode}
                      presetLocked={presetMarket !== null}
                      accountType={accountType}
                      takenTypes={takenTypes}
                      onMarket={(c) => {
                        setMarketCode(c)
                        setAccountType(null)
                      }}
                      onAccountType={setAccountType}
                    />
                  )}
                  {i === 1 && (
                    <StepApis
                      selectedApis={selectedApis}
                      suggestedBy={suggestedBy}
                      dims={dims}
                      setDims={setDims}
                      onToggle={(name) =>
                        setSelectedApis((prev) =>
                          prev.includes(name)
                            ? prev.filter((n) => n !== name)
                            : [...prev, name],
                        )
                      }
                      onDetails={setDrawerApi}
                    />
                  )}
                  {i === 2 && (
                    <StepDimensions
                      suggestedBy={suggestedBy}
                      dims={dims}
                      setDims={setDims}
                      isAdmin={role === 'ADMIN'}
                      existingDefs={existing?.customDimensionDefs ?? []}
                      newDefs={newDefs}
                      setNewDefs={setNewDefs}
                      customValues={customValues}
                      setCustomValues={setCustomValues}
                    />
                  )}
                  {i === 3 && (
                    <StepReview
                      document={buildDocument(false)}
                      accountType={accountType!}
                      selectedApis={selectedApis}
                      dims={dims}
                      customValues={customValues}
                      allDefs={allDefs}
                    />
                  )}

                  <ErrorNote message={i === 3 ? saveError : null} />

                  <div className="acc-actions">
                    {i > 0 && (
                      <button className="btn ghost" onClick={() => setStep(i - 1)} disabled={saving}>
                        Back
                      </button>
                    )}
                    <span className="spacer" />
                    {i < 3 ? (
                      <button className="btn primary" disabled={!stepValid[i]} onClick={advance}>
                        Continue
                      </button>
                    ) : (
                      <>
                        <button className="btn ghost" disabled={saving} onClick={() => save(false)}>
                          Save as draft
                        </button>
                        <button className="btn primary" disabled={saving} onClick={() => save(true)}>
                          {saving ? 'Saving…' : 'Save & activate'}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {drawerApi && <ApiDrawer spec={drawerApi} onClose={() => setDrawerApi(null)} />}
    </section>
  )
}

/* ================= Step 1: market & account type (side by side) ================= */

function StepMarket({
  markets,
  marketCode,
  presetLocked,
  accountType,
  takenTypes,
  onMarket,
  onAccountType,
}: {
  markets: MarketDocument[]
  marketCode: string | null
  presetLocked: boolean
  accountType: AccountType | null
  takenTypes: AccountType[]
  onMarket: (c: string) => void
  onAccountType: (t: AccountType) => void
}) {
  const { catalog } = useApp()
  const [query, setQuery] = useState('')
  const onboarded = new Map(markets.map((m) => [m.code, m]))
  const shown = (catalog?.markets ?? []).filter(
    (m) =>
      m.name.toLowerCase().includes(query.toLowerCase()) ||
      m.code.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <div className="split-cols">
      <div className="split-left">
        <h3 className="split-title">Market</h3>
        {!presetLocked && (
          <input
            className="search"
            placeholder="Search markets…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search markets"
          />
        )}
        <div className="market-pick-list" role="listbox" aria-label="Markets">
          {shown.map((m) => {
            const doc = onboarded.get(m.code)
            const full = doc && doc.profiles.length >= 3
            const disabled = (presetLocked && m.code !== marketCode) || !!full
            return (
              <button
                key={m.code}
                role="option"
                aria-selected={marketCode === m.code}
                className={`pick-row ${marketCode === m.code ? 'sel' : ''}`}
                disabled={disabled}
                onClick={() => onMarket(m.code)}
              >
                <Flag code={m.code} size={18} />
                <span className="pick-name">{m.name}</span>
                <span className="mono-tag">{m.code}</span>
                {doc && (
                  <span className={`pick-note ${full ? 'full' : ''}`}>
                    {full ? 'complete' : 'onboarded'}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      <div className="split-right">
        <h3 className="split-title">Account type</h3>
        {!marketCode ? (
          <p className="muted">Choose a market first.</p>
        ) : (
          <div className="account-stack">
            {(catalog?.accountTypes ?? []).map((t) => {
              const taken = takenTypes.includes(t.key)
              return (
                <button
                  key={t.key}
                  className={`account-cell ${accountType === t.key ? 'sel' : ''}`}
                  disabled={taken}
                  onClick={() => onAccountType(t.key)}
                >
                  <span className="account-name">{t.label}</span>
                  <span className="account-desc">{t.description}</span>
                  {taken && (
                    <span className="pick-note full">Already onboarded in {marketCode}</span>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

/* ================= Step 2: APIs + suggestions ================= */

function StepApis({
  selectedApis,
  suggestedBy,
  dims,
  setDims,
  onToggle,
  onDetails,
}: {
  selectedApis: string[]
  suggestedBy: Map<DimensionKey, string[]>
  dims: Dimensions
  setDims: (d: Dimensions) => void
  onToggle: (name: string) => void
  onDetails: (spec: ApiSpec) => void
}) {
  const { catalog } = useApp()
  if (!catalog) return null
  return (
    <div className="apis-layout">
      <div className="apis-list">
        <p className="step-hint">
          Hover an API for a summary; open <em>Details</em> for the full contract. APIs may
          <strong> suggest</strong> dimensions — nothing is selected for you.
        </p>
        {CATEGORY_ORDER.map((cat) => (
          <div key={cat} className="api-category">
            <h4 className={`api-cat-head cat-${cat.toLowerCase()}`}>
              <span className="cat-mark" aria-hidden="true" />
              {CATEGORY_LABELS[cat]}
              <span className="api-cat-count">
                {catalog.apis.filter((a) => a.category === cat && selectedApis.includes(a.name)).length}
                {' / '}
                {catalog.apis.filter((a) => a.category === cat).length}
              </span>
            </h4>
            <div className="api-cards">
              {catalog.apis
                .filter((a) => a.category === cat)
                .map((spec) => {
                  const sel = selectedApis.includes(spec.name)
                  return (
                    <div
                      key={spec.name}
                      className={`api-card cat-${cat.toLowerCase()} ${sel ? 'sel' : ''}`}
                    >
                      <button
                        className="api-main"
                        aria-pressed={sel}
                        onClick={() => onToggle(spec.name)}
                      >
                        <span className="api-check" aria-hidden="true">
                          {sel ? '✓' : ''}
                        </span>
                        <span className="api-name">{spec.name}</span>
                        <span className="api-endpoint">
                          <b>{spec.method}</b> {spec.path}
                        </span>
                      </button>
                      <button className="api-details" onClick={() => onDetails(spec)}>
                        Details
                      </button>
                      <div className="api-pop" role="tooltip">
                        <p>{spec.summary}</p>
                        {spec.suggests.length > 0 && (
                          <p className="api-pop-implies">
                            Suggests{' '}
                            {spec.suggests
                              .map((d) => catalog.dimensions.find((x) => x.key === d)?.label ?? d)
                              .join(', ')}
                          </p>
                        )}
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        ))}
      </div>

      <aside className="dim-panel" aria-label="Suggested dimensions">
        <h4>Suggested dimensions</h4>
        <p className="dim-panel-hint">
          Guidance from your API selection — apply them or decide in the next step.
        </p>
        {catalog.dimensions.map((d) => {
          const sources = suggestedBy.get(d.key) ?? []
          const on = dims[d.key]
          return (
            <div key={d.key} className={`dim-row ${on ? 'on' : sources.length > 0 ? 'hint' : ''}`}>
              <span className="dim-lamp" aria-hidden="true" />
              <div className="dim-row-main">
                <div className="dim-name">{d.label}</div>
                <div className="dim-src">
                  {sources.length > 0 ? `suggested by ${sources.join(', ')}` : 'no suggestion'}
                </div>
              </div>
              {sources.length > 0 && !on && (
                <button
                  className="btn xs ghost"
                  onClick={() => setDims({ ...dims, [d.key]: true })}
                >
                  Apply
                </button>
              )}
              {on && <span className="dim-on-note">on</span>}
            </div>
          )
        })}
      </aside>
    </div>
  )
}

/* ================= Step 3: dimensions (always manual) ================= */

function StepDimensions({
  suggestedBy,
  dims,
  setDims,
  isAdmin,
  existingDefs,
  newDefs,
  setNewDefs,
  customValues,
  setCustomValues,
}: {
  suggestedBy: Map<DimensionKey, string[]>
  dims: Dimensions
  setDims: (d: Dimensions) => void
  isAdmin: boolean
  existingDefs: CustomDimensionDef[]
  newDefs: CustomDimensionDef[]
  setNewDefs: (d: CustomDimensionDef[]) => void
  customValues: Record<string, string>
  setCustomValues: (v: Record<string, string>) => void
}) {
  const { catalog } = useApp()
  const allDefs = [...existingDefs, ...newDefs]
  if (!catalog) return null

  return (
    <div>
      <p className="step-hint">
        Dimensions are always set manually — suggestions from the API selection are shown as
        hints, and each account type can carry a different set.
      </p>
      <div className="dim-review">
        {catalog.dimensions.map((d) => {
          const on = dims[d.key]
          const sources = suggestedBy.get(d.key) ?? []
          return (
            <div key={d.key} className={`dim-review-row ${on ? 'on' : ''}`}>
              <div className="dim-review-main">
                <div className="dim-name">
                  {d.label} <span className="yn-mark">{yn(on)}</span>
                </div>
                <p className="dim-desc">{d.description}</p>
                {sources.length > 0 && !on && (
                  <div className="dim-hint">Suggested by {sources.join(', ')} — currently off.</div>
                )}
                {sources.length > 0 && on && (
                  <div className="dim-src">Suggested by {sources.join(', ')}</div>
                )}
              </div>
              <button
                className={`switch ${on ? 'on' : ''}`}
                role="switch"
                aria-checked={on}
                aria-label={d.label}
                onClick={() => setDims({ ...dims, [d.key]: !on })}
              >
                <span className="knob" />
              </button>
            </div>
          )
        })}
      </div>

      {isAdmin && (
        <AdminCustomDims
          existingDefs={existingDefs}
          newDefs={newDefs}
          setNewDefs={setNewDefs}
          customValues={customValues}
          setCustomValues={setCustomValues}
        />
      )}
      {!isAdmin && allDefs.length > 0 && (
        <p className="muted">
          This market carries {allDefs.length} admin-managed custom dimension
          {allDefs.length > 1 ? 's' : ''}. Switch to the Admin profile to set values.
        </p>
      )}
    </div>
  )
}

function AdminCustomDims({
  existingDefs,
  newDefs,
  setNewDefs,
  customValues,
  setCustomValues,
}: {
  existingDefs: CustomDimensionDef[]
  newDefs: CustomDimensionDef[]
  setNewDefs: (d: CustomDimensionDef[]) => void
  customValues: Record<string, string>
  setCustomValues: (v: Record<string, string>) => void
}) {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [type, setType] = useState<CustomDimensionType>('BOOLEAN')
  const [values, setValues] = useState('')
  const [error, setError] = useState<string | null>(null)

  const allDefs = [...existingDefs, ...newDefs]

  function addDef() {
    const k = key.trim()
    if (!k || !label.trim()) {
      setError('Key and label are required.')
      return
    }
    if (allDefs.some((d) => d.key === k)) {
      setError(`'${k}' is already defined.`)
      return
    }
    const allowedValues =
      type === 'ENUM' ? values.split(',').map((v) => v.trim()).filter(Boolean) : []
    if (type === 'ENUM' && allowedValues.length === 0) {
      setError('Enum dimensions need at least one allowed value.')
      return
    }
    setNewDefs([...newDefs, { key: k, label: label.trim(), type, allowedValues }])
    setKey('')
    setLabel('')
    setValues('')
    setError(null)
  }

  return (
    <div className="admin-dims">
      <div className="admin-dims-head">
        <h4>Custom dimensions</h4>
        <span className="admin-badge">Admin</span>
      </div>
      <p className="step-hint">
        Market-specific dimensions hidden from operators. Definitions live at market level;
        values are set per profile.
      </p>

      {allDefs.length > 0 && (
        <div className="custom-dim-list">
          {allDefs.map((def) => (
            <div key={def.key} className="custom-dim-row">
              <div>
                <span className="dim-name">{def.label}</span>{' '}
                <span className="mono-tag">
                  {def.key} · {def.type}
                </span>
                {newDefs.includes(def) && (
                  <button
                    className="link-btn"
                    onClick={() => setNewDefs(newDefs.filter((d) => d !== def))}
                  >
                    remove
                  </button>
                )}
              </div>
              <CustomDimValueInput
                def={def}
                value={customValues[def.key] ?? ''}
                onChange={(v) => setCustomValues({ ...customValues, [def.key]: v })}
              />
            </div>
          ))}
        </div>
      )}

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
        <button className="btn sm ghost" onClick={addDef}>
          Add dimension
        </button>
      </div>
      <ErrorNote message={error} />
    </div>
  )
}

/* ================= Step 4: review ================= */

function StepReview({
  document,
  accountType,
  selectedApis,
  dims,
  customValues,
  allDefs,
}: {
  document: MarketDocument
  accountType: AccountType
  selectedApis: string[]
  dims: Dimensions
  customValues: Record<string, string>
  allDefs: CustomDimensionDef[]
}) {
  const { catalog } = useApp()
  const setCustom = Object.entries(customValues).filter(([, v]) => v !== '')
  if (!catalog) return null
  return (
    <div>
      <div className="review-grid">
        <div className="review-block">
          <h4>Market</h4>
          <p>
            <Flag code={document.code} size={18} /> {document.name || document.code}{' '}
            <span className="mono-tag">{document.code}</span>
          </p>
        </div>
        <div className="review-block">
          <h4>Account type</h4>
          <p>{ACCOUNT_TYPE_LABELS[accountType]}</p>
        </div>
        <div className="review-block">
          <h4>APIs · {selectedApis.length}</h4>
          <div className="review-chips">
            {selectedApis.map((a) => (
              <span key={a} className="chip">
                {a}
              </span>
            ))}
          </div>
        </div>
        <div className="review-block">
          <h4>Dimensions</h4>
          <div className="review-chips">
            {catalog.dimensions.map((d) => (
              <span key={d.key} className={`chip ${dims[d.key] ? 'chip-yes' : 'chip-off'}`}>
                {d.label}: {yn(dims[d.key])}
              </span>
            ))}
          </div>
        </div>
        {setCustom.length > 0 && (
          <div className="review-block">
            <h4>Custom dimensions</h4>
            <div className="review-chips">
              {setCustom.map(([k, v]) => {
                const def = allDefs.find((d) => d.key === k)
                return (
                  <span key={k} className="chip chip-custom">
                    {def?.label ?? k}: {def?.type === 'BOOLEAN' ? yn(v) : v}
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <details className="json-view">
        <summary>Market JSON document</summary>
        <pre>{JSON.stringify(document, null, 2)}</pre>
      </details>
    </div>
  )
}

/* ================= API detail drawer (Esc closes) ================= */

function ApiDrawer({ spec, onClose }: { spec: ApiSpec; onClose: () => void }) {
  const { catalog } = useApp()
  const ref = useRef<HTMLElement>(null)
  useEscape(onClose)
  useEffect(() => {
    ref.current?.focus()
  }, [])
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-label={`${spec.name} details`}
        tabIndex={-1}
        ref={ref}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <div>
            <div className="eyebrow">{CATEGORY_LABELS[spec.category]}</div>
            <h2>{spec.name}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close details">
            ✕
          </button>
        </div>
        <div className="drawer-endpoint mono-tag">
          {spec.method} {spec.path}
        </div>
        <p className="drawer-summary">{spec.summary}</p>
        <p className="drawer-desc">{spec.description}</p>
        <h3>Suggested dimensions</h3>
        {spec.suggests.length === 0 ? (
          <p className="muted">This API suggests no dimension flags.</p>
        ) : (
          spec.suggests.map((k) => {
            const meta = catalog?.dimensions.find((d) => d.key === k)
            return (
              <div key={k} className="drawer-implies">
                <span className="chip chip-yes">{meta?.label ?? k}</span>
                <p>{meta?.description}</p>
              </div>
            )
          })
        )}
        <p className="drawer-esc-hint mono-tag">esc to close</p>
      </aside>
    </div>
  )
}
