import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import { useApp } from '../appState'
import { BehaviorRow, CustomBehaviorDefForm, CustomBehaviorRow } from '../behavior'
import { ApiDetailBody, ApiIdentity, ErrorNote, JsonView } from '../components'
import { CheckMark, CloseIcon, Flag, SelectionBox, TickIcon } from '../icons'
import type { SelectionState } from '../icons'
import {
  ACCOUNT_TYPE_LABELS,
  BEHAVIOR_VALUE_LABELS,
  behaviorFor,
  buildLabel,
  byAccountType,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  missingCombinations,
  operationsSummary,
  yn,
} from '../lib'
import { OperationsEditor } from '../operations'
import { BEHAVIOR_KEYS, DEFAULT_BEHAVIOR, DEFAULT_OPERATIONS } from '../types'
import type {
  AccountType,
  ApiSpec,
  Behavior,
  CustomBehaviorDef,
  MarketDocument,
  MarketProfile,
  OperationsSettings,
} from '../types'

const STEPS = ['Market & account type', 'APIs', 'Behavior', 'Operations', 'Review & save']
const REVIEW = STEPS.length - 1

/**
 * The set every market so far has taken: full payment CRUD plus the event
 * handlers that are already contracted. Open-To-Buy is left out — its AMP
 * contract is not final.
 *
 * Offered as a starting point on a market's first onboarding only; adding an
 * account type to a live market starts from nothing, because that market has
 * already made its choices and copying them silently would hide the decision.
 */
