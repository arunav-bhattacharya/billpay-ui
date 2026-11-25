import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useApp } from '../appState'
import { Flag } from '../icons'
import { ACCOUNT_TYPE_LABELS, describeDuration, ENV_LABELS, ENV_ORDER } from '../lib'
import { runWindow, utcLabel } from '../schedule'
import type { EnvStage, LiveRelease } from '../types'

const HOUR = 3_600_000
/** The line shows two hours behind now and twenty-two ahead. */
const BEFORE = 2 * HOUR
const SPAN = 24 * HOUR

/**
 * Every live market's next scheduled run on one UTC axis, each from the release it runs: the window in which cancels
 * and updates close, the run, and a cutoff market's deadline. A paused market is hatched. Holidays are not in the
 * config, so a run on a bank holiday still shows.
 */
export function RunsPage() {
  const { environments } = useApp()
  const [env, setEnv] = useState<EnvStage>('E3')
  const [live, setLive] = useState<LiveRelease[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    setLive(null)
    setError(null)
    api.live(env).then(setLive).catch((e: Error) => setError(e.message))
  }, [env])

  // The line moves with the clock.
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(t)
  }, [])

  const start = useMemo(() => new Date(Math.floor((now.getTime() - BEFORE) / HOUR) * HOUR), [now])
  const pos = (at: Date) => ((at.getTime() - start.getTime()) / SPAN) * 100
  const rows = (live ?? [])
    .map((r) => ({ r, w: runWindow(r.config, now) }))
    .sort((a, b) => (a.w?.run.getTime() ?? Infinity) - (b.w?.run.getTime() ?? Infinity))
  const ticks = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 4 * HOUR))
  const paused = rows.filter(({ r }) => r.paused).length
  const info = environments.find((e) => e.env === env)

  return (
    <main className="page">
      <header className="section-head">
        <div>
          <h1>Runs</h1>
          <p className="section-lede">
            The next scheduled run of every live market and account type, on one UTC axis, from the release each one
            runs. Daylight saving is worked out per zone; holidays are not in the config, so they are not shown.
          </p>
        </div>
        <div className="section-stats">
          <div className="seg" role="tablist" aria-label="Environment">
            {ENV_ORDER.map((e) => (
              <button key={e} role="tab" aria-selected={env === e} className={env === e ? 'on' : ''} onClick={() => setEnv(e)}>
                {ENV_LABELS[e]}
              </button>
            ))}
          </div>
          <span className={`env-mode mode-${(info?.mode ?? 'SIMULATED').toLowerCase()}`}>
            {info?.mode === 'CONNECTED' ? 'Connected' : 'Simulated'}
          </span>
        </div>
      </header>

      {error && <div className="error-note" role="alert">{error}</div>}

      <section className="card runs">
        <div className="runs-head">
          <h2>Next 24 hours</h2>
          <span className="pill live">
            <i className="dot" />
            {rows.filter((x) => x.w).length} runs
          </span>
          {paused > 0 && <span className="pill">{paused} paused</span>}
        </div>

        {live === null ? (
          <p className="muted">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="muted">Nothing is live in {ENV_LABELS[env]} yet.</p>
        ) : (
          <div className="runs-grid">
            <div />
            <div className="runs-axis">
              {ticks.map((t) => (
                <span key={t.getTime()} style={{ left: `${pos(t)}%` }}>
                  {utcLabel(t)}
                </span>
              ))}
            </div>
            {rows.map(({ r, w }) => (
              <RunRow key={`${r.market}-${r.accountType}`} r={r} w={w} pos={pos} />
            ))}
            <div className="runs-now" style={{ left: `calc(var(--runs-label) + (100% - var(--runs-label)) * ${pos(now) / 100})` }}>
              <span>now · {utcLabel(now)} UTC</span>
            </div>
          </div>
        )}

        <footer className="runs-key">
          <span><i className="k win" />Cancels and updates close</span>
          <span><i className="k cut" />Cutoff: the run must finish</span>
          <span><i className="k paused" />Paused</span>
          <span>Times in UTC; each row gives its local time</span>
        </footer>
      </section>
    </main>
  )
}

function RunRow({ r, w, pos }: { r: LiveRelease; w: ReturnType<typeof runWindow>; pos: (d: Date) => number }) {
  const clamp = (v: number) => Math.max(0, Math.min(100, v))
  return (
    <>
      <Link to={`/markets/${r.market}`} className="runs-label">
        <span className="runs-name">
          <Flag code={r.market} size={16} />
          {r.marketName} · {ACCOUNT_TYPE_LABELS[r.accountType]}
        </span>
        <span className="runs-sub">
          {w ? `${w.zone} · ${w.localTime} local` : 'No time zone: takes no scheduled payments'} · v{r.version}
          {r.config.executionCutoff ? ` · ${describeDuration(r.config.executionCutoff)} cutoff` : ''}
        </span>
      </Link>
      <div className={`runs-lane ${r.paused ? 'paused' : ''}`}>
        {w && (
          <>
            <i
              className="runs-win"
              style={{ left: `${clamp(pos(w.windowOpensAt))}%`, width: `${clamp(pos(w.run)) - clamp(pos(w.windowOpensAt))}%` }}
            />
            {w.cutoffAt && (
              <i className="runs-cut" style={{ left: `${clamp(pos(w.run))}%`, width: `${clamp(pos(w.cutoffAt)) - clamp(pos(w.run))}%` }} />
            )}
            <i className="runs-run" style={{ left: `${clamp(pos(w.run))}%` }}>
              <b>
                {utcLabel(w.run)}
                {r.paused ? ' · paused' : ''}
              </b>
            </i>
          </>
        )}
      </div>
    </>
  )
}
