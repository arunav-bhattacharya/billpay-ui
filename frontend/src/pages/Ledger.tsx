import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../AppContext'
import { ApiDetailBody, ApiIdentity, Arrow, ErrorNote, Flag, StatusSeal } from '../components'
import {
  ACCOUNT_TYPE_LABELS,
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  ENV_LABELS,
  ENV_ORDER,
  REGION_NAMES,
  REGION_ORDER,
} from '../lib'
import type { EnvStage, MarketDocument } from '../types'
import { WorldMap } from './WorldMap'

const VIEW_CAPTIONS: Record<'grid' | 'map' | 'apis', { label: string; text: string }> = {
  grid: {
    label: 'Grid View',
    text: 'List of all onboarded markets.',
  },
  map: {
    label: 'World View',
    text: 'Same story on the world map.',
  },
  apis: {
    label: 'API View',
    text: 'Mapping of APIs to the onboarded markets.',
  },
}

type LedgerView = 'grid' | 'map' | 'apis'

/** The market ledger: stats plus the grid, map or API directory. */
export function Ledger() {
  const { markets, loading, loadError, catalog } = useApp()
  const navigate = useNavigate()
  // The view lives in the URL so coming back from a market page lands on the
  // one the user left, and the back button steps through it.
  const [params, setParams] = useSearchParams()
  const raw = params.get('view')
  const view: LedgerView = raw === 'map' || raw === 'apis' ? raw : 'grid'

  function setView(next: LedgerView) {
    setParams(next === 'grid' ? {} : { view: next }, { replace: true })
  }

  // The hero speaks in plain terms: e3 is live, anything earlier is still in flight.
  const activeMarkets = markets.filter((m) => m.status === 'E3')
  const inProgressMarkets = markets.filter((m) => m.status !== 'E3')
  const availableMarkets = (catalog?.markets ?? []).filter(
    (cm) => !markets.some((m) => m.market.code === cm.code),
  )
  const regions = REGION_ORDER.filter((r) => markets.some((m) => m.market.region === r))

  function openOnboarding(presetMarket: string | null) {
    navigate(presetMarket ? `/onboard/${presetMarket}` : '/onboard')
  }

  return (
    <main className="page">
      <section className="hero">
        <div className="hero-left">
          <h1>Markets</h1>
          <StatusOverview
            active={activeMarkets.map((m) => ({ code: m.market.code, name: m.market.name }))}
            inProgress={inProgressMarkets.map((m) => ({
              code: m.market.code,
              name: m.market.name,
            }))}
            pending={availableMarkets.map((m) => ({ code: m.code, name: m.name }))}
          />
        </div>
        <div className="hero-right">
          <div className="view-toggle" role="group" aria-label="Dashboard view">
            <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>
              Grid
            </button>
            <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>
              Map
            </button>
            <button className={view === 'apis' ? 'on' : ''} onClick={() => setView('apis')}>
              APIs
            </button>
          </div>
          <button className="btn primary lg" onClick={() => openOnboarding(null)}>
            Onboard
          </button>
        </div>
        <p className="view-caption" aria-live="polite">
          <strong>{VIEW_CAPTIONS[view].label}</strong>{VIEW_CAPTIONS[view].text}
        </p>
      </section>

      <ErrorNote message={loadError} />

      {view === 'apis' ? (
        <ApiDirectory />
      ) : view === 'map' ? (
        <WorldMap
          onSelect={(code) => navigate(`/markets/${code}`)}
          onOnboard={(code) => openOnboarding(code)}
        />
      ) : loading ? (
        <p className="muted">Loading markets…</p>
      ) : markets.length === 0 ? (
        <div className="empty-state">
          <h2>No markets yet</h2>
          <p>Onboard the first market in Billpay</p>
          <button className="btn primary" onClick={() => openOnboarding(null)}>
            Onboard
          </button>
        </div>
      ) : (
        regions.map((region) => {
          const regionMarkets = markets.filter((m) => m.market.region === region)
          return (
            <section key={region} className="region-section">
              <div className={`region-head region-${region.toLowerCase()}`}>
                <h2>
                  <b>{region}</b>
                  {REGION_NAMES[region] ? `: ${REGION_NAMES[region]}` : ''}
                </h2>
                <span className="region-stat">
                  <span className="rs-seg rs-act">
                    Active: {regionMarkets.filter((m) => m.status === 'E3').length}
                  </span>
                </span>
              </div>
              <div className="market-grid">
                {regionMarkets.map((m) => (
                  <MarketCard key={m.market.code} market={m} />
                ))}
              </div>
            </section>
          )
        })
      )}
    </main>
  )
}