const DEFAULT_APIS = [
  'CreatePayment.v3',
  'UpdatePayment.v1',
  'DeletePayment.v1',
  'ReadPayments.v1',
  'ReadPaymentEventsById.v1',
  'CreateMoneyMovementEventHandler.v1',
  'CreateAccountsReceivableTransactionEventHandler.v1',
]

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
  // Once the operator has touched the list it is theirs; stop re-seeding it.
  const [apisTouched, setApisTouched] = useState(false)
  const [behavior, setBehaviorState] = useState<Behavior>({ ...DEFAULT_BEHAVIOR })
  const [operations, setOperations] = useState<OperationsSettings>({ ...DEFAULT_OPERATIONS })
  const [newDefs, setNewDefs] = useState<CustomBehaviorDef[]>([])
  const [customValues, setCustomValues] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const existing = markets.find((m) => m.market.code === marketCode) ?? null
  const takenTypes = existing?.profiles.map((p) => p.accountType) ?? []
  const selectedCurated = (catalog?.markets ?? []).find((m) => m.code === marketCode) ?? null

  const allDefs = [...(existing?.customDimensionDefs ?? []), ...newDefs]

  // The market can change while the wizard is open, and whether it is already
  // onboarded is what decides if the defaults apply.
  const isNewMarket = marketCode !== null && existing === null
  useEffect(() => {
    if (apisTouched) return
    setSelectedApis(isNewMarket ? DEFAULT_APIS : [])
  }, [isNewMarket, apisTouched])

  const stepValid = [
    marketCode !== null &&
      accountTypes.length > 0 &&
      accountTypes.every((t) => !takenTypes.includes(t)),
    selectedApis.length > 0,
    true,
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
        const on = BEHAVIOR_KEYS.filter((k) => behavior[k] !== 'N')
        const parts = [
          on.length === 0 ? 'no behavior flags' : `${on.length} flag${on.length > 1 ? 's' : ''} on`,
        ]
        const set = Object.values(customValues).filter((v) => v !== '').length
        if (set > 0) parts.push(`${set} custom`)
        return parts.join(' · ')
      }
      case 3:
        return [operations.timeZone, operations.executionTime].filter(Boolean).join(' · ')
      default:
        return ''
    }
  }

  function buildDocument(): MarketDocument {
    // One profile per selected account type — all carry the same configuration.
    const customDimensions = Object.fromEntries(
      Object.entries(customValues).filter(
        ([k, v]) => v !== '' && allDefs.some((d) => d.key === k),
      ),
    )
    // A behavior an account type can't take is N on its profile, such as Corporate's bank confirmation.
    const profiles: MarketProfile[] = accountTypes.map((t) => ({
      accountType: t,
      // Every profile starts in e1, where its first release goes.
      status: 'E1',
      apis: selectedApis,
      dimensions: behaviorFor(behavior, t, catalog?.behaviors ?? []),
      customDimensions,
      operations,
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
      status: 'E1',
      customDimensionDefs: allDefs,
      profiles,
    }
  }

  async function save() {
    setSaving(true)
    setSaveError(null)
    try {
      const doc = buildDocument()
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
          {/* One title for both routes in — adding an account type to a live
              market is still onboarding, and step 1 already names the market. */}
          <h2>Onboard a Market</h2>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close onboarding">
          <CloseIcon />
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
                <span className="acc-num">
                  {done && !open ? <CheckMark /> : i + 1}
                </span>
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
                        // Sorted on the way in, so the review step and the
                        // profiles it creates follow the standard order rather
                        // than the order they happened to be clicked.
                        setAccountTypes((prev) =>
                          (prev.includes(t)
                            ? prev.filter((x) => x !== t)
                            : [...prev, t]
                          ).sort(byAccountType),
                        )
                      }
                    />
                  )}
                  {i === 1 && (
                    <StepApis
                      selectedApis={selectedApis}
                      prefilled={isNewMarket && !apisTouched}
                      onToggle={(name) => {
                        setApisTouched(true)
                        setSelectedApis((prev) =>
                          prev.includes(name)
                            ? prev.filter((n) => n !== name)
                            : [...prev, name],
                        )
                      }}
                      onSelectAll={() => {
                        setApisTouched(true)
                        setSelectedApis((catalog?.apis ?? []).map((a) => a.name))
                      }}
                      onClearAll={() => {
                        setApisTouched(true)
                        setSelectedApis([])
                      }}
                    />
                  )}
                  {i === 2 && (
                    <StepBehavior
                      accountTypes={accountTypes}
                      operations={operations}
                      setOperations={setOperations}
                      behavior={behavior}
                      setBehaviorState={setBehaviorState}
                      isAdmin={role === 'ADMIN'}
                      existingDefs={existing?.customDimensionDefs ?? []}
                      newDefs={newDefs}
                      setNewDefs={setNewDefs}
                      customValues={customValues}
                      setCustomValues={setCustomValues}
                    />
                  )}
                  {i === 3 && (
                    <OperationsEditor
                      value={operations}
                      onChange={setOperations}
                      accountTypes={accountTypes}
                      behavior={behavior}
                      currency={selectedCurated?.currency ?? existing?.market.currency ?? ''}
                    />
                  )}
                  {i === REVIEW && (
                    <StepReview
                      document={buildDocument()}
                      accountTypes={accountTypes}
                      selectedApis={selectedApis}
                      behavior={behavior}
                      operations={operations}
                      customValues={customValues}
                      allDefs={allDefs}
                    />
                  )}

                  <ErrorNote message={i === REVIEW ? saveError : null} />

                  <div className="acc-actions">
                    {i > 0 && (
                      <button className="btn ghost" onClick={() => setStep(i - 1)} disabled={saving}>
                        Back
                      </button>
                    )}
                    <span className="spacer" />
                    {i < REVIEW ? (
                      <button className="btn primary" disabled={!stepValid[i]} onClick={advance}>
                        Continue
                      </button>
                    ) : (
                      <button className="btn primary" disabled={saving} onClick={() => save()}>
                        {saving ? 'Saving…' : 'Save the profile'}
                      </button>
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
                  <span
                    className={`pick-note ${full ? 'full' : ''}`}
                    title={full ? 'Every account type onboarded' : 'Already onboarded'}
                  >
                    <TickIcon />
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
                    <span className="pick-note full" title={`Already onboarded in ${marketCode}`}>
                      <TickIcon />
                    </span>
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
  prefilled,
  onToggle,
  onSelectAll,
  onClearAll,
}: {
  selectedApis: string[]
  prefilled: boolean
  onToggle: (name: string) => void
  onSelectAll: () => void
  onClearAll: () => void
}) {
  const { catalog } = useApp()
  const [openApi, setOpenApi] = useState<string | null>(null)
  if (!catalog) return null

  const total = catalog.apis.length
  const chosen = selectedApis.length
  // Clicking a partial selection completes it; only a full one clears.
  const selection: SelectionState = chosen === 0 ? 'none' : chosen === total ? 'all' : 'partial'

  return (
    <div className="apis-list">
      <p className="step-hint">Select all the APIs to be onboarded for this market</p>
      {prefilled && (
        <p className="step-hint prefill-hint">
          Started with the {DEFAULT_APIS.length} APIs every market so far has taken — change
          anything that does not apply.
        </p>
      )}

      {/* One box for the whole list. The count is its label, so there is
          nothing to read twice. */}
      <div className="api-bulk">
        <button
          className="api-bulk-toggle"
          role="checkbox"
          aria-checked={selection === 'all' ? true : selection === 'none' ? false : 'mixed'}
          aria-label={selection === 'all' ? 'Clear every API' : 'Select every API'}
          onClick={selection === 'all' ? onClearAll : onSelectAll}
        >
          <SelectionBox state={selection} />
          <span className="api-bulk-count">
            <strong>{chosen}</strong> of {total} selected
          </span>
        </button>
      </div>
      {CATEGORY_ORDER.map((cat) => (
        <div key={cat} className="api-category">
          <h4 className={`api-cat-head cat-${cat.toLowerCase()}`}>
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
                          {sel && <CheckMark />}
                        </span>
                        <ApiIdentity spec={spec} />
                        <span className="api-summary">{spec.summary}</span>
                      </button>
                      <button
                        className="api-expand"
                        aria-expanded={open}
                        aria-label={`${spec.name} details`}
                        onClick={() => setOpenApi(open ? null : spec.name)}
                      >
                        <span className={`chevron ${open ? 'up' : ''}`} aria-hidden="true" />
                      </button>
                    </div>

                    {open && <ApiDetailBody spec={spec} />}
                  </div>
                )
              })}
          </div>
        </div>
      ))}
    </div>
  )
}

