import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useApp } from '../appState'
import { ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_ORDER, ENV_LABELS, manifestAccountType, missingCombinations } from '../lib'
import { releaseBehavior } from '../schedule'
import type { AccountType, Capabilities, Capability, EnvStage, LiveRelease } from '../types'

type YN = 'Y' | 'N'
const YN_VALUES: YN[] = ['N', 'Y']

/** The sixteen settings of the four behaviors, grouped by good-faith credit and realtime clearing. */
const GROUPS: [YN, YN][] = YN_VALUES.flatMap((gc) => YN_VALUES.map((rt) => [gc, rt] as [YN, YN]))
const CELLS: [YN, YN][] = YN_VALUES.flatMap((ma) => YN_VALUES.map((bc) => [ma, bc] as [YN, YN]))

const key = (type: string, gc: YN, rt: YN, ma: YN, bc: YN) => [type, gc, rt, ma, bc].join('|')
const capKey = (c: Capability) =>
  key(c.accountType, c.requiresArPosting, c.requiresRealtimeClearing, c.requiresMandateAuthorization, c.requiresBankConfirmation)

/**
 * The deployed build's capability manifest, laid out: every setting of the four behaviors per account type, which the
 * build can run, and which live profiles use it. A cell the build lacks is where a release would stop at its check,
 * needing a build. Drafts that need one are listed under it, so the gap is caught while they are written.
 */
