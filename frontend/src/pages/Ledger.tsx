import { Fragment, useEffect, useRef, useState } from 'react'
import { useApp } from '../AppContext'
import { ErrorNote, Flag, StatusSeal } from '../components'
import { ACCOUNT_TYPE_LABELS, DIMENSION_SHORT, REGION_NAMES, REGION_ORDER, yn } from '../lib'
import { DIMENSION_KEYS } from '../types'
import type { MarketDocument } from '../types'
import { MarketDetailPanel } from './MarketDetailPanel'
import { OnboardingPanel } from './OnboardingPanel'
import { WorldMap } from './WorldMap'

/** The whole app on one page: stats, onboarding panel, region ledger with inline detail. */
export function Ledger() {
  const { markets, loading, loadError, catalog } = useApp()
  const [onboarding, setOnboarding] = useState<{ presetMarket: string | null } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [view, setView] = useState<'grid' | 'map'>('grid')
  const mapDetailRef = useRef<HTMLDivElement>(null)

  const activeMarkets = markets.filter((m) => m.status === 'ACTIVE')
  const draftMarkets = markets.filter((m) => m.status === 'DRAFT')
  const availableMarkets = (catalog?.markets ?? []).filter(
    (cm) => !markets.some((m) => m.market.code === cm.code),
  )
  const regions = REGION_ORDER.filter((r) => markets.some((m) => m.market.region === r))

  // In map view the edit panel lives below the map — bring it into view on selection.
  useEffect(() => {
    if (view === 'map' && expanded) {
      mapDetailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [view, expanded])

  function openOnboarding(presetMarket: string | null) {
    setOnboarding({ presetMarket })
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Markets</h1>
          <StatusOverview
            active={activeMarkets.map((m) => ({ code: m.market.code, name: m.market.name }))}
            draft={draftMarkets.map((m) => ({ code: m.market.code, name: m.market.name }))}
            available={availableMarkets.map((m) => ({ code: m.code, name: m.name }))}
          />
        </div>
        <div className="head-controls">
          <div className="view-toggle" role="group" aria-label="Markets view">
            <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>
              Grid
            </button>
            <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>
              Map
            </button>
          </div>
          {!onboarding && (
            <button className="btn primary lg" onClick={() => openOnboarding(null)}>
              Onboard market
            </button>
          )}
        </div>
      </div>

      <ErrorNote message={loadError} />

      {onboarding && (
        <OnboardingPanel
          key={onboarding.presetMarket ?? 'new'}
          presetMarket={onboarding.presetMarket}
          onClose={() => setOnboarding(null)}
          onDone={(code) => {
            setOnboarding(null)
            setExpanded(code)
          }}
        />
      )}

      {view === 'map' ? (
        <>
          <WorldMap
            onSelect={(code) => setExpanded(expanded === code ? null : code)}
            onOnboard={(code) => openOnboarding(code)}
          />
          {expanded && markets.some((m) => m.market.code === expanded) && (
            <div className="map-detail" ref={mapDetailRef}>
              <MarketDetailPanel
                market={markets.find((m) => m.market.code === expanded)!}
                onClose={() => setExpanded(null)}
                onAddAccountType={(code) => openOnboarding(code)}
                onCloned={(target) => setExpanded(target)}
              />
            </div>
          )}
        </>
      ) : loading ? (
        <p className="muted">Loading markets…</p>
      ) : markets.length === 0 ? (
        <div className="empty-state">
          <h2>No markets yet</h2>
          <p>Onboard the first market to open the ledger.</p>
          <button className="btn primary" onClick={() => openOnboarding(null)}>
            Onboard market
          </button>
        </div>
      ) : (
        regions.map((region) => {
          const regionMarkets = markets.filter((m) => m.market.region === region)
          return (
            <section key={region} className="region-section">
              <div className="region-head">
                <h2>{REGION_NAMES[region] ?? region}</h2>
                <span className="region-stat">
                  <span className="rs-seg rs-onb">
                    {regionMarkets.length} onboarded
                  </span>
                  <span className="rs-seg rs-act">
                    {regionMarkets.filter((m) => m.status === 'ACTIVE').length} active
                  </span>
                </span>
              </div>
              <div className="market-grid">
                {regionMarkets.map((m) => (
                  <Fragment key={m.market.code}>
                    <MarketCard
                      market={m}
                      expanded={expanded === m.market.code}
                      onToggle={() => setExpanded(expanded === m.market.code ? null : m.market.code)}
                    />
                    {expanded === m.market.code && (
                      <MarketDetailPanel
                        market={m}
                        onClose={() => setExpanded(null)}
                        onAddAccountType={(code) => openOnboarding(code)}
                        onCloned={(target) => setExpanded(target)}
                      />
                    )}
                  </Fragment>
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

/** Circular progress: active / draft / yet-to-onboard shares of the Amex market list.
 *  Hovering a legend row reveals which countries are in that state. */
function StatusOverview({
  active,
  draft,
  available,
}: {
  active: MarketRef[]
  draft: MarketRef[]
  available: MarketRef[]
}) {
  const total = active.length + draft.length + available.length || 1
  const R = 30
  const C = 2 * Math.PI * R
  const segments = [
    { n: active.length, cls: 'seg-active' },
    { n: draft.length, cls: 'seg-draft' },
    { n: available.length, cls: 'seg-off' },
  ].filter((s) => s.n > 0)
  const gap = segments.length > 1 ? 2.5 : 0

  let acc = 0
  const arcs = segments.map((s) => {
    const share = (s.n / total) * C
    const arc = {
      cls: s.cls,
      dasharray: `${Math.max(share - gap, 1)} ${C}`,
      dashoffset: -acc,
    }
    acc += share
    return arc
  })

  const rows: { dot: string; count: number; label: string; list: MarketRef[] }[] = [
    { dot: 'ldot-active', count: active.length, label: 'active', list: active },
    { dot: 'ldot-draft', count: draft.length, label: 'draft', list: draft },
    { dot: 'ldot-off', count: available.length, label: 'to onboard', list: available },
  ]

  return (
    <div
      className="status-overview"
      aria-label={`${active.length} active, ${draft.length} draft, ${available.length} yet to onboard`}
    >
      <svg viewBox="0 0 80 80" className="donut" aria-hidden="true">
        <circle className="donut-track" cx="40" cy="40" r={R} />
        <g transform="rotate(-90 40 40)">
          {arcs.map((a, i) => (
            <circle
              key={i}
              className={`donut-seg ${a.cls}`}
              cx="40"
              cy="40"
              r={R}
              strokeDasharray={a.dasharray}
              strokeDashoffset={a.dashoffset}
            />
          ))}
        </g>
        <text x="40" y="39" className="donut-num">
          {active.length}
        </text>
        <text x="40" y="53" className="donut-sub">
          active
        </text>
      </svg>
      <div className="status-legend">
        {rows.map((r) => (
          <span key={r.label} className="legend-row" tabIndex={0}>
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

function MarketCard({
  market,
  expanded,
  onToggle,
}: {
  market: MarketDocument
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <article
      className={`market-card st-${market.status.toLowerCase()} ${expanded ? 'expanded' : ''}`}
      onClick={onToggle}
      role="button"
      tabIndex={0}
      aria-expanded={expanded}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle()
        }
      }}
    >
      <div className="market-card-top">
        <Flag code={market.market.code} size={24} />
        <span className="mono-tag">
          {market.market.code} · {market.market.currency}
        </span>
        <StatusSeal status={market.status} small />
      </div>
      <h3>{market.market.name}</h3>

      {/* Each account type carries its own dimensions — shown per profile. */}
      <div className="profile-rows">
        {market.profiles.map((p) => (
          <div key={p.accountType} className="profile-row">
            <i className={`dot ${p.status === 'ACTIVE' ? 'dot-active' : 'dot-draft'}`} aria-hidden="true" />
            <span className="profile-row-name">{ACCOUNT_TYPE_LABELS[p.accountType]}</span>
            <span className="profile-row-dims mono-tag">
              {DIMENSION_KEYS.map((k) => `${DIMENSION_SHORT[k]}:${yn(p.dimensions[k])}`).join('  ')}
            </span>
          </div>
        ))}
      </div>

      <div className="market-card-foot">
        <span className="card-open-hint">{expanded ? 'Collapse' : 'Open details'}</span>
      </div>
    </article>
  )
}
