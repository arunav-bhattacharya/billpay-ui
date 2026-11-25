import { useId, useState } from 'react'
import { TickIcon } from '../icons'
import { ENV_LABELS, ENV_NAMES, RELEASE_STATUS_LABELS, formatDateTime, formatRelative, nextEnv } from '../lib'
import type {
  DeploymentView,
  EnvironmentInfo,
  EnvOnboardingState,
  EnvReadiness,
  EnvStage,
  ProfileReadiness,
  ReadinessStep,
} from '../types'

const STATE_LABELS: Record<EnvOnboardingState, string> = {
  NOT_CONFIGURED: 'Nothing released yet',
  ONBOARDING_IN_PROGRESS: 'Onboarding in progress',
  ONBOARDED: 'Live',
  FAILED: 'Failed',
}

export interface ReadinessActions {
  busy: boolean
  onSignOff: (env: EnvStage) => void
  onRecordRfc: (rfcNumber: string) => void
  onPromote: (from: EnvStage) => void
  onRollback: (env: EnvStage, reason: string) => void
  onPause: (env: EnvStage, reason: string) => void
  onResume: (env: EnvStage, reason: string) => void
}

/**
 * How far one profile's releases have got in each environment, read from the deployment rows billpay-ui keeps for
 * every release it sends. The only things written here are the ones that move a release on: a sign-off, e3's change
 * request, a promotion, a rollback, and pause or resume.
 */
export function EnvironmentReadiness({
  readiness,
  environments,
  actions,
}: {
  readiness: ProfileReadiness
  environments: EnvironmentInfo[]
  actions: ReadinessActions
}) {
  return (
    <div className="readiness-envs">
      {readiness.environments.map((env) => (
        <EnvCard
          key={env.env}
          env={env}
          info={environments.find((e) => e.env === env.env)}
          next={readiness.environments.find((e) => e.env === nextEnv(env.env))}
          actions={actions}
        />
      ))}
    </div>
  )
}