export function BuildPage() {
  const { environments, markets, catalog } = useApp()
  const connected = environments.filter((e) => e.mode === 'CONNECTED')
  const [env, setEnv] = useState<EnvStage>('E1')
  const [manifest, setManifest] = useState<Capabilities | null>(null)
  const [live, setLive] = useState<LiveRelease[]>([])
  const [error, setError] = useState<string | null>(null)

  const reachable = connected.some((e) => e.env === env)
  useEffect(() => {
    if (!reachable) return
    setError(null)
    Promise.all([api.capabilities(env), api.live(env)])
      .then(([m, l]) => {
        setManifest(m)
        setLive(l)
      })
      .catch((e: Error) => setError(e.message))
  }, [env, reachable])

  /** Which live profiles use each cell; a BOTH uses both of its halves. */
  const usedBy = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const r of live) {
      const b = releaseBehavior(r.config)
      const vals = (v: string): YN[] => (v === 'BOTH' ? ['Y', 'N'] : [v as YN])
      for (const gc of vals(b.requiresArPosting))
        for (const rt of vals(b.requiresRealtimeClearing))
          for (const ma of vals(b.requiresMandateAuthorization))
            for (const bc of vals(b.requiresBankConfirmation)) {
              const k = key(manifestAccountType(r.accountType), gc, rt, ma, bc)
              map.set(k, [...(map.get(k) ?? []), r.market])
            }
    }
    return map
  }, [live])

  const have = useMemo(() => new Set(manifest?.combinations.map(capKey) ?? []), [manifest])

  const drafts = manifest
    ? markets.flatMap((m) =>
        m.profiles
          .map((p) => ({ m, p, missing: missingCombinations(p.accountType, p.dimensions, manifest) }))
          .filter((x) => x.missing.length > 0),
      )
    : []

  if (connected.length === 0) {
    return (
      <main className="page">
        <header className="section-head">
          <div>
            <h1>Build</h1>
            <p className="section-lede">Every environment is simulated, so there is no deployed build to read a manifest from.</p>
          </div>
        </header>
      </main>
    )
  }

  return (
    <main className="page">
      <header className="section-head">
        <div>
          <h1>Build</h1>
          <p className="section-lede">
            What the deployed build in {ENV_LABELS[env]} can run, read from its Market Onboarding API: every setting of
            the four behaviors per account type, with the live profiles on each. A release that needs a missing cell
            stops at its check, needing a build. A pre-check only: the release's check is the full one.
          </p>
        </div>
        <div className="section-stats">
          {connected.length > 1 && (
            <div className="seg" role="tablist" aria-label="Environment">
              {connected.map((e) => (
                <button key={e.env} role="tab" aria-selected={env === e.env} className={env === e.env ? 'on' : ''} onClick={() => setEnv(e.env)}>
                  {ENV_LABELS[e.env]}
                </button>
              ))}
            </div>
          )}
          {manifest && (
            <span className="pill live">
              <i className="dot" />
              build {manifest.buildVersion === 'unspecified' ? 'version not set' : manifest.buildVersion} · {manifest.combinations.length} of{' '}
              {ACCOUNT_TYPE_ORDER.length * 16}
            </span>
          )}
        </div>
      </header>

      {error && <div className="error-note" role="alert">{error}</div>}

      {manifest && (
        <section className="card cmx">
          <div className="cmx-grid">
            <div />
            {GROUPS.map(([gc, rt]) => (
              <div key={gc + rt} className="cmx-group">
                Good-faith {gc} · Realtime {rt}
              </div>
            ))}
            <div />
            {GROUPS.flatMap(([gc, rt]) =>
              CELLS.map(([ma, bc]) => (
                <div key={gc + rt + ma + bc} className="cmx-head">
                  MA {ma}
                  <br />
                  BC {bc}
                </div>
              )),
            )}
            {ACCOUNT_TYPE_ORDER.map((type: AccountType) => (
              <Row key={type} type={type} have={have} usedBy={usedBy} />
            ))}
          </div>
          <footer className="cmx-key">
            <span><i className="k in" />In the build</span>
            <span><i className="k used" />Used by a live profile</span>
            <span><i className="k gap" />Missing: needs a build</span>
            <span className="muted">
              MA {catalog?.behaviors.find((b) => b.key === 'requiresMandateAuthorization')?.label.toLowerCase()} · BC{' '}
              {catalog?.behaviors.find((b) => b.key === 'requiresBankConfirmation')?.label.toLowerCase()}
            </span>
          </footer>
        </section>
      )}

      {manifest && (
        <section className="card cmx-drafts">
          <h2>Drafts this build can't run</h2>
          {drafts.length === 0 ? (
            <p className="muted">Every profile's draft runs on this build.</p>
          ) : (
            <ul>
              {drafts.map(({ m, p, missing }) => (
                <li key={m.market.code + p.accountType}>
                  <Link to={`/markets/${m.market.code}`}>
                    {m.market.name} · {ACCOUNT_TYPE_LABELS[p.accountType]}
                  </Link>
                  <span className="muted">
                    {' '}
                    needs {missing.length} missing setting{missing.length > 1 ? 's' : ''}:{' '}
                    {missing
                      .map((c) => `GC ${c.requiresArPosting} RT ${c.requiresRealtimeClearing} MA ${c.requiresMandateAuthorization} BC ${c.requiresBankConfirmation}`)
                      .join('; ')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  )
}

function Row({ type, have, usedBy }: { type: AccountType; have: Set<string>; usedBy: Map<string, string[]> }) {
  const t = manifestAccountType(type)
  return (
    <>
      <div className="cmx-row">{ACCOUNT_TYPE_LABELS[type]}</div>
      {GROUPS.flatMap(([gc, rt]) =>
        CELLS.map(([ma, bc]) => {
          const k = key(t, gc, rt, ma, bc)
          const inBuild = have.has(k)
          const users = [...new Set(usedBy.get(k) ?? [])]
          return (
            <div
              key={k}
              className={`cmx-cell ${inBuild ? '' : 'gap'} ${users.length ? 'used' : ''}`}
              title={`${ACCOUNT_TYPE_LABELS[type]} · good-faith ${gc} · realtime ${rt} · mandate ${ma} · bank confirmation ${bc}${inBuild ? '' : ' · not in this build'}`}
            >
              {users.length > 0 && (
                <>
                  <span className="n">{users.length}</span>
                  <span className="who">{users.slice(0, 3).join(' ')}</span>
                </>
              )}
            </div>
          )
        }),
      )}
    </>
  )
}
