import { Fragment, useState } from 'react'
import { useApp } from '../AppContext'
import { ErrorNote, Eyebrow, Flag, StatusSeal } from '../components'
import { ACCOUNT_TYPE_LABELS, DIMENSION_SHORT, REGION_NAMES, REGION_ORDER, yn } from '../lib'
import { DIMENSION_KEYS } from '../types'
import type { MarketDocument } from '../types'
import { MarketDetailPanel } from './MarketDetailPanel'
import { OnboardingPanel } from './OnboardingPanel'

/** The whole app on one page: stats, onboarding panel, region ledger with inline detail. */
export function Ledger() {
  const { markets, loading, loadError } = useApp()
  const [onboarding, setOnboarding] = useState<{ presetMarket: string | null } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const activeMarkets = markets.filter((m) => m.status === 'ACTIVE')
  const profileCount = markets.reduce((n, m) => n + m.profiles.length, 0)
  const draftProfiles = markets.reduce(
    (n, m) => n + m.profiles.filter((p) => p.status === 'DRAFT').length,
    0,
  )
  const regions = REGION_ORDER.filter((r) => markets.some((m) => m.region === r))

  function openOnboarding(presetMarket: string | null) {
    setOnboarding({ presetMarket })
  }

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <Eyebrow>Global footprint</Eyebrow>
          <h1>Market Ledger</h1>
          <p className="lede">
            Every market onboarded onto Billpay, the account-type profiles it runs, and the
            dimensions each profile carries.
          </p>
        </div>
        {!onboarding && (
          <button className="btn primary lg" onClick={() => openOnboarding(null)}>
            Onboard market
          </button>
        )}
      </div>

      <ErrorNote message={loadError} />

      <div className="stat-strip">
        <div className="stat">
          <span className="stat-num">{activeMarkets.length}</span>
          <span className="stat-label">Active markets</span>
        </div>
        <div className="stat">
          <span className="stat-num">{profileCount}</span>
          <span className="stat-label">Account-type profiles</span>
        </div>
        <div className="stat">
          <span className="stat-num">{draftProfiles}</span>
          <span className="stat-label">Draft profiles</span>
        </div>
        <div className="stat">
          <span className="stat-num">{regions.length}</span>
          <span className="stat-label">Regions covered</span>
        </div>
      </div>

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

      {loading ? (
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
          const regionMarkets = markets.filter((m) => m.region === region)
          return (
            <section key={region} className="region-section">
              <div className="region-head">
                <h2>{REGION_NAMES[region] ?? region}</h2>
                <span className="region-meta">
                  {region} · {regionMarkets.length}{' '}
                  {regionMarkets.length === 1 ? 'market' : 'markets'}
                </span>
              </div>
              <div className="market-grid">
                {regionMarkets.map((m) => (
                  <Fragment key={m.code}>
                    <MarketCard
                      market={m}
                      expanded={expanded === m.code}
                      onToggle={() => setExpanded(expanded === m.code ? null : m.code)}
                    />
                    {expanded === m.code && (
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
      className={`market-card ${expanded ? 'expanded' : ''}`}
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
        <Flag code={market.code} size={24} />
        <span className="mono-tag">
          {market.code} · {market.currency}
        </span>
        <StatusSeal status={market.status} small />
      </div>
      <h3>{market.name}</h3>

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
