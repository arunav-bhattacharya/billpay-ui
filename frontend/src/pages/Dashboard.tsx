import { useState } from 'react'
import { useApp } from '../AppContext'
import { CloneDialog, ErrorNote, Eyebrow, Flag, StatusSeal } from '../components'
import { ACCOUNT_TYPE_LABELS, DIMENSION_SHORT, REGION_NAMES, REGION_ORDER } from '../lib'
import { DIMENSION_KEYS } from '../types'
import type { MarketDocument } from '../types'

export function Dashboard() {
  const { markets, loading, loadError } = useApp()
  const [cloneSource, setCloneSource] = useState<string | null>(null)

  const activeMarkets = markets.filter((m) => m.status === 'ACTIVE')
  const profileCount = markets.reduce((n, m) => n + m.profiles.length, 0)
  const draftProfiles = markets.reduce(
    (n, m) => n + m.profiles.filter((p) => p.status === 'DRAFT').length,
    0,
  )
  const regions = REGION_ORDER.filter((r) => markets.some((m) => m.region === r))

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <Eyebrow>Global footprint</Eyebrow>
          <h1>Market Ledger</h1>
          <p className="lede">
            Every market onboarded onto Billpay, the profiles it runs, and the dimensions each
            profile carries.
          </p>
        </div>
        <a className="btn primary" href="#/onboard">
          Onboard market
        </a>
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

      {loading ? (
        <p className="muted">Loading markets…</p>
      ) : markets.length === 0 ? (
        <div className="empty-state">
          <h2>No markets yet</h2>
          <p>Onboard the first market to open the ledger.</p>
          <a className="btn primary" href="#/onboard">
            Onboard market
          </a>
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
                  <MarketCard key={m.code} market={m} onClone={() => setCloneSource(m.code)} />
                ))}
              </div>
            </section>
          )
        })
      )}

      {cloneSource && (
        <CloneDialog sourceCode={cloneSource} onClose={() => setCloneSource(null)} />
      )}
    </main>
  )
}

function MarketCard({ market, onClone }: { market: MarketDocument; onClone: () => void }) {
  const allTypes = 3
  const canAddType = market.profiles.length < allTypes

  // A dimension counts for the market if any profile requires it.
  const dims = DIMENSION_KEYS.filter((k) => market.profiles.some((p) => p.dimensions[k]))

  return (
    <article className="market-card">
      <div className="market-card-top">
        <Flag code={market.code} size={26} />
        <span className="mono-tag">
          {market.code} · {market.currency}
        </span>
        <StatusSeal status={market.status} small />
      </div>
      <h3>
        <a href={`#/market/${market.code}`}>{market.name}</a>
      </h3>
      <div className="profile-chips">
        {market.profiles.map((p) => (
          <span key={p.accountType} className={`chip chip-${p.status.toLowerCase()}`}>
            <i className="dot" aria-hidden="true" />
            {ACCOUNT_TYPE_LABELS[p.accountType]}
          </span>
        ))}
      </div>
      <div className="dim-marks" aria-label="Dimensions in use">
        {DIMENSION_KEYS.map((k) => (
          <span
            key={k}
            className={`dim-mark ${dims.includes(k) ? 'on' : ''}`}
            title={k}
          >
            {DIMENSION_SHORT[k]}
          </span>
        ))}
      </div>
      <div className="market-card-actions">
        <a className="btn sm ghost" href={`#/market/${market.code}`}>
          Open
        </a>
        <button className="btn sm ghost" onClick={onClone}>
          Clone
        </button>
        {canAddType && (
          <a className="btn sm ghost" href={`#/onboard?market=${market.code}`}>
            + Account type
          </a>
        )}
      </div>
    </article>
  )
}