interface MarketRef {
  code: string
  name: string
}

/** Circular progress over the Amex market list. The hero rolls the three
 *  environments up into a plainer story than the per-market seals do:
 *  e3 is active, e1/e2 are in progress, everything else is pending.
 *  Hovering a legend row reveals which countries are in that state. */
function StatusOverview({
  active,
  inProgress,
  pending,
}: {
  active: MarketRef[]
  inProgress: MarketRef[]
  pending: MarketRef[]
}) {
  // Hovering previews a bucket's markets; clicking pins the list so it stays
  // put while the cursor moves away to read it.
  const [pinned, setPinned] = useState<string | null>(null)
  const total = active.length + inProgress.length + pending.length || 1
  const R = 38
  const C = 2 * Math.PI * R
  // Pending is the unfilled track rather than a fourth colour: what is left to
  // onboard is exactly the part of the ring not yet drawn, which is what makes
  // this read as progress instead of a pie chart.
  const segments = [
    { n: active.length, cls: 'seg-active' },
    { n: inProgress.length, cls: 'seg-progress' },
  ].filter((s) => s.n > 0)

  // A round cap adds half a stroke at each end, so a drawn arc measures
  // STROKE longer than its dash. Take that back, plus a hairline of daylight
  // between neighbours, and clamp so a single market still shows as a dot.
  const STROKE = 7
  const GAP = segments.length > 1 ? 4 : 0

  let acc = 0
  const arcs = segments.map((s) => {
    const share = (s.n / total) * C
    const arc = {
      cls: s.cls,
      dasharray: `${Math.max(share - STROKE - GAP, 0.01)} ${C}`,
      dashoffset: -(acc + STROKE / 2),
    }
    acc += share
    return arc
  })

  const rows: { dot: string; count: number; label: string; list: MarketRef[] }[] = [
    { dot: 'ldot-active', count: active.length, label: 'Active', list: active },
    { dot: 'ldot-progress', count: inProgress.length, label: 'In progress', list: inProgress },
    { dot: 'ldot-off', count: pending.length, label: 'Pending', list: pending },
  ]

  return (
    <div
      className="status-overview"
      aria-label={`${active.length} active, ${inProgress.length} in progress, ${pending.length} pending`}
    >
      <svg viewBox="0 0 100 100" className="donut" aria-hidden="true">
        <circle className="donut-track" cx="50" cy="50" r={R} />
        {/* Starts at twelve o'clock and fills clockwise, the way a progress
            ring is read. */}
        <g transform="rotate(-90 50 50)">
          {arcs.map((a, i) => (
            <circle
              key={i}
              className={`donut-seg ${a.cls}`}
              cx="50"
              cy="50"
              r={R}
              strokeDasharray={a.dasharray}
              strokeDashoffset={a.dashoffset}
            />
          ))}
        </g>
        <text x="50" y="49" className="donut-num">
          {active.length}
        </text>
        <text x="50" y="64" className="donut-sub">
          active
        </text>
      </svg>
      <div className="status-legend">
        {rows.map((r) => (
          <span
            key={r.label}
            className={`legend-row ${pinned === r.label ? 'pinned' : ''}`}
            tabIndex={0}
            role="button"
            aria-pressed={pinned === r.label}
            onClick={() => setPinned(pinned === r.label ? null : r.label)}
            /* Moving onto another status drops the pin: two lists open at once
               would overlap, and the one under the cursor is the one wanted. */
            onMouseEnter={() => setPinned((p) => (p === r.label ? p : null))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setPinned(pinned === r.label ? null : r.label)
              }
            }}
          >
            <i className={`ldot ${r.dot}`} aria-hidden="true" />
            <b>{r.count}</b> {r.label}
            {r.list.length > 0 && (
              <span className="legend-pop" role="tooltip">
                {r.list.map((m) => (
                  <span key={m.code} className="legend-pop-row">
                    <Flag code={m.code} size={15} /> {m.name}
                  </span>
                ))}
              </span>
            )}
          </span>
        ))}
      </div>
    </div>
  )
}

