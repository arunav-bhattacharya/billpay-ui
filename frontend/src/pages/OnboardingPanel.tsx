import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useApp } from '../AppContext'
import { CustomDimValueInput, ErrorNote, Flag, JsonView } from '../components'
import { ACCOUNT_TYPE_LABELS, CATEGORY_LABELS, CATEGORY_ORDER, yn } from '../lib'
import { DIMENSION_KEYS, EMPTY_DIMENSIONS } from '../types'
import type {
  AccountType,
  CustomDimensionDef,
  CustomDimensionType,
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
  const [accountTypes, setAccountTypes] = useState<AccountType[]>([])
  const [selectedApis, setSelectedApis] = useState<string[]>([])
  const [dims, setDims] = useState<Dimensions>({ ...EMPTY_DIMENSIONS })
  const [newDefs, setNewDefs] = useState<CustomDimensionDef[]>([])
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const existing = markets.find((m) => m.market.code === marketCode) ?? null
  const takenTypes = existing?.profiles.map((p) => p.accountType) ?? []
  const selectedCurated = (catalog?.markets ?? []).find((m) => m.code === marketCode) ?? null

  const allDefs = [...(existing?.customDimensionDefs ?? []), ...newDefs]

  const stepValid = [
    marketCode !== null &&
      accountTypes.length > 0 &&
      accountTypes.every((t) => !takenTypes.includes(t)),
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
        return marketCode && accountTypes.length > 0
          ? `${selectedCurated?.name ?? marketCode} · ${accountTypes
              .map((t) => ACCOUNT_TYPE_LABELS[t])
              .join(', ')}`
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
    // One profile per selected account type — all carry the same configuration.
    const customDimensions = Object.fromEntries(
      Object.entries(customValues).filter(
        ([k, v]) => v !== '' && allDefs.some((d) => d.key === k),
      ),
    )
    const profiles: MarketProfile[] = accountTypes.map((t) => ({
      accountType: t,
      status: activate ? 'ACTIVE' : 'DRAFT',
      apis: selectedApis,
      dimensions: dims,
      customDimensions,
    }))
    if (existing) {
      return {
        ...existing,
        customDimensionDefs: allDefs,
        profiles: [...existing.profiles, ...profiles],
      }
    }
    return {
      market: {
        code: marketCode!,
        name: selectedCurated?.name ?? '',
        currency: selectedCurated?.currency ?? '',
        region: selectedCurated?.region ?? '',
      },
      status: 'DRAFT',
      customDimensionDefs: allDefs,
      profiles,
    }
  }

  async function save(activate: boolean) {
    setSaving(true)
    setSaveError(null)
    try {
      const doc = buildDocument(activate)
      if (existing) await api.updateMarket(existing.market.code, doc)
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
          <h2>
            {existing ? `New account type for ${existing.market.name}` : 'Onboard a market'}
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
                      accountTypes={accountTypes}
                      takenTypes={takenTypes}
                      onMarket={(c) => {
                        setMarketCode(c)
                        setAccountTypes([])
                      }}
                      onToggleType={(t) =>
                        setAccountTypes((prev) =>
                          prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
                        )
                      }
                    />
                  )}
                  {i === 1 && (
                    <StepApis
                      selectedApis={selectedApis}
                      onToggle={(name) =>
                        setSelectedApis((prev) =>
                          prev.includes(name)
                            ? prev.filter((n) => n !== name)
                            : [...prev, name],
                        )
                      }
                    />
                  )}
                  {i === 2 && (
                    <StepDimensions
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
                      accountTypes={accountTypes}
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
                        <button
                          className="btn ghost draft"
                          disabled={saving}
                          onClick={() => save(false)}
                        >
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
    </section>
  )
}

/* ================= Step 1: market & account type (side by side) ================= */

function StepMarket({
  markets,
  marketCode,
  presetLocked,
  accountTypes,
  takenTypes,
  onMarket,
  onToggleType,
}: {
  markets: MarketDocument[]
  marketCode: string | null
  presetLocked: boolean
  accountTypes: AccountType[]
  takenTypes: AccountType[]
  onMarket: (c: string) => void
  onToggleType: (t: AccountType) => void
}) {
  const { catalog } = useApp()
  const [query, setQuery] = useState('')
  const onboarded = new Map(markets.map((m) => [m.market.code, m]))
  const curatedByCode = new Map((catalog?.markets ?? []).map((m) => [m.code, m]))
  const shown = (catalog?.markets ?? []).filter(
    (m) =>
      m.name.toLowerCase().includes(query.toLowerCase()) ||
      m.code.toLowerCase().includes(query.toLowerCase()),
  )

  const selectedCurated = marketCode ? curatedByCode.get(marketCode) : undefined
  const allowedTypes = selectedCurated?.allowedAccountTypes ?? null
  const restricted = !!allowedTypes && allowedTypes.length < 3
  const shownAccountTypes = (catalog?.accountTypes ?? []).filter(
    (t) => !allowedTypes || allowedTypes.includes(t.key),
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
            const full = doc && doc.profiles.length >= m.allowedAccountTypes.length
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
        <h3 className="split-title">Account types — select one or more</h3>
        {!marketCode ? (
          <p className="muted">Choose a market first.</p>
        ) : (
          <>
            {restricted && (
              <p className="restricted-note">
                {selectedCurated?.name} supports only{' '}
                {allowedTypes!.map((k) => ACCOUNT_TYPE_LABELS[k]).join(' & ')}.
              </p>
            )}
            <div className="account-stack">
              {shownAccountTypes.map((t) => {
              const taken = takenTypes.includes(t.key)
              return (
                <button
                  key={t.key}
                  className={`account-cell ${accountTypes.includes(t.key) ? 'sel' : ''}`}
                  aria-pressed={accountTypes.includes(t.key)}
                  disabled={taken}
                  onClick={() => onToggleType(t.key)}
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
          </>
        )}
      </div>
    </div>
  )
}

/* ================= Step 2: APIs ================= */

function StepApis({
  selectedApis,
  onToggle,
}: {
  selectedApis: string[]
  onToggle: (name: string) => void
}) {
  const { catalog } = useApp()
  const [openApi, setOpenApi] = useState<string | null>(null)
  if (!catalog) return null
  return (
    <div className="apis-layout">
      <div className="apis-list">
        <p className="step-hint">
          Expand <em>Details</em> for the full contract, the Billpay-Core endpoint, and a link to
          the spec. Select every API this market's profiles will call.
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
                  const open = openApi === spec.name
                  return (
                    <div
                      key={spec.name}
                      className={`api-card cat-${cat.toLowerCase()} ${sel ? 'sel' : ''} ${open ? 'open' : ''}`}
                    >
                      <div className="api-row">
                        <button
                          className="api-main"
                          aria-pressed={sel}
                          onClick={() => onToggle(spec.name)}
                        >
                          <span className="api-check" aria-hidden="true">
                            {sel ? '✓' : ''}
                          </span>
                          <span className="api-name">{spec.name}</span>
                          <span className="api-summary">{spec.summary}</span>
                        </button>
                        <button
                          className="api-expand"
                          aria-expanded={open}
                          aria-label={`${spec.name} details`}
                          onClick={() => setOpenApi(open ? null : spec.name)}
                        >
                          <span className={`chevron ${open ? 'up' : ''}`} aria-hidden="true">
                            ▾
                          </span>
                        </button>
                      </div>

                      {open && (
                        <div className="api-detail-body">
                          <p className="api-detail-desc">{spec.description}</p>
                          <div className="api-detail-meta">
                            <span className="api-endpoint-label">Billpay-Core endpoint</span>
                            <span className="mono-tag">
                              <b>{spec.method}</b> {spec.path}
                            </span>
                          </div>
                          <a
                            className="api-spec-link"
                            href={spec.specUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            View API spec ↗
                          </a>
                        </div>
                      )}
                    </div>
                  )
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ================= Step 3: dimensions (always manual) ================= */

function StepDimensions({
  dims,
  setDims,
  isAdmin,
  existingDefs,
  newDefs,
  setNewDefs,
  customValues,
  setCustomValues,
}: {
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
        Dimensions are always set manually, and each account type can carry a different set.
      </p>
      <div className="dim-review">
        {catalog.dimensions.map((d) => {
          const on = dims[d.key]
          return (
            <div key={d.key} className={`dim-review-row ${on ? 'on' : ''}`}>
              <div className="dim-review-main">
                <div className="dim-name">
                  {d.label} <span className="yn-mark">{yn(on)}</span>
                </div>
                <p className="dim-desc">{d.description}</p>
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
  accountTypes,
  selectedApis,
  dims,
  customValues,
  allDefs,
}: {
  document: MarketDocument
  accountTypes: AccountType[]
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
        <div className="review-row">
          <div className="review-block">
            <h4>Market</h4>
            <p>
              <Flag code={document.market.code} size={18} /> {document.market.name || document.market.code}{' '}
              <span className="mono-tag">{document.market.code}</span>
            </p>
          </div>
          <div className="review-block">
            <h4>{accountTypes.length > 1 ? 'Account types' : 'Account type'}</h4>
            <p>{accountTypes.map((t) => ACCOUNT_TYPE_LABELS[t]).join(', ')}</p>
          </div>
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

      <JsonView
        data={document}
        filename={`${document.market.code.toLowerCase()}-market.json`}
      />
    </div>
  )
}
