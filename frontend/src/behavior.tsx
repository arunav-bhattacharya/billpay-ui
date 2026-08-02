import { useState } from 'react'
import { ErrorNote } from './components'
import {
  BEHAVIOR_VALUE_LABELS,
  behaviorOptions,
  isBehaviorLocked,
  setBehavior,
} from './lib'
import type {
  Behavior,
  BehaviorMeta,
  BehaviorValue,
  CustomBehaviorDef,
  CustomBehaviorType,
} from './types'

/**
 * Behavior editing, shared by the onboarding wizard and the market page.
 *
 * The two surfaces set the same things and used to build them separately, which
 * is how they drifted into two markup families for one control. They differ
 * only in density and in how much of a definition can still be changed, so both
 * are props here rather than a second copy: `compact` is the market page's
 * inline editor, the default is the wizard's roomier step.
 */

const LOCK_NOTE = 'Only available when clearing is not fully realtime.'

/* ---------- Behavior value control ----------

   Width follows the segment count, so the strictly-Y/N behaviors degrade to
   two segments with no separate component and no conditional markup. */

export function TriToggle({
  value,
  options,
  locked,
  small,
  label,
  onChange,
}: {
  value: BehaviorValue
  options: BehaviorValue[]
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
 * A behavior from the catalog and the control that sets it. `compact` drops the
 * description and the lock note down into the row's tooltip, which is what the
 * market page's inline editor wants — the wizard is explaining these for the
 * first time and keeps them on the page.
 */
export function BehaviorRow({
  meta,
  behavior,
  compact,
  onChange,
}: {
  meta: BehaviorMeta
  behavior: Behavior
  compact?: boolean
  onChange: (next: Behavior) => void
}) {
  const locked = isBehaviorLocked(meta.key, behavior)
  return (
    <div
      className={`bhv-row ${compact ? 'compact' : ''} ${locked ? 'locked' : ''}`}
      title={compact ? (locked ? LOCK_NOTE : meta.description) : undefined}
    >
      <div className="bhv-row-main">
        <span className="bhv-row-name">{meta.label}</span>
        {!compact && (
          <>
            <p className="bhv-row-desc">{meta.description}</p>
            {locked && <p className="bhv-lock-note">{LOCK_NOTE}</p>}
          </>
        )}
      </div>
      <TriToggle
        value={behavior[meta.key]}
        options={behaviorOptions(meta)}
        locked={locked}
        small={compact}
        label={meta.label}
        onChange={(next) => onChange(setBehavior(behavior, meta.key, next))}
      />
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
