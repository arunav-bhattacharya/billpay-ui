import { useMemo, useState } from 'react'
import { api } from '../api'
import { useApp } from '../AppContext'
import { ErrorNote, Eyebrow, Flag, Guilloche } from '../components'
import {
  ACCOUNT_TYPE_LABELS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  navigate,
} from '../lib'
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

const STEPS = ['Market & account', 'Select APIs', 'Dimensions', 'Review & save']

export function Onboarding({ presetMarket }: { presetMarket: string | null }) {
  const { catalog, markets, refreshMarkets, role } = useApp()

  const [step, setStep] = useState(0)
  const [marketCode, setMarketCode] = useState<string | null>(presetMarket)
  const [accountType, setAccountType] = useState<AccountType | null>(null)
  const [selectedApis, setSelectedApis] = useState<string[]>([])
  const [manualOn, setManualOn] = useState<DimensionKey[]>([])
  const [manualOff, setManualOff] = useState<DimensionKey[]>([])
  const [newDefs, setNewDefs] = useState<CustomDimensionDef[]>([])
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [drawerApi, setDrawerApi] = useState<ApiSpec | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const existing = markets.find((m) => m.code === marketCode) ?? null
  const takenTypes = existing?.profiles.map((p) => p.accountType) ?? []
  const curated = catalog?.markets ?? []
  const selectedCurated = curated.find((m) => m.code === marketCode) ?? null

  /** APIs drive dimensions: which selected APIs imply each dimension. */
  const impliedBy = useMemo(() => {
    const map = new Map<DimensionKey, string[]>()
    for (const spec of catalog?.apis ?? []) {
      if (!selectedApis.includes(spec.name)) continue
      for (const dim of spec.implies) {
        map.set(dim, [...(map.get(dim) ?? []), spec.name])
      }
    }
    return map
  }, [catalog, selectedApis])

  const dimensions: Dimensions = useMemo(() => {
    const d = { ...EMPTY_DIMENSIONS }
    for (const k of DIMENSION_KEYS) {
      const implied = impliedBy.has(k)
      d[k] = (implied || manualOn.includes(k)) && !manualOff.includes(k)
    }
    return d
  }, [impliedBy, manualOn, manualOff])

  const conflicts = DIMENSION_KEYS.filter((k) => impliedBy.has(k) && manualOff.includes(k))

  const allDefs = [...(existing?.customDimensionDefs ?? []), ...newDefs]

  const canNext =
    step === 0
      ? marketCode !== null &&
        accountType !== null &&
        !takenTypes.includes(accountType)
      : step === 1
        ? selectedApis.length > 0
        : true

  function toggleApi(name: string) {
    setSelectedApis((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    )
  }

  function overrideDim(k: DimensionKey, want: boolean) {
    const implied = impliedBy.has(k)
    if (want) {
      setManualOff((p) => p.filter((x) => x !== k))
      if (!implied) setManualOn((p) => (p.includes(k) ? p : [...p, k]))
    } else {
      setManualOn((p) => p.filter((x) => x !== k))
      if (implied) setManualOff((p) => (p.includes(k) ? p : [...p, k]))
    }
  }

  function buildDocument(activate: boolean): MarketDocument {
    const profile: MarketProfile = {
      accountType: accountType!,
      status: activate ? 'ACTIVE' : 'DRAFT',
      apis: selectedApis,
      dimensions,
      customDimensions: Object.fromEntries(
        Object.entries(customValues).filter(([k, v]) => v !== '' && allDefs.some((d) => d.key === k)),
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
      navigate(`#/market/${marketCode}`)
    } catch (e) {
      setSaveError((e as Error).message)
      setSaving(false)
    }
  }

  if (!catalog) return <main className="page"><p className="muted">Loading catalog…</p></main>

  return (
    <main className="page wizard">
      <div className="page-head">
        <div>
          <Eyebrow>Onboarding journey</Eyebrow>
          <h1>
            {existing
              ? `New account type for ${existing.name}`
              : 'Onboard a market'}
          </h1>
        </div>
      </div>

      <div className="wizard-body">
        {/* ---- Step rail: a real sequence, so numbers carry meaning ---- */}
        <ol className="step-rail" aria-label="Onboarding steps">
          {STEPS.map((label, i) => (
            <li
              key={label}
              className={i === step ? 'current' : i < step ? 'done' : ''}
              aria-current={i === step ? 'step' : undefined}
            >
              <button
                disabled={i > step && !(i === step + 1 && canNext)}
                onClick={() => setStep(i)}
              >
                <span className="step-num">{i < step ? '✓' : i + 1}</span>
                <span className="step-label">{label}</span>
              </button>
            </li>
          ))}
        </ol>

        <div className="wizard-panel">
          {step === 0 && (
            <StepMarket
              curated={curated}
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

          {step === 1 && (
            <StepApis
              catalog={catalog}
              selectedApis={selectedApis}
              impliedBy={impliedBy}
              dimensions={dimensions}
              onToggle={toggleApi}
              onDetails={setDrawerApi}
            />
          )}

          {step === 2 && (
            <StepDimensions
              catalog={catalog}
              impliedBy={impliedBy}
              dimensions={dimensions}
              conflicts={conflicts}
              overrideDim={overrideDim}
              isAdmin={role === 'ADMIN'}
              existingDefs={existing?.customDimensionDefs ?? []}
              newDefs={newDefs}
              setNewDefs={setNewDefs}
              customValues={customValues}
              setCustomValues={setCustomValues}
            />
          )}

          {step === 3 && (
            <StepReview
              document={buildDocument(false)}
              catalog={catalog}
              accountType={accountType!}
              selectedApis={selectedApis}
              dimensions={dimensions}
              customValues={customValues}
              allDefs={allDefs}
            />
          )}

          <ErrorNote message={saveError} />

          <div className="wizard-actions">
            {step > 0 && (
              <button className="btn ghost" onClick={() => setStep(step - 1)} disabled={saving}>
                Back
              </button>
            )}
            <span className="spacer" />
            {step < 3 ? (
              <button className="btn primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
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
      </div>

      {drawerApi && <ApiDrawer spec={drawerApi} catalog={catalog} onClose={() => setDrawerApi(null)} />}
    </main>
  )
}

/* ================= Step 1: market & account type ================= */

function StepMarket({
  curated,
  markets,
  marketCode,
  presetLocked,
  accountType,
  takenTypes,
  onMarket,
  onAccountType,
}: {
  curated: { code: string; name: string; currency: string; region: string }[]
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
  const shown = curated.filter(
    (m) =>
      m.name.toLowerCase().includes(query.toLowerCase()) ||
      m.code.toLowerCase().includes(query.toLowerCase()),
  )

  return (
    <section>
      <h2 className="step-title">Choose the market</h2>
      {!presetLocked && (
        <input
          className="search"
          placeholder="Search markets…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search markets"
        />
      )}
      <div className="market-pick-grid">
        {shown.map((m) => {
          const doc = onboarded.get(m.code)
          const full = doc && doc.profiles.length >= 3
          const disabled = (presetLocked && m.code !== marketCode) || !!full
          return (
            <button
              key={m.code}
              className={`pick-cell ${marketCode === m.code ? 'sel' : ''}`}
              disabled={disabled}
              onClick={() => onMarket(m.code)}
            >
              <Flag code={m.code} size={22} />
              <span className="pick-name">{m.name}</span>
              <span className="mono-tag">
                {m.code} · {m.currency}
              </span>
              {doc && (
                <span className={`pick-note ${full ? 'full' : ''}`}>
                  {full ? 'All account types onboarded' : 'Onboarded — add account type'}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {marketCode && (
        <>
          <h2 className="step-title">Account type</h2>
          <div className="account-grid">
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
                  {taken && <span className="pick-note full">Already onboarded in {marketCode}</span>}
                </button>
              )
            })}
          </div>
        </>
      )}
    </section>
  )
}

/* ================= Step 2: APIs ================= */

function StepApis({
  catalog,
  selectedApis,
  impliedBy,
  dimensions,
  onToggle,
  onDetails,
}: {
  catalog: { apis: ApiSpec[]; dimensions: { key: DimensionKey; label: string; description: string }[] }
  selectedApis: string[]
  impliedBy: Map<DimensionKey, string[]>
  dimensions: Dimensions
  onToggle: (name: string) => void
  onDetails: (spec: ApiSpec) => void
}) {
  return (
    <section className="apis-layout">
      <div className="apis-list">
        <h2 className="step-title">Select the APIs this profile will use</h2>
        <p className="step-hint">
          Hover an API for a summary; open <em>Details</em> for the full contract. Selections
          switch on the dimensions they imply — watch the panel.
        </p>
        {CATEGORY_ORDER.map((cat) => (
          <div key={cat} className="api-category">
            <h3 className="api-cat-head">
              {CATEGORY_LABELS[cat]}
              <span className="api-cat-count">
                {catalog.apis.filter((a) => a.category === cat && selectedApis.includes(a.name)).length}
                {' / '}
                {catalog.apis.filter((a) => a.category === cat).length}
              </span>
            </h3>
            <div className="api-cards">
              {catalog.apis
                .filter((a) => a.category === cat)
                .map((spec) => {
                  const sel = selectedApis.includes(spec.name)
                  return (
                    <div key={spec.name} className={`api-card ${sel ? 'sel' : ''}`}>
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
                        {spec.implies.length > 0 && (
                          <p className="api-pop-implies">
                            Implies{' '}
                            {spec.implies
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

      <aside className="dim-panel" aria-label="Dimension inference">
        <h3>Dimensions</h3>
        <p className="dim-panel-hint">Derived from your API selection.</p>
        {catalog.dimensions.map((d) => {
          const on = dimensions[d.key]
          const sources = impliedBy.get(d.key) ?? []
          return (
            <div key={d.key} className={`dim-row ${on ? 'on' : ''}`}>
              <span className="dim-lamp" aria-hidden="true" />
              <div>
                <div className="dim-name">{d.label}</div>
                {sources.length > 0 ? (
                  <div className="dim-src">via {sources.join(', ')}</div>
                ) : (
                  <div className="dim-src">not required</div>
                )}
              </div>
            </div>
          )
        })}
      </aside>
    </section>
  )
}

/* ================= Step 3: dimensions & custom dims ================= */

function StepDimensions({
  catalog,
  impliedBy,
  dimensions,
  conflicts,
  overrideDim,
  isAdmin,
  existingDefs,
  newDefs,
  setNewDefs,
  customValues,
  setCustomValues,
}: {
  catalog: { dimensions: { key: DimensionKey; label: string; description: string }[] }
  impliedBy: Map<DimensionKey, string[]>
  dimensions: Dimensions
  conflicts: DimensionKey[]
  overrideDim: (k: DimensionKey, want: boolean) => void
  isAdmin: boolean
  existingDefs: CustomDimensionDef[]
  newDefs: CustomDimensionDef[]
  setNewDefs: (d: CustomDimensionDef[]) => void
  customValues: Record<string, string>
  setCustomValues: (v: Record<string, string>) => void
}) {
  const allDefs = [...existingDefs, ...newDefs]

  return (
    <section>
      <h2 className="step-title">Confirm processing dimensions</h2>
      <p className="step-hint">
        Flags implied by the API selection are on by default. Overrides are allowed but flagged.
      </p>
      <div className="dim-review">
        {catalog.dimensions.map((d) => {
          const on = dimensions[d.key]
          const sources = impliedBy.get(d.key) ?? []
          const conflict = conflicts.includes(d.key)
          return (
            <div key={d.key} className={`dim-review-row ${on ? 'on' : ''}`}>
              <div className="dim-review-main">
                <div className="dim-name">{d.label}</div>
                <p className="dim-desc">{d.description}</p>
                <div className="dim-src">
                  {sources.length > 0
                    ? `Implied by ${sources.join(', ')}`
                    : on
                      ? 'Manually enabled'
                      : 'Not required by any selected API'}
                </div>
                {conflict && (
                  <div className="dim-conflict" role="alert">
                    Overridden off, but {sources.join(', ')} normally requires it. The selection
                    will be saved with the flag off.
                  </div>
                )}
              </div>
              <button
                className={`switch ${on ? 'on' : ''}`}
                role="switch"
                aria-checked={on}
                aria-label={d.label}
                onClick={() => overrideDim(d.key, !on)}
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
    </section>
  )
}

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
        <option value="true">true</option>
        <option value="false">false</option>
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
      type === 'ENUM'
        ? values.split(',').map((v) => v.trim()).filter(Boolean)
        : []
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
        <h3>Custom dimensions</h3>
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
                <span className="mono-tag">{def.key} · {def.type}</span>
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
  catalog,
  accountType,
  selectedApis,
  dimensions,
  customValues,
  allDefs,
}: {
  document: MarketDocument
  catalog: { apis: ApiSpec[]; dimensions: { key: DimensionKey; label: string }[] }
  accountType: AccountType
  selectedApis: string[]
  dimensions: Dimensions
  customValues: Record<string, string>
  allDefs: CustomDimensionDef[]
}) {
  const setCustom = Object.entries(customValues).filter(([, v]) => v !== '')
  return (
    <section>
      <h2 className="step-title">Review the profile</h2>
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
              <span key={a} className="chip">{a}</span>
            ))}
          </div>
        </div>
        <div className="review-block">
          <h4>Dimensions</h4>
          <div className="review-chips">
            {catalog.dimensions.map((d) => (
              <span key={d.key} className={`chip ${dimensions[d.key] ? 'chip-active' : 'chip-off'}`}>
                {d.label}: {dimensions[d.key] ? 'yes' : 'no'}
              </span>
            ))}
          </div>
        </div>
        {setCustom.length > 0 && (
          <div className="review-block">
            <h4>Custom dimensions</h4>
            <div className="review-chips">
              {setCustom.map(([k, v]) => (
                <span key={k} className="chip">
                  {allDefs.find((d) => d.key === k)?.label ?? k}: {v}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <details className="json-view">
        <summary>Market JSON document</summary>
        <pre>{JSON.stringify(document, null, 2)}</pre>
      </details>
    </section>
  )
}

/* ================= API detail drawer ================= */

function ApiDrawer({
  spec,
  catalog,
  onClose,
}: {
  spec: ApiSpec
  catalog: { dimensions: { key: DimensionKey; label: string; description: string }[] }
  onClose: () => void
}) {
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-label={`${spec.name} details`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="drawer-head">
          <div>
            <Eyebrow>{CATEGORY_LABELS[spec.category]}</Eyebrow>
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
        <h3>Dimension implications</h3>
        {spec.implies.length === 0 ? (
          <p className="muted">Selecting this API implies no dimension flags.</p>
        ) : (
          spec.implies.map((k) => {
            const meta = catalog.dimensions.find((d) => d.key === k)
            return (
              <div key={k} className="drawer-implies">
                <span className="chip chip-active">{meta?.label ?? k}</span>
                <p>{meta?.description}</p>
              </div>
            )
          })
        )}
        <Guilloche className="drawer-guilloche" />
      </aside>
    </div>
  )
}
