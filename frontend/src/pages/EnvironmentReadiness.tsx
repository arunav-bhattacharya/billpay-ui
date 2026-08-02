import { useId, useState } from 'react'
import { TickIcon } from '../icons'
import { ENV_NAMES, formatDateTime } from '../lib'
import type {
  EnvOnboardingState,
  EnvReadiness,
  MarketProfile,
  ReadinessStep,
} from '../types'

const STATE_LABELS: Record<EnvOnboardingState, string> = {
  NOT_CONFIGURED: 'Not configured',
  ONBOARDING_IN_PROGRESS: 'Onboarding in progress',
  ONBOARDED: 'Onboarded',
}

/**
 * How far one account-type profile has got in each environment.
 *
 * Every state here follows from the profile — its stage, its sign-off and its
 * change request — so the only writable things are the two that close an
 * environment out: verifying it, and supplying the change request production
 * needs.
 */
export function EnvironmentReadiness({
  environments,
  profile,
  busy,
  onVerify,
  onRecordRfc,
}: {
  environments: EnvReadiness[]
  profile: MarketProfile
  busy: boolean
  onVerify: () => void
  onRecordRfc: (rfcNumber: string) => void
}) {
  return (
    <div className="readiness-envs">
      {environments.map((env) => (
        <EnvCard
          key={env.env}
          env={env}
          profile={profile}
          busy={busy}
          onVerify={onVerify}
          onRecordRfc={onRecordRfc}
        />
      ))}
    </div>
  )
}

function EnvCard({
  env,
  profile,
  busy,
  onVerify,
  onRecordRfc,
}: {
  env: EnvReadiness
  profile: MarketProfile
  busy: boolean
  onVerify: () => void
  onRecordRfc: (rfcNumber: string) => void
}) {
  const [open, setOpen] = useState(false)
  const hasSteps = env.steps.length > 0
  const done = env.steps.filter((s) => s.state === 'COMPLETE').length

  // Only the environment the profile is actually sitting in can be worked on:
  // the ones below it are closed, the ones above hold nothing yet.
  const current = env.env === profile.status
  const needsRfc = current && env.steps.some((s) => s.key === 'RFC')

  return (
    <section className={`env-card env-${env.state.toLowerCase().replace(/_/g, '-')}`}>
      <header className="env-card-head">
        <div className="env-id">
          <span className="env-key">{env.env}</span>
          <span className="env-name">{ENV_NAMES[env.env]}</span>
        </div>
        {hasSteps && (
          <button
            className={`env-toggle ${open ? 'open' : ''}`}
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} ${ENV_NAMES[env.env]} onboarding steps`}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="chevron" aria-hidden="true" />
          </button>
        )}
      </header>

      <p className="env-status">
        <i className="env-status-dot" aria-hidden="true" />
        {STATE_LABELS[env.state]}
      </p>

      {hasSteps ? (
        <p className="env-meta">
          {done} of {env.steps.length} {env.steps.length === 1 ? 'step' : 'steps'}
          {env.state === 'ONBOARDED' && env.completedAt && (
            <> · {formatDateTime(env.completedAt)}</>
          )}
        </p>
      ) : (
        <p className="env-meta">Nothing has been deployed here yet.</p>
      )}

      {needsRfc && (
        <RfcField
          rfcNumber={profile.rfcNumber}
          busy={busy}
          onSubmit={onRecordRfc}
        />
      )}

      {open && (
        <ol className="step-list">
          {env.steps.map((step) => (
            <StepRow
              key={step.key}
              step={step}
              rfcNumber={profile.rfcNumber}
              /* Sign-off is the last step and the only one a person closes, so
                 its control lives in the step itself — and only on the
                 environment the profile is actually sitting in. */
              onSignOff={current && step.key === 'SIGN_OFF' ? onVerify : undefined}
              busy={busy}
            />
          ))}
        </ol>
      )}
    </section>
  )
}

/**
 * The change request production runs under. ServiceNow is the authority on
 * whether it holds, so the number is submitted rather than merely typed, and
 * only an approved one comes back recorded.
 */
function RfcField({
  rfcNumber,
  busy,
  onSubmit,
}: {
  rfcNumber?: string | null
  busy: boolean
  onSubmit: (rfcNumber: string) => void
}) {
  const [value, setValue] = useState('')
  // A market can have more than one profile in production, so the field is
  // rendered more than once; a fixed id would tie every label to the first.
  const inputId = useId()

  if (rfcNumber) {
    return (
      <p className="env-rfc-done">
        <TickIcon className="mark mark-done mark-sm" />
        <span className="mono-tag">{rfcNumber}</span>
      </p>
    )
  }

  return (
    <form
      className="env-rfc"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(value)
      }}
    >
      <label htmlFor={inputId}>Change request</label>
      <div className="env-rfc-row">
        <input
          id={inputId}
          value={value}
          placeholder="CHG0000000"
          autoComplete="off"
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
        />
        <button className="btn sm primary" type="submit" disabled={busy || !value.trim()}>
          Validate
        </button>
      </div>
    </form>
  )
}

function StepRow({
  step,
  rfcNumber,
  onSignOff,
  busy,
}: {
  step: ReadinessStep
  rfcNumber?: string | null
  onSignOff?: () => void
  busy?: boolean
}) {
  const verified = step.apis.filter((a) => a.verified).length
  return (
    <li className={`step step-${step.state.toLowerCase().replace(/_/g, '-')}`}>
      <StepMark state={step.state} />
      <div className="step-body">
        <span className="step-name">{step.name}</span>
        <p className="step-desc">
          {step.description}
          {step.key === 'RFC' && rfcNumber && <> · <span className="mono-tag">{rfcNumber}</span></>}
        </p>

        {onSignOff && step.state !== 'COMPLETE' && (
          <button className="btn sm primary step-action" disabled={busy} onClick={onSignOff}>
            Sign off
          </button>
        )}

        {step.apis.length > 0 && (
          <ul className="step-apis">
            {step.apis.map((api) => (
              // The plain-language name is enough here; the versioned
              // identifier is one hover away and would double the row count.
              <li
                key={api.name}
                className={`step-api ${api.verified ? 'ok' : 'waiting'}`}
                title={api.name}
              >
                <StepMark state={api.verified ? 'COMPLETE' : 'PENDING'} small />
                <span className="step-api-title">{api.title}</span>
              </li>
            ))}
            <li className="step-api-count">
              {verified} of {step.apis.length} APIs verified
            </li>
          </ul>
        )}
      </div>
    </li>
  )
}

/** Tick when done, half-filled while running, hollow while waiting. */
function StepMark({ state, small }: { state: ReadinessStep['state']; small?: boolean }) {
  if (state === 'COMPLETE') {
    // The shared check disc, so a completed step matches every other tick.
    return <TickIcon className={`mark mark-done ${small ? 'mark-sm' : ''}`} />
  }
  if (state === 'IN_PROGRESS') {
    return (
      <svg className={`mark mark-running ${small ? 'mark-sm' : ''}`} viewBox="0 0 20 20" aria-label="In progress">
        <circle cx="10" cy="10" r="8.2" fill="none" strokeWidth="1.6" />
        <path d="M10 1.8a8.2 8.2 0 0 1 0 16.4z" />
      </svg>
    )
  }
  return (
    <svg className={`mark mark-waiting ${small ? 'mark-sm' : ''}`} viewBox="0 0 20 20" aria-label="Not started">
      <circle cx="10" cy="10" r="8.2" fill="none" strokeWidth="1.6" strokeDasharray="2.6 2.6" />
    </svg>
  )
}
