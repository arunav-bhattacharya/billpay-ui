import { Link } from 'react-router-dom'
import { useApp } from '../appState'
import { Flag } from '../icons'
import { ACCOUNT_TYPE_LABELS, ENV_LABELS, ENV_NAMES, ENV_ORDER, RELEASE_STATUS_LABELS, REGION_ORDER } from '../lib'
import type { DeploymentView, EnvReadiness, MarketDocument, MarketProfile } from '../types'

/** How many versions e3 may trail e1 before the row says so. */
const DRIFT_AT = 2

/**
 * Which version runs where, for every market and account type: the first question in an incident, and the plainest
 * view of how far each environment trails the one before it. It shows what each environment reported for the
 * releases billpay-ui sent, not what every pod has loaded.
 */
export function VersionsPage() {
  const { markets, environments, loading } = useApp()
  const rows = markets
    .slice()
    .sort((a, b) => REGION_ORDER.indexOf(a.market.region) - REGION_ORDER.indexOf(b.market.region) || a.market.code.localeCompare(b.market.code))
    .flatMap((m) => m.profiles.map((p) => ({ market: m, profile: p })))
  const behind = rows.filter(({ market, profile }) => drift(market, profile) !== null).length

  return (
    <main className="page">
      <header className="section-head">
        <div>
          <h1>Versions</h1>
          <p className="section-lede">
            Which version is live in each environment, for every market and account type. Each cell is what that
            environment last reported, or billpay-ui's simulation where it has no API; pods reload every 15 seconds.
          </p>
        </div>
        <div className="section-stats">
          <span className="pill">{rows.length} profiles</span>
          {behind > 0 && <span className="pill wait">{behind} with e3 {DRIFT_AT}+ versions behind</span>}
        </div>
      </header>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <section className="card vmap">
          <table>
            <thead>
              <tr>
                <th>Market</th>
                <th>Account type</th>
                {ENV_ORDER.map((e) => {
                  const info = environments.find((x) => x.env === e)
                  return (
                    <th key={e} className="vmap-env">
                      {ENV_LABELS[e]} <small>{ENV_NAMES[e]}</small>
                      <span className={`env-mode mode-${(info?.mode ?? 'SIMULATED').toLowerCase()}`}>
                        {info?.mode === 'CONNECTED' ? 'Connected' : 'Simulated'}
                      </span>
                    </th>
                  )
                })}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ market, profile }) => {
                const readiness = market.readiness?.find((r) => r.profileId === profile.id)
                const lag = drift(market, profile)
                const failed = readiness?.environments.find((e) => e.current?.status === 'FAILED')
                return (
                  <tr key={`${market.market.code}-${profile.accountType}`}>
                    <td>
                      <Link to={`/markets/${market.market.code}`} className="vmap-market">
                        <Flag code={market.market.code} size={18} />
                        {market.market.name}
                      </Link>
                    </td>
                    <td className="muted">{ACCOUNT_TYPE_LABELS[profile.accountType]}</td>
                    {ENV_ORDER.map((e) => (
                      <td key={e} className="vmap-cell">
                        <EnvCell env={readiness?.environments.find((x) => x.env === e)} />
                      </td>
                    ))}
                    <td className="vmap-note">
                      {failed?.current?.needsBuild ? (
                        <span className="note-red">needs a build</span>
                      ) : lag !== null ? (
                        <span className="note-amber">e3 {lag} behind</span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <footer className="vmap-key">
            <span><i className="k live" />Live</span>
            <span><i className="k run" />Under way</span>
            <span><i className="k wait" />Waiting for sign-off</span>
            <span><i className="k stop" />Stopped</span>
            <span><i className="k ghost" />Nothing there yet</span>
          </footer>
        </section>
      )}
    </main>
  )
}

/** The live version, and beside it the newer one under way or stopped there, if any. */
function EnvCell({ env }: { env?: EnvReadiness }) {
  if (!env?.current) return <span className="vchip ghost">·</span>
  const live = env.live
  const current = env.current
  const extra = current.version !== live?.version ? current : null
  return (
    <span className="vcell">
      {live && <Chip d={live} />}
      {extra && <Chip d={extra} />}
      {env.control?.paused && <span className="vchip paused" title="Paused">II</span>}
    </span>
  )
}

function Chip({ d }: { d: DeploymentView }) {
  const tone =
    d.status === 'ACTIVE'
      ? 'live'
      : d.status === 'WAITING_FOR_SIGN_OFF'
        ? 'wait'
        : d.status === 'FAILED'
          ? 'stop'
          : d.status === 'REQUESTED' || d.status === 'RUNNING'
            ? 'run'
            : 'ghost'
  return (
    <span className={`vchip ${tone}`} title={`v${d.version} · ${RELEASE_STATUS_LABELS[d.status]}${d.reason && d.status !== 'ACTIVE' ? ` · ${d.reason}` : ''}`}>
      v{d.version}
    </span>
  )
}

/** How many versions e3 trails e1 by, when it is at least [DRIFT_AT]. */
function drift(market: MarketDocument, profile: MarketProfile): number | null {
  const r = market.readiness?.find((x) => x.profileId === profile.id)
  const e1 = r?.environments.find((e) => e.env === 'E1')?.live?.version
  const e3 = r?.environments.find((e) => e.env === 'E3')?.live?.version
  if (e1 == null || e3 == null) return null
  return e1 - e3 >= DRIFT_AT ? e1 - e3 : null
}
