import { useState } from 'react'
import { useApp } from './AppContext'
import { ErrorNote } from './components'
import { ACCOUNT_TYPE_LABELS, BEHAVIOR_VALUE_LABELS, behaviorAppliesTo, setBehavior } from './lib'
import type {
  AccountType,
  Behavior,
  BehaviorMeta,
  BehaviorValue,
  CustomBehaviorDef,
  CustomBehaviorType,
} from './types'

/**
 * Behavior editing, shared by the onboarding wizard and the market page. They differ only in density and in how much
 * of a definition can still be changed, so both are props here: `compact` is the market page's inline editor, the
 * default is the wizard's roomier step.
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

/* ---------- One custom behavior ---------- */

/** The value control for a custom behavior, shaped by how it was defined. */
export function CustomBehaviorValueInput({
  def,
  value,
  onChange,
}: {
  def: CustomBehaviorDef
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

/**
 * A market-scoped custom behavior: its value, and the requirement it was asked
 * for. What can still be changed is the caller's to say — a definition the
 * market agreed before this screen opened arrives with no `onRemove` and no
 * `onDescription`, and renders its requirement as prose rather than a field.
 */
export function CustomBehaviorRow({
  def,
  value,
  compact,
  onValue,
  onDescription,
  onRemove,
}: {
  def: CustomBehaviorDef
  value: string
  compact?: boolean
  onValue: (v: string) => void
  /** Absent = the requirement is settled and shown read-only. */
  onDescription?: (v: string) => void
  /** Absent = this definition cannot be taken back out here. */
  onRemove?: () => void
}) {
  const detailId = `bhv-detail-${def.key}`
  return (
    <div className={`bhv-row bhv-row-custom ${compact ? 'compact' : ''}`}>
      <div className="bhv-row-head">
        <div className="bhv-row-main">
          <span className="bhv-row-name">
            {def.label}
            {onRemove && (
              <button
                className="link-btn danger"
                onClick={onRemove}
                aria-label={`Remove the ${def.label} behavior`}
              >
                remove
              </button>
            )}
          </span>
          {!compact && (
            <p className="bhv-row-desc mono-tag">
              {def.key} · {def.type}
              {def.type === 'ENUM' ? ` (${def.allowedValues.join(', ')})` : ''}
            </p>
          )}
        </div>
        <CustomBehaviorValueInput def={def} value={value} onChange={onValue} />
      </div>

      {/* What the market actually needs, in the requester's own words — the
          development team reads this before the profile is built. Definitions
          are market-scoped, so it reads the same wherever the behavior shows. */}
      <div className="bhv-detail">
        <label htmlFor={detailId}>Requirement</label>
        {onDescription ? (
          <textarea
            id={detailId}
            rows={3}
            placeholder="What this behavior has to do, and why this market needs it."
            value={def.description ?? ''}
            onChange={(e) => onDescription(e.target.value)}
          />
        ) : (
          <p className="bhv-detail-text">
            {def.description || 'No requirement was recorded for this behavior.'}
          </p>
        )}
      </div>
    </div>
  )
}

/* ---------- Defining a new custom behavior ---------- */

/**
 * The add form, and the only place its rules live: a key and a label are
 * required, keys are unique within the market, and an enum without values is
 * not a choice. Nothing is written anywhere until [onAdd] is called.
 */
export function CustomBehaviorDefForm({
  existingKeys,
  onAdd,
}: {
  existingKeys: string[]
  onAdd: (def: CustomBehaviorDef) => void
}) {
  const [key, setKey] = useState('')
  const [label, setLabel] = useState('')
  const [type, setType] = useState<CustomBehaviorType>('BOOLEAN')
  const [values, setValues] = useState('')
  const [error, setError] = useState<string | null>(null)

  function add() {
    const k = key.trim()
    if (!k || !label.trim()) {
      setError('Key and label are required.')
      return
    }
    if (existingKeys.includes(k)) {
      setError(`'${k}' is already defined.`)
      return
    }
    const allowedValues =
      type === 'ENUM' ? values.split(',').map((v) => v.trim()).filter(Boolean) : []
    if (type === 'ENUM' && allowedValues.length === 0) {
      setError('Enum behaviors need at least one allowed value.')
      return
    }
    setError(null)
    onAdd({ key: k, label: label.trim(), type, allowedValues })
    setKey('')
    setLabel('')
    setValues('')
  }

  return (
    <>
      <div className="def-form">
        <input
          placeholder="key (camelCase)"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          aria-label="Behavior key"
        />
        <input
          placeholder="Label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          aria-label="Behavior label"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as CustomBehaviorType)}
          aria-label="Behavior type"
        >
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
        <button className="btn sm ghost" onClick={add} aria-label="Add custom behavior">
          Add
        </button>
      </div>
      <ErrorNote message={error} />
    </>
  )
}
