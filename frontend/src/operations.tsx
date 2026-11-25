import { useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useApp } from './AppContext'
import { DURATION_UNIT_LABELS, formatDuration, parseDuration } from './lib'
import type { DurationUnit } from './lib'
import type { AccountType, Behavior, OperationsSettings } from './types'

/**
 * The Operations step (wiki, "Operations settings"): every setting a release carries besides its APIs and behaviors.
 * Each field writes the release key of the same name; an empty field leaves the key out, so billpay-core's default
 * applies, and the placeholder says what that default is.
 */
export function OperationsEditor({
  value,
  onChange,
  accountTypes,
  behavior,
  currency,
}: {
  value: OperationsSettings
  onChange: (next: OperationsSettings) => void
  accountTypes: AccountType[]
  behavior: Behavior
  currency: string
}) {
  const { catalog } = useApp()
  const set = <K extends keyof OperationsSettings>(key: K, v: OperationsSettings[K]) => onChange({ ...value, [key]: v })
  const corporate = accountTypes.includes('CORPORATE')
  const bank = behavior.requiresBankConfirmation !== 'N'
  const defaults = catalog?.defaultRavenStatuses ?? []

  return (
    <div className="ops">
      <OpsSection title="Schedule" note="The scheduled-payments run, in the market's own time.">
        <Field label="Time zone" hint="An IANA zone. A release without one takes no scheduled payments.">
          <TimeZoneSelect value={value.timeZone ?? ''} onChange={(v) => set('timeZone', v || null)} />
        </Field>
        <Field label="Execution time" hint="Local time of the run; midnight when unset.">
          <input
            type="time"
            value={value.executionTime ?? ''}
            onChange={(e) => set('executionTime', e.target.value || null)}
            aria-label="Execution time"
          />
        </Field>
        <Field label="Cancellation window" hint="Closes this long before the run; 1 hour when unset.">
          <DurationInput value={value.cancellationWindow} placeholder="1" units={['M', 'H']} onChange={(v) => set('cancellationWindow', v)} />
        </Field>
        <Field label="Execution cutoff" hint="Only for a cutoff market, such as SEPA: the run must finish within it.">
          <DurationInput value={value.executionCutoff} placeholder="none" units={['M', 'H']} onChange={(v) => set('executionCutoff', v)} />
        </Field>
        <Field label="Execution floor" hint="The lowest rate the run may drop to, in TPS; 50 for the US.">
          <input
            type="number"
            min={0}
            value={value.executionFloorTps ?? ''}
            placeholder="none"
            onChange={(e) => set('executionFloorTps', e.target.value === '' ? null : Number(e.target.value))}
            aria-label="Execution floor in TPS"
          />
        </Field>
      </OpsSection>

      {corporate && (
        <OpsSection title="Corporate allocations" note={accountTypes.length > 1 ? 'Sent with the Corporate release only.' : undefined}>
          <Field label="Fetch allocations" hint="This long before the execution time on the due date; at it when unset.">
            <DurationInput value={value.allocationFetchBefore} placeholder="0" units={['H', 'D']} onChange={(v) => set('allocationFetchBefore', v)} />
          </Field>
          <Field label="Alert after" hint="Raise an alert for a payment still allocating this long; no alert when unset.">
            <DurationInput value={value.allocationAlertAfter} placeholder="none" units={['M', 'H']} onChange={(v) => set('allocationAlertAfter', v)} />
          </Field>
        </OpsSection>
      )}

      <OpsSection title="Returns" note="A release without representment rules represents nothing.">
        <Toggle
          label="Represent returned payments"
          checked={!!value.representment}
          onChange={(on) => set('representment', on ? { representableReasons: [], maxRepresentments: 1, delayDays: 0 } : null)}
        />
        {value.representment && (
          <>
            <Field label="Representable reasons" hint="The return reason codes that may be presented again.">
              <TagInput
                values={value.representment.representableReasons}
                placeholder="Add a reason code"
                onChange={(v) => set('representment', { ...value.representment!, representableReasons: v })}
              />
            </Field>
            <Field label="Most representments">
              <input
                type="number"
                min={0}
                value={value.representment.maxRepresentments}
                onChange={(e) => set('representment', { ...value.representment!, maxRepresentments: Number(e.target.value) })}
                aria-label="Most representments"
              />
            </Field>
            <Field label="Delay" hint="Days after the return arrives; 0 is the same day.">
              <input
                type="number"
                min={0}
                value={value.representment.delayDays}
                onChange={(e) => set('representment', { ...value.representment!, delayDays: Number(e.target.value) })}
                aria-label="Delay in days"
              />
            </Field>
          </>
        )}
      </OpsSection>

      <OpsSection title="Raven notifications" note="Which status changes send the customer a message.">
        <Toggle
          label={`The default ${defaults.length}: ${defaults.join(', ')}`}
          checked={value.ravenStatuses == null}
          onChange={(on) => set('ravenStatuses', on ? null : [...defaults])}
        />
        {value.ravenStatuses != null && (
          <div className="ops-checks">
            {(catalog?.paymentStatuses ?? []).map((status) => {
              const on = value.ravenStatuses!.includes(status)
              return (
                <label key={status} className={`ops-check ${on ? 'on' : ''}`}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      set('ravenStatuses', on ? value.ravenStatuses!.filter((s) => s !== status) : [...value.ravenStatuses!, status])
                    }
                  />
                  {status}
                </label>
              )
            })}
          </div>
        )}
        <p className="ops-note">A Pay with Bank Transfer or debit card payment sends none at PROCESSED, whatever the list says.</p>
      </OpsSection>

      {bank && (
        <OpsSection title="Bank confirmation" note="How long a payment waits for the customer's bank, and the fallback status calls.">
          <Field label="Confirmation window" hint="The market's wait from the create, 24 to 48 hours; then still pending is declined.">
            <DurationInput
              value={value.bankConfirmation?.confirmationWindow}
              placeholder="24"
              units={['H']}
              warn={(iso) => {
                const d = parseDuration(iso)
                const hours = d ? (d.unit === 'H' ? d.amount : d.unit === 'D' ? d.amount * 24 : d.unit === 'M' ? d.amount / 60 : d.amount / 3600) : null
                return hours !== null && (hours < 24 || hours > 48) ? 'The spec puts it between 24 and 48 hours.' : null
              }}
              onChange={(v) => set('bankConfirmation', { ...value.bankConfirmation, confirmationWindow: v })}
            />
          </Field>
          <Field label="First status call" hint="When neither the channel nor Amex Pay with Bank Transfer has answered; 2 minutes when unset.">
            <DurationInput value={value.bankConfirmation?.statusCheckDelay} placeholder="2" units={['M']} onChange={(v) => set('bankConfirmation', { ...value.bankConfirmation, statusCheckDelay: v })} />
          </Field>
          <Field label="Between calls" hint="Doubles after each call; 2 minutes when unset.">
            <DurationInput value={value.bankConfirmation?.statusCheckInterval} placeholder="2" units={['M']} onChange={(v) => set('bankConfirmation', { ...value.bankConfirmation, statusCheckInterval: v })} />
          </Field>
          <Field label="Longest gap" hint="30 minutes when unset.">
            <DurationInput value={value.bankConfirmation?.statusCheckMaxInterval} placeholder="30" units={['M']} onChange={(v) => set('bankConfirmation', { ...value.bankConfirmation, statusCheckMaxInterval: v })} />
          </Field>
        </OpsSection>
      )}

      <OpsSection title="Ways to pay" note="What the verification rules take, and the card provider for 3D Secure.">
        <Field label="Largest payment" hint={`In ${currency || 'the market currency'}; no limit when unset.`}>
          <input
            type="number"
            min={0}
            value={amountOf(value.ruleSettings?.maxPaymentAmount)}
            placeholder="none"
            onChange={(e) =>
              set('ruleSettings', {
                ...value.ruleSettings,
                maxPaymentAmount: e.target.value === '' ? null : `${e.target.value} ${currency}`,
              })
            }
            aria-label="Largest payment"
          />
        </Field>
        <Field label="Instrument types" hint="The instrument types the market takes; every type when none are listed.">
          <TagInput
            values={value.ruleSettings?.acceptedInstrumentTypes ?? []}
            placeholder="Add a type, e.g. BANK_ACCOUNT"
            onChange={(v) => set('ruleSettings', { ...value.ruleSettings, acceptedInstrumentTypes: v.length ? v : null })}
          />
        </Field>
        <Toggle label="Offer Pay with MR Points" checked={!!value.payWithMrPoints} onChange={(on) => set('payWithMrPoints', on)} />
        <Field label="Card provider" hint="For a debit card's 3D Secure and authorization, such as Checkout.com in the UK.">
          <input
            value={value.cardAuthentication?.provider ?? ''}
            placeholder="none"
            onChange={(e) => set('cardAuthentication', { ...value.cardAuthentication, provider: e.target.value || null })}
            aria-label="Card provider"
          />
        </Field>
        <Field label="Authentication window" hint="How long a debit card payment waits for its 3D Secure callback; 2 minutes.">
          <DurationInput
            value={value.cardAuthentication?.authenticationWindow}
            placeholder="2"
            units={['M']}
            onChange={(v) => set('cardAuthentication', { ...value.cardAuthentication, authenticationWindow: v })}
          />
        </Field>
      </OpsSection>

      <OpsSection title="Instruments page" note="Which enrolled instrument statuses the page may offer; ACTIVE alone when unset.">
        {(catalog?.journeyContexts ?? []).map((context) => (
          <Field key={context} label={context.toLowerCase().replace(/_/g, ' ')}>
            <TagInput
              values={value.enrolledInstrumentStatuses?.[context] ?? []}
              placeholder="ACTIVE"
              onChange={(v) => {
                const next = { ...(value.enrolledInstrumentStatuses ?? {}) }
                if (v.length) next[context] = v
                else delete next[context]
                set('enrolledInstrumentStatuses', next)
              }}
            />
          </Field>
        ))}
        <Field label="Pending sweep" hint="How old a pending entry gets before One-Data's sweep asks about it; 2 hours.">
          <DurationInput value={value.pendingSweepAfter} placeholder="2" units={['H']} onChange={(v) => set('pendingSweepAfter', v)} />
        </Field>
      </OpsSection>

      <OpsSection title="Test accounts" note="Mock accounts whose payments run on this version before it is active, by account token.">
        <TagInput
          values={value.testAccounts ?? []}
          placeholder="Add an account token"
          onChange={(v) => set('testAccounts', v)}
        />
      </OpsSection>
    </div>
  )
}