/* ================= Step 3: behavior (always manual) ================= */

function StepBehavior({
  accountTypes,
  operations,
  setOperations,
  behavior,
  setBehaviorState,
  isAdmin,
  existingDefs,
  newDefs,
  setNewDefs,
  customValues,
  setCustomValues,
}: {
  accountTypes: AccountType[]
  operations: OperationsSettings
  setOperations: (o: OperationsSettings) => void
  behavior: Behavior
  setBehaviorState: (d: Behavior) => void
  isAdmin: boolean
  existingDefs: CustomBehaviorDef[]
  newDefs: CustomBehaviorDef[]
  setNewDefs: (d: CustomBehaviorDef[]) => void
  customValues: Record<string, string>
  setCustomValues: (v: Record<string, string>) => void
}) {
  const { catalog, capabilities, capabilitiesError } = useApp()
  const allDefs = [...existingDefs, ...newDefs]
  if (!catalog) return null

  return (
    <div>
      <p className="step-hint">
        Behavior is always set manually, and each account type can carry a different set.
      </p>

      <ManifestCheck
        accountTypes={accountTypes}
        behavior={behavior}
        error={capabilitiesError}
        capabilities={capabilities}
      />

      {/* Same bounded groups the market page uses, so a behavior looks the
          same whether you are onboarding it or editing it later. */}
      <div className="pe-bhv-group">
        <span className="pe-cat">Core</span>
        {catalog.behaviors.map((d) => (
          <BehaviorRow
            key={d.key}
            meta={d}
            behavior={behavior}
            accountTypes={accountTypes}
            journeys={operations.bothRules?.[d.key] ?? []}
            onChange={setBehaviorState}
            onJourneys={(journeys) => setOperations({ ...operations, bothRules: { ...operations.bothRules, [d.key]: journeys } })}
          />
        ))}
      </div>

      {isAdmin ? (
        <AdminCustomBehavior
          existingDefs={existingDefs}
          newDefs={newDefs}
          setNewDefs={setNewDefs}
          customValues={customValues}
          setCustomValues={setCustomValues}
        />
      ) : (
        allDefs.length > 0 && (
          <div className="pe-bhv-group">
            <span className="pe-cat">Custom</span>
            <p className="muted">
              This market carries {allDefs.length} admin-managed custom behavior
              {allDefs.length > 1 ? 's' : ''}. Switch to Admin to set values.
            </p>
          </div>
        )
      )}
    </div>
  )
}

/**
 * Authoring checks each combination against e1's capability manifest, so a combination the build lacks is flagged
 * while it is authored rather than at the release's step 1. A pre-check only: step 1 is the full check.
 */