function EnvCard({
  env,
  info,
  next,
  actions,
}: {
  env: EnvReadiness
  info?: EnvironmentInfo
  next?: EnvReadiness
  actions: ReadinessActions
}) {
  const current = env.current
  const live = env.live
  const moving = !!current && (current.status === 'REQUESTED' || current.status === 'RUNNING')
  const [open, setOpen] = useState(true)
  const waiting = current?.status === 'WAITING_FOR_SIGN_OFF'
  const needsRfc = env.env === 'E3' && waiting && !current?.rfc
  const to = nextEnv(env.env)
  const nextBusy = next?.current && (next.current.status === 'REQUESTED' || next.current.status === 'RUNNING' || next.current.status === 'WAITING_FOR_SIGN_OFF')
  const promotable =
    !!live && !!to && !nextBusy && next?.live?.version !== live.version && !next?.history.some((d) => d.version === live.version && d.status !== 'FAILED')
  const paused = !!env.control?.paused

  return (
    <section className={`env-card env-${env.state.toLowerCase().replace(/_/g, '-')} ${moving ? 'moving' : ''}`}>
      <header className="env-card-head">
        <div className="env-id">
          <span className="env-key">{env.env}</span>
          <span className="env-name">{ENV_NAMES[env.env]}</span>
        </div>
        <span
          className={`env-mode mode-${env.mode.toLowerCase()}`}
          title={
            env.mode === 'CONNECTED'
              ? `Calls the Market Onboarding API at ${info?.url ?? 'its billpay-offline'}`
              : 'No Market Onboarding API is configured for this environment: billpay-ui walks its releases through the same steps itself'
          }
        >
          {env.mode === 'CONNECTED' ? 'Connected' : 'Simulated'}
        </span>
        {env.steps.length > 0 && (
          <button
            className={`env-toggle ${open ? 'open' : ''}`}
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} ${ENV_NAMES[env.env]} steps`}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="chevron" aria-hidden="true" />
          </button>
        )}
      </header>

      <p className="env-status">
        <i className="env-status-dot" aria-hidden="true" />
        {STATE_LABELS[env.state]}
        {paused && <span className="env-paused">Paused</span>}
      </p>

      {current ? (
        <p className="env-meta">
          <span className="env-version">v{current.version}</span> {RELEASE_STATUS_LABELS[current.status].toLowerCase()}
          {current.step && current.status === 'RUNNING' && <> · {current.step.toLowerCase()}</>}
          {live && live.version !== current.version && <> · v{live.version} live</>}
          {current.simulated && env.mode === 'CONNECTED' && <> · seeded</>}
        </p>
      ) : (
        <p className="env-meta">
          {env.env === 'E1'
            ? 'Release the profile to send its first version here.'
            : `Promote a version here once it is live in ${env.env === 'E2' ? 'e1' : 'e2'}.`}
        </p>
      )}

      {current?.lastError && <p className="env-warn">{current.lastError}</p>}
      {current?.status === 'FAILED' && current.reason && (
        <p className="env-error">
          {current.needsBuild && <span className="env-needs-build">Needs a build</span>}
          {current.reason}
        </p>
      )}
      {env.control && (
        <p className="env-control-note">
          {env.control.paused ? 'Paused' : 'Resumed'} by {env.control.by} {formatRelative(env.control.at)}
          {env.control.reason && <>: {env.control.reason}</>}
        </p>
      )}

      {open && env.steps.length > 0 && (
        <ol className="step-list">
          {env.steps.map((step) => (
            <StepRow key={step.key} step={step} deployment={current!} />
          ))}
        </ol>
      )}

      {needsRfc && <RfcField busy={actions.busy} onSubmit={actions.onRecordRfc} />}

      <div className="env-actions">
        {waiting && (
          <button
            className="btn sm primary"
            disabled={actions.busy || needsRfc}
            title={needsRfc ? 'Record the change request first' : undefined}
            onClick={() => actions.onSignOff(env.env)}
          >
            Sign off v{current!.version}
          </button>
        )}
        {promotable && (
          <button className="btn sm navy" disabled={actions.busy} onClick={() => actions.onPromote(env.env)}>
            Promote v{live!.version} to {ENV_LABELS[to!]}
          </button>
        )}
      </div>

      {live && (
        <LiveControls
          live={live}
          paused={paused}
          busy={actions.busy || moving}
          onRollback={(reason) => actions.onRollback(env.env, reason)}
          onPause={(reason) => actions.onPause(env.env, reason)}
          onResume={(reason) => actions.onResume(env.env, reason)}
        />
      )}

      {env.history.length > 1 && (
        <ul className="env-history" aria-label={`Versions in ${ENV_LABELS[env.env]}`}>
          {env.history.map((d) => (
            <li key={d.version} className={`env-history-row st-${d.status.toLowerCase().replace(/_/g, '-')}`} title={d.status === 'ACTIVE' ? undefined : (d.reason ?? undefined)}>
              <span className="env-version">v{d.version}</span>
              <span>{RELEASE_STATUS_LABELS[d.status]}</span>
              <time dateTime={d.updatedAt}>{formatRelative(d.updatedAt)}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Rollback, pause and resume act on the live version without a new release; each asks why first. */
function LiveControls({
  live,
  paused,
  busy,
  onRollback,
  onPause,
  onResume,
}: {
  live: DeploymentView
  paused: boolean
  busy: boolean
  onRollback: (reason: string) => void
  onPause: (reason: string) => void
  onResume: (reason: string) => void
}) {
  const [asking, setAsking] = useState<'rollback' | 'pause' | 'resume' | null>(null)
  const [reason, setReason] = useState('')
  const id = useId()

  function confirm() {
    const why = reason.trim()
    if (asking === 'rollback') onRollback(why)
    if (asking === 'pause') onPause(why)
    if (asking === 'resume') onResume(why)
    setAsking(null)
    setReason('')
  }

  if (asking) {
    const what =
      asking === 'rollback'
        ? `Roll back to v${live.replacedVersion}`
        : asking === 'pause'
          ? 'Pause this market'
          : 'Resume this market'
    return (
      <div className="env-confirm" role="group" aria-label={what}>
        <label htmlFor={id}>{what}: why?</label>
        {asking === 'pause' && (
          <p className="ops-note">Pausing holds every account type's runs in this market: the execution rate is the market's.</p>
        )}
        <input id={id} value={reason} autoFocus placeholder="Reason, for the audit trail" onChange={(e) => setReason(e.target.value)} />
        <div className="env-confirm-row">
          <button className={`btn sm ${asking === 'resume' ? 'primary' : 'danger'}`} disabled={busy} onClick={confirm}>
            {asking === 'rollback' ? 'Roll back' : asking === 'pause' ? 'Pause' : 'Resume'}
          </button>
          <button className="btn sm ghost" onClick={() => setAsking(null)}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="env-live-actions">
      {live.replacedVersion != null && (
        <button className="link-btn danger" disabled={busy} onClick={() => setAsking('rollback')}>
          Roll back to v{live.replacedVersion}
        </button>
      )}
      <button className="link-btn" disabled={busy} onClick={() => setAsking(paused ? 'resume' : 'pause')}>
        {paused ? 'Resume' : 'Pause'}
      </button>
    </div>
  )
}

/**
 * The change request production runs under. ServiceNow is the authority on whether it holds, so the number is
 * submitted rather than merely typed, and only an approved one comes back recorded.
 */
function RfcField({ busy, onSubmit }: { busy: boolean; onSubmit: (rfcNumber: string) => void }) {
  const [value, setValue] = useState('')
  const inputId = useId()
  return (
    <form
      className="env-rfc"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit(value)
      }}
    >
      <label htmlFor={inputId}>Change request, before the e3 sign-off</label>
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

function StepRow({ step, deployment }: { step: ReadinessStep; deployment: DeploymentView }) {
  const detail =
    step.key === 'RFC' && deployment.rfc
      ? deployment.rfc
      : step.key === 'WAIT' && deployment.signedOffBy
        ? `by ${deployment.signedOffBy}${deployment.signedOffAt ? ` · ${formatDateTime(deployment.signedOffAt)}` : ''}`
        : null
  return (
    <li className={`step step-${step.state.toLowerCase().replace(/_/g, '-')}`}>
      <StepMark state={step.state} />
      <div className="step-body">
        <span className="step-name">{step.name}</span>
        <p className="step-desc">
          {step.description}
          {detail && <> · <span className="mono-tag">{detail}</span></>}
        </p>
      </div>
    </li>
  )
}

/** Tick when done, half-filled while running, a cross when it failed, hollow while waiting. */
function StepMark({ state }: { state: ReadinessStep['state'] }) {
  if (state === 'COMPLETE') return <TickIcon className="mark mark-done" />
  if (state === 'IN_PROGRESS') {
    return (
      <svg className="mark mark-running" viewBox="0 0 20 20" aria-label="In progress">
        <circle cx="10" cy="10" r="8.2" fill="none" strokeWidth="1.6" />
        <path d="M10 1.8a8.2 8.2 0 0 1 0 16.4z" />
      </svg>
    )
  }
  if (state === 'FAILED') {
    return (
      <svg className="mark mark-failed" viewBox="0 0 20 20" aria-label="Failed">
        <circle cx="10" cy="10" r="9" />
        <path d="M6.6 6.6l6.8 6.8M13.4 6.6l-6.8 6.8" fill="none" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg className="mark mark-waiting" viewBox="0 0 20 20" aria-label="Not started">
      <circle cx="10" cy="10" r="8.2" fill="none" strokeWidth="1.6" strokeDasharray="2.6 2.6" />
    </svg>
  )
}
