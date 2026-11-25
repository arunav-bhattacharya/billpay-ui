import { useEffect, useId, useState } from 'react'
import { api } from '../api'
import { useApp } from '../appState'
import { ErrorNote, JsonBlock, Modal } from '../components'
import { TickIcon } from '../icons'
import {
  ACCOUNT_TYPE_LABELS,
  ENV_LABELS,
  ENV_NAMES,
  RELEASE_STATUS_LABELS,
  formatDateTime,
  formatRelative,
  missingCombinations,
  nextEnv,
} from '../lib'
import { releaseBehavior, runWindow, utcLabel } from '../schedule'
import type {
  DeploymentView,
  EnvironmentInfo,
  EnvReadiness,
  EnvStage,
  LiveRelease,
  MarketDocument,
  MarketProfile,
  ProfileReadiness,
  ReadinessStep,
  ReleaseStatus,
} from '../types'

export interface ReadinessActions {
  busy: boolean
  onSignOff: (env: EnvStage) => void
  onRecordRfc: (rfcNumber: string) => void
  onPromote: (from: EnvStage) => void
  onRollback: (env: EnvStage, reason: string) => void
  onPause: (env: EnvStage, reason: string) => void
  onResume: (env: EnvStage, reason: string) => void
}

const TONE: Record<ReleaseStatus, string> = {
  REQUESTED: 'run',
  RUNNING: 'run',
  WAITING_FOR_SIGN_OFF: 'wait',
  ACTIVE: 'live',
  FAILED: 'stop',
  ROLLED_BACK: 'ghost',
  SUPERSEDED: 'ghost',
}

const moving = (d?: DeploymentView | null) => !!d && (d.status === 'REQUESTED' || d.status === 'RUNNING')

/**
 * The rollout board: one lane per environment, left to right in the order a release travels. The newest version in
 * each lane is a card carrying its step, the person it waits for and its next action; the version live there, when
 * that is an older one, and earlier versions sit quieter below it.
 */
export function EnvironmentReadiness({
  market,
  profile,
  readiness,
  environments,
  actions,
}: {
  market: MarketDocument
  profile: MarketProfile
  readiness: ProfileReadiness
  environments: EnvironmentInfo[]
  actions: ReadinessActions
}) {
  return (
    <div className="lanes">
      {readiness.environments.map((env, i) => (
        <Lane
          key={env.env}
          index={i}
          env={env}
          info={environments.find((e) => e.env === env.env)}
          next={readiness.environments.find((e) => e.env === nextEnv(env.env))}
          market={market}
          profile={profile}
          actions={actions}
        />
      ))}
    </div>
  )
}