function ManifestCheck({
  accountTypes,
  behavior,
  capabilities,
  error,
}: {
  accountTypes: AccountType[]
  behavior: Behavior
  capabilities: ReturnType<typeof useApp>['capabilities']
  error: string | null
}) {
  const { catalog } = useApp()
  if (!capabilities) {
    return error ? <p className="manifest-check unknown">Couldn't read e1's capability manifest: {error}</p> : null
  }
  const missing = accountTypes.flatMap((t) =>
    missingCombinations(t, behaviorFor(behavior, t, catalog?.behaviors ?? []), capabilities).map((c) => ({ t, c })),
  )
  if (missing.length === 0) {
    return (
      <p className="manifest-check ok">
        <TickIcon /> {buildLabel(capabilities)} runs every combination these settings need.
      </p>
    )
  }
  return (
    <div className="manifest-check gap">
      <p>
        {buildLabel(capabilities)} lacks {missing.length} combination{missing.length > 1 ? 's' : ''}: a
        release with these settings would stop at its check, needing a build.
      </p>
      <ul>
        {missing.map(({ t, c }, i) => (
          <li key={i} className="mono-tag">
            {ACCOUNT_TYPE_LABELS[t]} · GC {c.requiresArPosting} · RT {c.requiresRealtimeClearing} · MA{' '}
            {c.requiresMandateAuthorization} · BC {c.requiresBankConfirmation}
          </li>
        ))}
      </ul>
    </div>
  )
}

function AdminCustomBehavior({
  existingDefs,
  newDefs,
  setNewDefs,
  customValues,
  setCustomValues,
}: {
  existingDefs: CustomBehaviorDef[]
  newDefs: CustomBehaviorDef[]
  setNewDefs: (d: CustomBehaviorDef[]) => void
  customValues: Record<string, string>
  setCustomValues: (v: Record<string, string>) => void
}) {
  const allDefs = [...existingDefs, ...newDefs]

  return (
    <>
      <div className="pe-bhv-group">
        <span className="pe-cat">Custom</span>

        {allDefs.map((def) => {
          // Only what is being defined here can still be written; anything the
          // market already carries was agreed before this wizard opened.
          const draft = newDefs.includes(def)
          return (
            <CustomBehaviorRow
              key={def.key}
              def={def}
              value={customValues[def.key] ?? ''}
              onValue={(v) => setCustomValues({ ...customValues, [def.key]: v })}
              onDescription={
                draft
                  ? (description) =>
                      setNewDefs(newDefs.map((d) => (d === def ? { ...d, description } : d)))
                  : undefined
              }
              onRemove={draft ? () => setNewDefs(newDefs.filter((d) => d !== def)) : undefined}
            />
          )
        })}

        <CustomBehaviorDefForm
          existingKeys={allDefs.map((d) => d.key)}
          onAdd={(def) => setNewDefs([...newDefs, def])}
        />
      </div>

      {/* Outside the card: this is about what happens to the market after it is
          saved, not about any one behavior in the list. */}
      <p className="bhv-scope-note">
        Market-specific behaviors are only available to Admins and it may need additional
        build. A profile will be onboarded after the development team reviews it.
      </p>
    </>
  )
}

/* ================= Step 4: review ================= */

function StepReview({
  document,
  accountTypes,
  selectedApis,
  behavior,
  operations,
  customValues,
  allDefs,
}: {
  document: MarketDocument
  accountTypes: AccountType[]
  selectedApis: string[]
  behavior: Behavior
  operations: OperationsSettings
  customValues: Record<string, string>
  allDefs: CustomBehaviorDef[]
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
            {selectedApis.map((name) => {
              const spec: ApiSpec | undefined = catalog.apis.find((a) => a.name === name)
              return (
                <span key={name} className="chip chip-api" title={name}>
                  {spec?.title ?? name}
                </span>
              )
            })}
          </div>
        </div>
        <div className="review-block">
          <h4>Behavior</h4>
          <div className="review-chips">
            {catalog.behaviors.map((d) => (
              <span key={d.key} className="chip chip-bhv">
                {d.label}: {BEHAVIOR_VALUE_LABELS[behavior[d.key]]}
              </span>
            ))}
          </div>
        </div>
        <div className="review-block">
          <h4>Operations</h4>
          <dl className="ops-summary">
            {operationsSummary(operations, accountTypes.length === 1 ? accountTypes[0] : undefined).map(([k, v]) => (
              <div key={k} className="ops-summary-row">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        {setCustom.length > 0 && (
          <div className="review-block">
            <h4>Custom behaviors</h4>
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

      <p className="step-hint">
        Saving creates the draft in e1. From the market page, release it: that freezes it as v1 and sends it to
        e1's Market Onboarding API.
      </p>

      {/* Onboarding only ever writes e1; the file is named for it so a saved
          copy is not mistaken for the market's whole record. */}
      <JsonView
        data={document}
        filename={`${document.market.code.toLowerCase()}-e1.json`}
      />
    </div>
  )
}
