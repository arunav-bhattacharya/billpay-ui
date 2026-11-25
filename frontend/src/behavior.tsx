import { useApp } from './appState'
import { ACCOUNT_TYPE_LABELS, BEHAVIOR_VALUE_LABELS, behaviorAppliesTo, setBehavior } from './lib'
import type { AccountType, Behavior, BehaviorMeta, BehaviorValue } from './types'

/**
 * Behavior editing, shared by the onboarding wizard and the market page: the four behaviors billpay-core's Router
 * reads, each with its account-type rule and, set to BOTH, its journeys. `compact` is the market page's inline editor;
 * the default is the wizard's roomier step.
 */

const VALUES: BehaviorValue[] = ['Y', 'N', 'BOTH']

/* ---------- Behavior value control ---------- */

export function TriToggle({
  value,
  options = VALUES,
  locked,
  small,
  label,
  onChange,
}: {
  value: BehaviorValue
  options?: BehaviorValue[]
  locked?: boolean
  small?: boolean
  label: string
  onChange: (v: BehaviorValue) => void
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
          {BEHAVIOR_VALUE_LABELS[o]}
        </button>
      ))}
    </div>
  )
}

/* ---------- One core behavior ---------- */

/**
 * A behavior from the catalog and the control that sets it, for the account types being edited. A behavior none of
 * them can take is locked at N; one only some can take says which get N. Set to BOTH, a behavior whose rule is by
 * journey offers the journeys that get Y (`yesForJourneys`); the other two BOTH rules are the spec's own.
 */
export function BehaviorRow({
  meta,
  behavior,
  accountTypes,
  journeys,
  compact,
  onChange,
  onJourneys,
}: {
  meta: BehaviorMeta
  behavior: Behavior
  accountTypes: AccountType[]
  /** The journeys BOTH gives Y, for a behavior whose BOTH rule is by journey. */
  journeys?: string[]
  compact?: boolean
  onChange: (next: Behavior) => void
  onJourneys?: (next: string[]) => void
}) {
  const takers = accountTypes.filter((t) => behaviorAppliesTo(meta, t))
  const locked = accountTypes.length > 0 && takers.length === 0
  const lockNote = locked
    ? `Only ${meta.accountTypes.map((t) => ACCOUNT_TYPE_LABELS[t]).join(' and ')} profiles take it.`
    : takers.length < accountTypes.length
      ? (() => {
          const others = accountTypes.filter((t) => !takers.includes(t))
          return `${others.map((t) => ACCOUNT_TYPE_LABELS[t]).join(' and ')} ${others.length === 1 ? 'takes' : 'take'} N.`
        })()
      : null
  const value = locked ? 'N' : behavior[meta.key]
  const showRule = value === 'BOTH' && meta.bothRuleByJourney && onJourneys
  return (
    <div
      className={`bhv-row ${compact ? 'compact' : ''} ${locked ? 'locked' : ''}`}
      title={compact ? (lockNote ?? meta.description) : undefined}
    >
      <div className="bhv-row-head">
        <div className="bhv-row-main">
          <span className="bhv-row-name">{meta.label}</span>
          {!compact && (
            <>
              <p className="bhv-row-desc">{meta.description}</p>
              {lockNote && <p className="bhv-lock-note">{lockNote}</p>}
            </>
          )}
        </div>
        <TriToggle
          value={value}
          locked={locked}
          small={compact}
          label={meta.label}
          onChange={(next) => onChange(setBehavior(behavior, meta.key, next))}
        />
      </div>
      {showRule && <JourneyRule selected={journeys ?? []} onChange={onJourneys} />}
    </div>
  )
}

/** BOTH's rule: which journeys get Y. Every other journey gets N. */
function JourneyRule({ selected, onChange }: { selected: string[]; onChange: (next: string[]) => void }) {
  const { catalog } = useApp()
  return (
    <div className="bhv-rule">
      <span className="bhv-rule-label">
        Y for {selected.length === 0 ? 'no journeys yet: pick the ones that need it' : `${selected.length} journey${selected.length > 1 ? 's' : ''}`}
      </span>
      <div className="bhv-rule-chips">
        {(catalog?.journeys ?? []).map((j) => {
          const on = selected.includes(j.key)
          return (
            <button
              key={j.key}
              type="button"
              className={`rule-chip ${on ? 'on' : ''}`}
              aria-pressed={on}
              title={j.key}
              onClick={() => onChange(on ? selected.filter((k) => k !== j.key) : [...selected, j.key])}
            >
              {j.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