function Lane({
  index,
  env,
  info,
  next,
  market,
  profile,
  actions,
}: {
  index: number
  env: EnvReadiness
  info?: EnvironmentInfo
  next?: EnvReadiness
  market: MarketDocument
  profile: MarketProfile
  actions: ReadinessActions
}) {
  const current = env.current
  const live = env.live
  const waiting = current?.status === 'WAITING_FOR_SIGN_OFF'
  const needsRfc = env.env === 'E3' && waiting && !current?.rfc
  const to = nextEnv(env.env)
  const nextBusy = !!next?.current && ['REQUESTED', 'RUNNING', 'WAITING_FOR_SIGN_OFF'].includes(next.current.status)
  const promotable =
    !!live && !!to && !nextBusy && !next?.history.some((d) => d.version === live.version && d.status !== 'FAILED')
  const paused = !!env.control?.paused
  const older = env.history.filter((d) => d.version !== current?.version && d.version !== live?.version)

  return (
    <>
      {index > 0 && (
        <div className="lane-arrow" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M5 12h12m-4-4 4 4-4 4" fill="none" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      )}
      <section
        className={`lane card env-${env.state.toLowerCase().replace(/_/g, '-')}`}
        aria-label={`${ENV_NAMES[env.env]} (${ENV_LABELS[env.env]})`}
      >
        <header className="lane-h">
          <span className="lane-k">{ENV_LABELS[env.env]}</span>
          <span className="lane-name">{ENV_NAMES[env.env]}</span>
          <span
            className={`env-mode mode-${env.mode.toLowerCase()}`}
            title={
              env.mode === 'CONNECTED'
                ? `Calls the Market Onboarding API at ${info?.url ?? 'its billpay-offline'}`
                : 'No Market Onboarding API is configured here: billpay-ui walks its releases through the same steps itself'
            }
          >
            {env.mode === 'CONNECTED' ? 'Connected' : 'Simulated'}
          </span>
        </header>

        {!current && (
          <p className="lane-empty">
            {env.env === 'E1'
              ? 'Release the profile to send its first version here.'
              : `A version comes here once it is live in ${env.env === 'E2' ? 'e1' : 'e2'} and promoted.`}
          </p>
        )}

        {current && (
          <article className={`ver ${moving(current) ? 'moving' : ''}`}>
            <header className="ver-h">
              <span className="ver-v">v{current.version}</span>
              <span className={`pill ${TONE[current.status]}`}>
                <i className="dot" />
                {current.status === 'RUNNING' && current.step ? stepLabel(current.step) : RELEASE_STATUS_LABELS[current.status]}
              </span>
            </header>
            <p className="ver-by">
              Sent {formatRelative(current.requestedAt)}
              {current.requestedBy && <> by {current.requestedBy}</>}
              {current.simulated && env.mode === 'CONNECTED' && <> · seeded</>}
              {paused && current.status === 'ACTIVE' && (
                <>
                  {' '}
                  · <b className="paused-tag">paused</b>
                </>
              )}
            </p>

            <VersionJson market={market} profile={profile} version={current.version} env={env.env} />

            {current.lastError && <p className="ver-warn">{current.lastError}</p>}
            {current.status === 'FAILED' && current.reason && (
              <p className="ver-error">
                {current.needsBuild && <span className="needs-build">Needs a build</span>}
                {current.reason}
              </p>
            )}

            {env.steps.length > 0 && current.status !== 'ACTIVE' && (
              <ol className="steps">
                {env.steps.map((step) => (
                  <StepRow key={step.key} step={step} deployment={current} />
                ))}
              </ol>
            )}
            {current.status === 'ACTIVE' && (
              <p className="ver-done">
                <TickIcon className="mark mark-done mark-sm" />
                Signed off{current.signedOffBy ? ` by ${current.signedOffBy}` : ''}
                {current.signedOffAt ? `, ${formatDateTime(current.signedOffAt)}` : ''}
                {current.rfc ? ` under ${current.rfc}` : ''}
              </p>
            )}

            {needsRfc && <RfcField busy={actions.busy} onSubmit={actions.onRecordRfc} />}

            {(waiting || (promotable && live?.version === current.version)) && (
              <div className="ver-actions">
                {waiting && (
                  <button
                    className="btn sm primary"
                    disabled={actions.busy || needsRfc}
                    title={needsRfc ? 'Record the change request first' : undefined}
                    onClick={() => actions.onSignOff(env.env)}
                  >
                    Sign off v{current.version}
                  </button>
                )}
                {promotable && live?.version === current.version && (
                  <button className="btn sm navy" disabled={actions.busy} onClick={() => actions.onPromote(env.env)}>
                    Promote v{live.version} to {ENV_LABELS[to!]}
                  </button>
                )}
              </div>
            )}

            {live && live.version === current.version && (
              <LiveControls env={env.env} live={live} paused={paused} market={market} profile={profile} busy={actions.busy} actions={actions} />
            )}
          </article>
        )}

        {live && current && live.version !== current.version && (
          <article className="ver live-under">
            <header className="ver-h">
              <span className="ver-v">v{live.version}</span>
              <span className="pill live">
                <i className="dot" />
                Live{paused ? ', paused' : ''}
              </span>
            </header>
            <VersionJson market={market} profile={profile} version={live.version} env={env.env} />
            {promotable && (
              <div className="ver-actions">
                <button className="btn sm navy" disabled={actions.busy} onClick={() => actions.onPromote(env.env)}>
                  Promote v{live.version} to {ENV_LABELS[to!]}
                </button>
              </div>
            )}
            <LiveControls
              env={env.env}
              live={live}
              paused={paused}
              market={market}
              profile={profile}
              busy={actions.busy || moving(current)}
              actions={actions}
            />
          </article>
        )}

        {env.control && (
          <p className="lane-note">
            {env.control.paused ? 'Paused' : 'Resumed'} by {env.control.by} {formatRelative(env.control.at)}
            {env.control.reason && <>: “{env.control.reason}”</>}
          </p>
        )}

        {older.length > 0 && (
          <ul className="ver-older" aria-label={`Earlier versions in ${ENV_LABELS[env.env]}`}>
            {older.map((d) => (
              <li key={d.version} title={d.status === 'ACTIVE' ? undefined : (d.reason ?? undefined)}>
                <span className="ver-v">v{d.version}</span>
                <span className={`pill ${TONE[d.status]}`}>{RELEASE_STATUS_LABELS[d.status]}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

/**
 * A version's release JSON, exactly as it was frozen and sent: what this environment holds for the profile, which is
 * the thing to read when asking what runs here.
 */
function VersionJson({ market, profile, version, env }: { market: MarketDocument; profile: MarketProfile; version: number; env: EnvStage }) {
  const [json, setJson] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  function show() {
    setOpen(true)
    if (json || !profile.id) return
    api
      .releases(market.market.code, profile.id)
      .then((all) => {
        const r = all.find((x) => x.version === version)
        setJson(r ? JSON.stringify(r.config, null, 2) : null)
        if (!r) setError(`v${version} has no frozen release`)
      })
      .catch((e: Error) => setError(e.message))
  }
  return (
    <>
      <button className="link-btn ver-json" onClick={show}>
        Release JSON
      </button>
      {open && (
        <Modal title={`${market.market.name} · ${ACCOUNT_TYPE_LABELS[profile.accountType]} · v${version} in ${ENV_LABELS[env]}`} onClose={() => setOpen(false)}>
          <p className="modal-lede">The release as it was frozen and sent: what billpay-core's Router reads for this version.</p>
          <ErrorNote message={error} />
          {json ? (
            <JsonBlock json={json} filename={`${market.market.code.toLowerCase()}-${profile.accountType.toLowerCase()}-v${version}.json`} />
          ) : (
            !error && <p className="muted">Loading…</p>
          )}
        </Modal>
      )}
    </>
  )
}

function stepLabel(step: string): string {
  const labels: Record<string, string> = {
    CHECK: 'Checking',
    SAVE: 'Saving',
    TEST: 'Testing',
    WAIT: 'Waiting',
    ACTIVATE: 'Activating',
    ROLLBACK: 'Rolling back',
  }
  return labels[step] ?? step
}

/**
 * Rollback, pause and resume act on the live version without a new release; each asks why, and each says first what
 * it will do. A rollback checks the version it restores against the build; a pause lists everything it holds.
 */
function LiveControls({
  env,
  live,
  paused,
  market,
  profile,
  busy,
  actions,
}: {
  env: EnvStage
  live: DeploymentView
  paused: boolean
  market: MarketDocument
  profile: MarketProfile
  busy: boolean
  actions: ReadinessActions
}) {
  const [asking, setAsking] = useState<'rollback' | 'pause' | 'resume' | null>(null)
  const [reason, setReason] = useState('')
  const id = useId()

  function confirm() {
    const why = reason.trim()
    if (asking === 'rollback') actions.onRollback(env, why)
    if (asking === 'pause') actions.onPause(env, why)
    if (asking === 'resume') actions.onResume(env, why)
    setAsking(null)
    setReason('')
  }

  if (!asking) {
    return (
      <div className="ver-links">
        <button className="link-btn" disabled={busy} onClick={() => setAsking(paused ? 'resume' : 'pause')}>
          {paused ? 'Resume runs' : 'Pause runs'}
        </button>
        {live.replacedVersion != null && (
          <button className="link-btn danger" disabled={busy} onClick={() => setAsking('rollback')}>
            Roll back to v{live.replacedVersion}
          </button>
        )}
      </div>
    )
  }

  const title =
    asking === 'rollback'
      ? `Roll back to v${live.replacedVersion}`
      : asking === 'pause'
        ? `Pause ${market.market.name} in ${ENV_LABELS[env]}`
        : `Resume ${market.market.name} in ${ENV_LABELS[env]}`
  const verb =
    asking === 'rollback' ? `Roll back to v${live.replacedVersion}` : asking === 'pause' ? `Pause ${market.market.name}` : `Resume ${market.market.name}`
  return (
    <div className="confirm-panel" role="group" aria-label={title}>
      <h4>{title}</h4>
      {asking === 'rollback' ? (
        <RollbackCheck env={env} market={market} profile={profile} version={live.replacedVersion!} />
      ) : (
        <PauseScope env={env} market={market} pausing={asking === 'pause'} />
      )}
      <label htmlFor={id}>Reason, for the audit trail</label>
      <input id={id} value={reason} autoFocus placeholder="Why?" onChange={(e) => setReason(e.target.value)} />
      <div className="confirm-row">
        <button className="btn sm ghost" onClick={() => setAsking(null)}>
          Cancel
        </button>
        <button
          className={`btn sm ${asking === 'resume' ? 'primary' : asking === 'pause' ? 'slate' : 'danger-solid'}`}
          disabled={busy || !reason.trim()}
          title={reason.trim() ? undefined : 'Say why first'}
          onClick={confirm}
        >
          {verb}
        </button>
      </div>
    </div>
  )
}

/**
 * What a pause holds, before anyone confirms. The execution rate's scope is the market, so every account type live
 * in it holds, not only this one; the next runs come from the releases they run. How many payments are waiting is
 * billpay-core's to say, and it doesn't yet.
 */
function PauseScope({ env, market, pausing }: { env: EnvStage; market: MarketDocument; pausing: boolean }) {
  const [live, setLive] = useState<LiveRelease[] | null>(null)
  useEffect(() => {
    api
      .live(env)
      .then((all) => setLive(all.filter((r) => r.market === market.market.code)))
      .catch(() => setLive([]))
  }, [env, market.market.code])
  const now = new Date()
  return (
    <div className="scope">
      <p className="scope-lede">
        {pausing
          ? `The execution rate is the market's, so a pause holds every account type's runs in ${market.market.name}, not only this one.`
          : "Resuming clears the market's pause on its execution rate, so every account type's held runs go again. billpay-core decides what happens to a run missed while paused."}
      </p>
      <ul>
        {(live ?? []).map((r) => {
          const w = runWindow(r.config, now)
          return (
            <li key={r.accountType}>
              <span>
                <b>{ACCOUNT_TYPE_LABELS[r.accountType]}</b> · v{r.version}
                <small>
                  {w ? `next run ${w.localTime} ${w.zone}, ${utcLabel(w.run)} UTC` : 'no time zone, so no scheduled runs'}
                  {r.paused ? ' · already paused' : ''}
                </small>
              </span>
              <span className={pausing ? 'held' : 'freed'}>{pausing ? 'Held' : 'Runs'}</span>
            </li>
          )
        })}
        <li>
          <span>
            <b>Payments already running</b>
            <small>{pausing ? "hold at the market's rate until resumed" : 'carry on at the rate the governor sets'}</small>
          </span>
          <span className={pausing ? 'held' : 'freed'}>{pausing ? 'Held' : 'Runs'}</span>
        </li>
      </ul>
      <p className="scope-foot">How many payments are waiting isn't shown: billpay-core doesn't report it yet.</p>
    </div>
  )
}

/**
 * The version a rollback restores, checked against the build in that environment: the action taken under the most
 * pressure shouldn't land on a combination the build no longer runs. It can't prove the older version was good.
 */
function RollbackCheck({
  env,
  market,
  profile,
  version,
}: {
  env: EnvStage
  market: MarketDocument
  profile: MarketProfile
  version: number
}) {
  const { capabilities, environments } = useApp()
  const [result, setResult] = useState<{ missing: number; checked: boolean } | null>(null)
  const connected = environments.find((e) => e.env === env)?.mode === 'CONNECTED'
  useEffect(() => {
    if (!profile.id) return
    api
      .releases(market.market.code, profile.id)
      .then((all) => {
        const release = all.find((r) => r.version === version)
        if (!release || !capabilities || env !== 'E1') {
          setResult({ missing: 0, checked: false })
          return
        }
        setResult({
          missing: missingCombinations(profile.accountType, releaseBehavior(release.config), capabilities).length,
          checked: true,
        })
      })
      .catch(() => setResult({ missing: 0, checked: false }))
  }, [market.market.code, profile.id, profile.accountType, version, capabilities, env])
  return (
    <div className="scope">
      <p className="scope-lede">
        Switches {ENV_LABELS[env]} back to v{version} and restores its Schedules. New payments take v{version} at once;
        payments already made stay as they are.
      </p>
      {result === null ? (
        <p className="muted">Checking v{version} against the build…</p>
      ) : result.checked ? (
        result.missing === 0 ? (
          <p className="check ok">
            <TickIcon className="mark mark-done mark-sm" /> v{version}'s combinations are all in {ENV_LABELS[env]}'s build.
            That says it can run, not that it was good.
          </p>
        ) : (
          <p className="check bad">
            v{version} needs {result.missing} combination{result.missing > 1 ? 's' : ''} {ENV_LABELS[env]}'s build no longer
            has, so payments on it would fail.
          </p>
        )
      ) : (
        <p className="check unknown">
          {connected ? `${ENV_LABELS[env]}'s manifest isn't loaded` : `${ENV_LABELS[env]} is simulated, so its build can't be checked`}.
        </p>
      )}
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
        ? `by ${deployment.signedOffBy}`
        : step.key === 'WAIT' && step.state === 'IN_PROGRESS'
          ? 'waiting on a person'
          : null
  return (
    <li className={`step step-${step.state.toLowerCase().replace(/_/g, '-')}`} title={step.description}>
      <StepMark state={step.state} />
      <span className="step-name">{step.name}</span>
      {detail && <span className="step-detail">{detail}</span>}
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