function MarketCard({ market }: { market: MarketDocument }) {
  return (
    <Link
      className={`market-card st-${market.status.toLowerCase()} region-${market.market.region.toLowerCase()}`}
      to={`/markets/${market.market.code}`}
      aria-label={`${market.market.name} market details`}
    >
      <div className="market-card-top">
        <Flag code={market.market.code} size={22} />
        <div className="mc-id">
          <h3>{market.market.name}</h3>
          <span className="mono-tag">
            {market.market.code} · {market.market.currency}
          </span>
        </div>
        <StatusSeal status={market.status} small />
      </div>

      {/* Each account type carries its own behavior — shown per profile. */}
      <div className="profile-rows">
        {market.profiles.map((p) => (
          <div key={p.accountType} className="profile-row">
            <i className={`dot dot-${p.status.toLowerCase()}`} aria-hidden="true" />
            <span className="profile-row-name">{ACCOUNT_TYPE_LABELS[p.accountType]}</span>
          </div>
        ))}
      </div>

      {/* Nothing at rest; hovering reveals the arrow to the market's page. */}
      <Arrow className="card-arrow" />
    </Link>
  )
}

/** API-centric view: every catalog API and the markets onboarded to it. */
function ApiDirectory() {
  const { catalog, markets } = useApp()
  // Same expand-for-details affordance the onboarding wizard offers.
  const [openApi, setOpenApi] = useState<string | null>(null)
  if (!catalog) return <p className="muted">Loading APIs…</p>

  return (
    <div className="api-directory">
      {CATEGORY_ORDER.map((cat) => {
        const apis = catalog.apis.filter((a) => a.category === cat)
        if (apis.length === 0) return null
        return (
          <section key={cat} className="api-dir-category">
            <h4 className={`api-cat-head cat-${cat.toLowerCase()}`}>{CATEGORY_LABELS[cat]}</h4>
            <div className="api-dir-rows">
              {apis.map((api) => {
                const users = markets
                  .map((m) => {
                    const profiles = m.profiles.filter((p) => p.apis.includes(api.name))
                    if (profiles.length === 0) return null
                    // The furthest environment this API has reached in this market.
                    const env = profiles
                      .map((p) => p.status)
                      .reduce((a, b) => (ENV_ORDER.indexOf(b) > ENV_ORDER.indexOf(a) ? b : a))
                    return { m, env }
                  })
                  .filter((x): x is { m: MarketDocument; env: EnvStage } => x !== null)
                  // group by region (AMER → EMEA → APAC), then by code
                  .sort((a, b) => {
                    const r =
                      REGION_ORDER.indexOf(a.m.market.region) -
                      REGION_ORDER.indexOf(b.m.market.region)
                    return r !== 0 ? r : a.m.market.code.localeCompare(b.m.market.code)
                  })
                const open = openApi === api.name
                return (
                  <div
                    key={api.name}
                    className={`api-dir-row cat-${cat.toLowerCase()} ${open ? 'open' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-expanded={open}
                    aria-label={`${api.name} details`}
                    onClick={() => setOpenApi(open ? null : api.name)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setOpenApi(open ? null : api.name)
                      }
                    }}
                  >
                    {/* No verb pill here: this view is about which markets
                        take an API, and the method is already spelled out in
                        the endpoint line inside the expanded detail. */}
                    <div className="api-dir-head">
                      <ApiIdentity spec={api} />
                      <span className="api-dir-count">
                        {users.length} {users.length === 1 ? 'market' : 'markets'}
                      </span>
                      <span className="api-expand" aria-hidden="true">
                        <span className={`chevron ${open ? 'up' : ''}`} />
                      </span>
                    </div>
                    <p className="api-dir-summary">{api.summary}</p>
                    {users.length > 0 ? (
                      <div className="api-dir-markets">
                        {users.map(({ m, env }) => (
                          <span
                            key={m.market.code}
                            className={`api-mkt-chip region-${m.market.region.toLowerCase()} ${env === 'E3' ? 'active' : 'draft'}`}
                            title={`${m.market.name} (${m.market.region}) — ${ENV_LABELS[env]}`}
                          >
                            <i className={`dot dot-${env.toLowerCase()}`} aria-hidden="true" />
                            <Flag code={m.market.code} size={15} />
                            {m.market.code}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="api-dir-empty">No markets yet.</p>
                    )}
                    {open && <ApiDetailBody spec={api} />}
                  </div>
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