function amountOf(raw?: string | null): string {
  return raw ? raw.trim().split(/\s+/)[0] : ''
}

/* ---------- field primitives ---------- */

function OpsSection({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="ops-section">
      <header className="ops-section-head">
        <h4>{title}</h4>
        {note && <p>{note}</p>}
      </header>
      <div className="ops-fields">{children}</div>
    </section>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId()
  return (
    <div className="ops-field">
      <span className="ops-label" id={id}>
        {label}
      </span>
      <div className="ops-control" role="group" aria-labelledby={id}>
        {children}
      </div>
      {hint && <p className="ops-hint">{hint}</p>}
    </div>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className={`ops-toggle ${checked ? 'on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="ops-switch" aria-hidden="true" />
      <span>{label}</span>
    </label>
  )
}

/** An ISO duration as a number and a unit; empty means unset. */
function DurationInput({
  value,
  units,
  placeholder,
  warn,
  onChange,
}: {
  value?: string | null
  units: DurationUnit[]
  placeholder?: string
  warn?: (iso: string | null) => string | null
  onChange: (iso: string | null) => void
}) {
  const parsed = parseDuration(value)
  const [unit, setUnit] = useState<DurationUnit>(parsed?.unit && units.includes(parsed.unit) ? parsed.unit : units[0])
  // A stored value in a unit this field doesn't offer is shown in it, so nothing is silently converted.
  const shownUnits = parsed && !units.includes(parsed.unit) ? [...units, parsed.unit] : units
  const shownUnit = parsed?.unit ?? unit
  const warning = warn?.(value ?? null)
  return (
    <span className="ops-duration">
      <input
        type="number"
        min={0}
        value={parsed?.amount ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === '' ? null : formatDuration(Number(e.target.value), shownUnit))}
        aria-label="Amount"
      />
      <select
        value={shownUnit}
        onChange={(e) => {
          const next = e.target.value as DurationUnit
          setUnit(next)
          if (parsed) onChange(formatDuration(parsed.amount, next))
        }}
        aria-label="Unit"
      >
        {shownUnits.map((u) => (
          <option key={u} value={u}>
            {DURATION_UNIT_LABELS[u]}
          </option>
        ))}
      </select>
      {value && <code className="ops-iso">{value}</code>}
      {warning && <span className="ops-warn">{warning}</span>}
    </span>
  )
}

function TimeZoneSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const zones = useMemo(() => {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
    return value && !all.includes(value) ? [value, ...all] : all
  }, [value])
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Time zone">
      <option value="">Not set</option>
      {zones.map((z) => (
        <option key={z} value={z}>
          {z}
        </option>
      ))}
    </select>
  )
}

/** A short list of codes or tokens: Enter or a comma adds one, × takes it out. */
function TagInput({ values, placeholder, onChange }: { values: string[]; placeholder?: string; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('')
  function add() {
    const next = draft.split(',').map((v) => v.trim()).filter((v) => v && !values.includes(v))
    if (next.length) onChange([...values, ...next])
    setDraft('')
  }
  return (
    <span className="ops-tags">
      {values.map((v) => (
        <span key={v} className="ops-tag">
          {v}
          <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}>
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          }
        }}
        onBlur={add}
        aria-label={placeholder ?? 'Add'}
      />
    </span>
  )
}
