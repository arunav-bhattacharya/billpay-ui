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
          <div className="title-row">
            <h1>Markets</h1>
            {/* One tick per Amex market: green = active, amber = draft, hollow = available */}
            <div className="market-ticker" aria-label="Market status overview">
              <div className="ticker-row">
                {(catalog?.markets ?? []).map((cm) => {
                  const doc = markets.find((m) => m.market.code === cm.code)
                  const state = doc ? (doc.status === 'ACTIVE' ? 'active' : 'draft') : 'off'
                  return (
                    <i
                      key={cm.code}
                      className={`tick tick-${state}`}
                      title={`${cm.name} — ${doc ? doc.status.toLowerCase() : 'not onboarded'}`}
                    />
                  )
                })}
              </div>
              <div className="ticker-caption">
                <b className="tc-active">{activeMarkets.length} active</b>
                <span className="tc-sep">·</span>
                <b className="tc-draft">{markets.length - activeMarkets.length} draft</b>
                <span className="tc-sep">·</span>
                <span className="tc-off">
                  {(catalog?.markets.length ?? 0) - markets.length} available
                </span>
              </div>
            </div>
          </div>
          <div className="view-toggle" role="group" aria-label="Markets view">
            <button className={view === 'grid' ? 'on' : ''} onClick={() => setView('grid')}>
              Grid
            </button>
            <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>
              Map
            </button>
          </div>
        </div>
        {!onboarding && (
          <button className="btn primary lg" onClick={() => openOnboarding(null)}>
            Onboard market
          </button>
        )}
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
