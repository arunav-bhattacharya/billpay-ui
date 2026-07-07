import { useMemo, useRef, useState } from 'react'
import { geoNaturalEarth1, geoPath } from 'd3-geo'
import * as topojson from 'topojson-client'
import type { Topology, GeometryCollection } from 'topojson-specification'
import type { FeatureCollection, Geometry } from 'geojson'
import worldData from 'world-atlas/countries-110m.json'
import { useApp } from '../AppContext'
import { Flag, StatusSeal } from '../components'
import { ACCOUNT_TYPE_LABELS, DIMENSION_SHORT, yn } from '../lib'
import { DIMENSION_KEYS } from '../types'
import type { CuratedMarket, MarketDocument } from '../types'

/** Marker anchor (lon/lat) and ISO-3166 numeric id per Amex market. */
const MARKET_GEO: Record<string, { lon: number; lat: number; iso: string }> = {
  US: { lon: -98.5, lat: 39.5, iso: '840' },
  CA: { lon: -106, lat: 56, iso: '124' },
  MX: { lon: -102, lat: 23.6, iso: '484' },
  GB: { lon: -1.5, lat: 52.5, iso: '826' },
  DE: { lon: 10.4, lat: 51.2, iso: '276' },
  FR: { lon: 2.2, lat: 46.6, iso: '250' },
  IT: { lon: 12.5, lat: 42.8, iso: '380' },
  ES: { lon: -3.7, lat: 40.3, iso: '724' },
  NL: { lon: 5.3, lat: 52.2, iso: '528' },
  SE: { lon: 15, lat: 62, iso: '752' },
  JP: { lon: 138, lat: 36.5, iso: '392' },
  AU: { lon: 134, lat: -25, iso: '036' },
  SG: { lon: 103.85, lat: 1.35, iso: '702' },
  HK: { lon: 114.15, lat: 22.3, iso: '344' },
  IN: { lon: 78.9, lat: 21, iso: '356' },
}

const W = 960
const H = 500

interface Hover {
  x: number
  y: number
  curated: CuratedMarket
  doc: MarketDocument | null
}

export function WorldMap({
  onSelect,
  onOnboard,
}: {
  onSelect: (code: string) => void
  onOnboard: (code: string) => void
}) {
  const { catalog, markets } = useApp()
  const wrapRef = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<Hover | null>(null)

  const { countryPaths, spherePath, projection } = useMemo(() => {
    const world = worldData as unknown as Topology
    const fc = topojson.feature(
      world,
      world.objects.countries as GeometryCollection,
    ) as unknown as FeatureCollection<Geometry>
    const proj = geoNaturalEarth1().fitExtent(
      [
        [6, 6],
        [W - 6, H - 6],
      ],
      { type: 'Sphere' } as never,
    )
    const path = geoPath(proj)
    return {
      countryPaths: fc.features.map((f) => ({
        id: String(f.id ?? ''),
        d: path(f) ?? '',
      })),
      spherePath: path({ type: 'Sphere' } as never) ?? '',
      projection: proj,
    }
  }, [])

  const byCode = useMemo(() => new Map(markets.map((m) => [m.code, m])), [markets])
  const isoToCode = useMemo(
    () => new Map(Object.entries(MARKET_GEO).map(([code, g]) => [g.iso, code])),
    [],
  )

  function countryClass(isoId: string): string {
    const code = isoToCode.get(isoId)
    if (!code) return 'country'
    const doc = byCode.get(code)
    if (!doc) return 'country country-available'
    return doc.status === 'ACTIVE' ? 'country country-active' : 'country country-draft'
  }

  function moveTooltip(e: React.MouseEvent, curated: CuratedMarket) {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    setHover({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      curated,
      doc: byCode.get(curated.code) ?? null,
    })
  }

  return (
    <div className="map-panel">
      <div className="map-wrap" ref={wrapRef}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="map-svg"
          role="img"
          aria-label="World map of Billpay markets"
        >
          <path d={spherePath} className="ocean" />
          {countryPaths.map((c, i) => (
            <path key={`${c.id}-${i}`} d={c.d} className={countryClass(c.id)} />
          ))}

          {(catalog?.markets ?? []).map((cm) => {
            const geo = MARKET_GEO[cm.code]
            if (!geo) return null
            const pos = projection([geo.lon, geo.lat])
            if (!pos) return null
            const doc = byCode.get(cm.code)
            const state = doc ? (doc.status === 'ACTIVE' ? 'active' : 'draft') : 'available'
            return (
              <g
                key={cm.code}
                className={`marker marker-${state}`}
                transform={`translate(${pos[0]}, ${pos[1]})`}
                tabIndex={0}
                role="button"
                aria-label={`${cm.name} — ${doc ? doc.status.toLowerCase() : 'not onboarded'}`}
                onMouseMove={(e) => moveTooltip(e, cm)}
                onMouseLeave={() => setHover(null)}
                onFocus={(e) => {
                  const rect = wrapRef.current?.getBoundingClientRect()
                  const g = (e.currentTarget as SVGGElement).getBoundingClientRect()
                  if (rect)
                    setHover({
                      x: g.left - rect.left + g.width / 2,
                      y: g.top - rect.top,
                      curated: cm,
                      doc: doc ?? null,
                    })
                }}
                onBlur={() => setHover(null)}
                onClick={() => (doc ? onSelect(cm.code) : onOnboard(cm.code))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    doc ? onSelect(cm.code) : onOnboard(cm.code)
                  }
                }}
              >
                {state === 'active' && <circle className="pulse" r="7" />}
                <circle className="marker-dot" r={state === 'available' ? 3.5 : 5} />
              </g>
            )
          })}
        </svg>

        {hover && (
          <div
            className="map-tooltip"
            style={{ left: hover.x, top: hover.y }}
            role="tooltip"
          >
            <div className="map-tip-head">
              <Flag code={hover.curated.code} size={17} />
              <strong>{hover.curated.name}</strong>
              <span className="mono-tag">
                {hover.curated.code} · {hover.curated.currency}
              </span>
            </div>
            {hover.doc ? (
              <>
                <StatusSeal status={hover.doc.status} small />
                <div className="map-tip-profiles">
                  {hover.doc.profiles.map((p) => (
                    <div key={p.accountType} className="map-tip-row">
                      <i
                        className={`dot ${p.status === 'ACTIVE' ? 'dot-active' : 'dot-draft'}`}
                        aria-hidden="true"
                      />
                      <span>{ACCOUNT_TYPE_LABELS[p.accountType]}</span>
                      <span className="mono-tag">
                        {DIMENSION_KEYS.map(
                          (k) => `${DIMENSION_SHORT[k]}:${yn(p.dimensions[k])}`,
                        ).join(' ')}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="map-tip-cta">Click to open details</div>
              </>
            ) : (
              <div className="map-tip-cta">Not onboarded — click to start</div>
            )}
          </div>
        )}
      </div>

      <div className="map-legend" aria-hidden="true">
        <span>
          <i className="legend-dot legend-active" /> Active market
        </span>
        <span>
          <i className="legend-dot legend-draft" /> Draft
        </span>
        <span>
          <i className="legend-dot legend-available" /> Available to onboard
        </span>
      </div>
    </div>
  )
}
