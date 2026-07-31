import { useEffect, useMemo, useRef, useState } from 'react'
import { geoGraticule10, geoNaturalEarth1, geoPath } from 'd3-geo'
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
  AR: { lon: -64.2, lat: -34.6, iso: '032' },
  PR: { lon: -66.4, lat: 18.2, iso: '630' },
  GB: { lon: -1.5, lat: 52.5, iso: '826' },
  DE: { lon: 10.4, lat: 51.2, iso: '276' },
  FR: { lon: 2.2, lat: 46.6, iso: '250' },
  IT: { lon: 12.5, lat: 42.8, iso: '380' },
  ES: { lon: -3.7, lat: 40.3, iso: '724' },
  NL: { lon: 5.3, lat: 52.2, iso: '528' },
  BE: { lon: 4.6, lat: 50.6, iso: '056' },
  AT: { lon: 14.1, lat: 47.6, iso: '040' },
  FI: { lon: 26, lat: 64.5, iso: '246' },
  SE: { lon: 15, lat: 62, iso: '752' },
  NO: { lon: 8.8, lat: 61.2, iso: '578' },
  DK: { lon: 9.3, lat: 56.1, iso: '208' },
  PL: { lon: 19.2, lat: 52.1, iso: '616' },
  CZ: { lon: 15.4, lat: 49.8, iso: '203' },
  IN: { lon: 78.9, lat: 21, iso: '356' },
  JP: { lon: 138, lat: 36.5, iso: '392' },
  AU: { lon: 134, lat: -25, iso: '036' },
  NZ: { lon: 172.6, lat: -41.8, iso: '554' },
  SG: { lon: 103.85, lat: 1.35, iso: '702' },
  HK: { lon: 114.15, lat: 22.3, iso: '344' },
  TW: { lon: 120.9, lat: 23.7, iso: '158' },
  TH: { lon: 101, lat: 15.4, iso: '764' },
}

const W = 960
const H = 500
const MIN_K = 1
const MAX_K = 8
/**
 * Map coloring encodes environment reached, then onboarding completeness:
 *  full    — in e3, all supported account types onboarded → solid green
 *  partial — in e3, some account types onboarded          → striped green
 *  e2      — onboarded, furthest profile is in e2         → amber
 *  e1      — onboarded, still entirely in e1              → grey
 *  available — Amex market not onboarded                  → muted grey, clickable
 */
type MarketState = 'full' | 'partial' | 'e2' | 'e1' | 'available'

function stateOf(doc: MarketDocument | undefined, supportedTypes: number): MarketState {
  if (!doc) return 'available'
  if (doc.status === 'E1') return 'e1'
  if (doc.status === 'E2') return 'e2'
  return doc.profiles.length >= supportedTypes ? 'full' : 'partial'
}

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
  const svgRef = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<Hover | null>(null)
  const [t, setT] = useState({ k: 1, x: 0, y: 0 })

  const { countryPaths, spherePath, graticulePath, projection } = useMemo(() => {
    const world = worldData as unknown as Topology
    const fc = topojson.feature(
      world,
      world.objects.countries as GeometryCollection,
    ) as unknown as FeatureCollection<Geometry>
    // France's polygon in world-atlas includes French Guiana (South America);
    // keep only the European polygons so France doesn't light up off Brazil.
    for (const f of fc.features) {
      if (String(f.id) === '250' && f.geometry.type === 'MultiPolygon') {
        f.geometry.coordinates = f.geometry.coordinates.filter(
          (poly) => poly[0][0][0] > -20 && poly[0][0][1] > 20,
        )
      }
    }
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
      graticulePath: path(geoGraticule10()) ?? '',
      projection: proj,
    }
  }, [])

  const byCode = useMemo(() => new Map(markets.map((m) => [m.market.code, m])), [markets])
  const isoToCode = useMemo(
    () => new Map(Object.entries(MARKET_GEO).map(([code, g]) => [g.iso, code])),
    [],
  )
  const curatedByCode = useMemo(
    () => new Map((catalog?.markets ?? []).map((m) => [m.code, m])),
    [catalog],
  )

  /* ---- zoom & pan (pan is clamped so the map never leaves the panel) ---- */

  function clientToView(clientX: number, clientY: number): [number, number] {
    const rect = svgRef.current!.getBoundingClientRect()
    return [((clientX - rect.left) / rect.width) * W, ((clientY - rect.top) / rect.height) * H]
  }

  /** Keep the scaled map covering the viewport: x ∈ [W(1−k), 0], y ∈ [H(1−k), 0]. */
  function clampT(next: { k: number; x: number; y: number }) {
    return {
      k: next.k,
      x: Math.min(0, Math.max(W * (1 - next.k), next.x)),
      y: Math.min(0, Math.max(H * (1 - next.k), next.y)),
    }
  }

  function zoomAt(vx: number, vy: number, factor: number) {
    setT((prev) => {
      const k = Math.min(MAX_K, Math.max(MIN_K, prev.k * factor))
      if (k === prev.k) return prev
      const x = vx - ((vx - prev.x) * k) / prev.k
      const y = vy - ((vy - prev.y) * k) / prev.k
      return clampT({ k, x, y })
    })
  }

  function zoomCenter(factor: number) {
    zoomAt(W / 2, H / 2, factor)
  }

  const drag = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(
    null,
  )
  const suppressClick = useRef(false)

  function onPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    if (t.k === 1) return // nothing to pan at base zoom
    drag.current = { px: e.clientX, py: e.clientY, x: t.x, y: t.y, moved: false }
    svgRef.current?.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!drag.current) return
    const rect = svgRef.current!.getBoundingClientRect()
    const dx = ((e.clientX - drag.current.px) / rect.width) * W
    const dy = ((e.clientY - drag.current.py) / rect.height) * H
    if (Math.abs(e.clientX - drag.current.px) + Math.abs(e.clientY - drag.current.py) > 4) {
      drag.current.moved = true
    }
    setT((prev) => clampT({ k: prev.k, x: drag.current!.x + dx, y: drag.current!.y + dy }))
  }

  function onPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    svgRef.current?.releasePointerCapture(e.pointerId)
    if (drag.current?.moved) suppressClick.current = true
    drag.current = null
  }

  // React registers wheel as passive; attach natively so preventDefault works.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const [vx, vy] = clientToView(e.clientX, e.clientY)
      zoomAt(vx, vy, e.deltaY < 0 ? 1.25 : 0.8)
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [])

  function handleMarketClick(code: string) {
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (byCode.has(code)) onSelect(code)
    else onOnboard(code)
  }

  /* ---- tooltip ---- */

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
          className={`map-svg ${t.k > 1 ? 'zoomed' : ''}`}
          role="img"
          aria-label="World map of Billpay markets"
          ref={svgRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => {
            drag.current = null
          }}
        >
          <defs>
            <radialGradient id="ocean-grad" cx="50%" cy="38%" r="75%">
              <stop offset="0%" stopColor="#0c2d5e" />
              <stop offset="60%" stopColor="#07204a" />
              <stop offset="100%" stopColor="#041638" />
            </radialGradient>
            {/* striped green: partially onboarded markets */}
            <pattern
              id="partial-stripes"
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="#1e5a44" />
              <rect width="3" height="6" fill="#2fae6e" />
            </pattern>
          </defs>

          <g transform={`translate(${t.x}, ${t.y}) scale(${t.k})`}>
            <path d={spherePath} className="ocean" vectorEffect="non-scaling-stroke" />
            <path d={graticulePath} className="graticule" vectorEffect="non-scaling-stroke" />

            {countryPaths.map((c, i) => {
              const code = isoToCode.get(c.id)
              const curated = code ? curatedByCode.get(code) : undefined
              const state = curated
                ? stateOf(byCode.get(curated.code), curated.allowedAccountTypes.length)
                : null
              return (
                <path
                  key={`${c.id}-${i}`}
                  d={c.d}
                  className={`country ${state ? `country-${state} country-market` : ''}`}
                  vectorEffect="non-scaling-stroke"
                  onMouseMove={curated ? (e) => moveTooltip(e, curated) : undefined}
                  onMouseLeave={curated ? () => setHover(null) : undefined}
                  onClick={curated ? () => handleMarketClick(curated.code) : undefined}
                />
              )
            })}

            {(catalog?.markets ?? []).map((cm) => {
              const geo = MARKET_GEO[cm.code]
              if (!geo) return null
              const pos = projection([geo.lon, geo.lat])
              if (!pos) return null
              const state = stateOf(byCode.get(cm.code), cm.allowedAccountTypes.length)
              return (
                <g
                  key={cm.code}
                  className={`marker marker-${state}`}
                  transform={`translate(${pos[0]}, ${pos[1]}) scale(${1 / t.k})`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${cm.name} — ${
                    state === 'available' ? 'pending' : state === 'e1' || state === 'e2' ? `in ${state}` : state
                  }`}
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
                        doc: byCode.get(cm.code) ?? null,
                      })
                  }}
                  onBlur={() => setHover(null)}
                  onClick={() => handleMarketClick(cm.code)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      handleMarketClick(cm.code)
                    }
                  }}
                >
                  {(state === 'full' || state === 'partial') && <circle className="pulse" r="7" />}
                  <circle className="marker-dot" r={state === 'available' ? 3.5 : 5} />
                </g>
              )
            })}
          </g>
        </svg>

        {/* zoom controls */}
        <div className="map-zoom" role="group" aria-label="Map zoom">
          <button onClick={() => zoomCenter(1.5)} aria-label="Zoom in">
            +
          </button>
          <button onClick={() => zoomCenter(1 / 1.5)} aria-label="Zoom out">
            −
          </button>
          <button
            onClick={() => setT({ k: 1, x: 0, y: 0 })}
            aria-label="Reset zoom"
            disabled={t.k === 1}
          >
            ⌂
          </button>
        </div>

        {hover && (
          <div className="map-tooltip" style={{ left: hover.x, top: hover.y }} role="tooltip">
            <div className="map-tip-head">
              <Flag code={hover.curated.code} size={17} />
              <strong>{hover.curated.name}</strong>
              <span className="mono-tag">
                {hover.curated.code} · {hover.curated.currency}
              </span>
            </div>
            {hover.doc ? (
              <>
                <div className="map-tip-status">
                  <StatusSeal status={hover.doc.status} small />
                  <span className="map-tip-completeness">
                    {hover.doc.profiles.length}/{hover.curated.allowedAccountTypes.length} account
                    types
                  </span>
                </div>
                <div className="map-tip-profiles">
                  {hover.doc.profiles.map((p) => (
                    <div key={p.accountType} className="map-tip-row">
                      <i
                        className={`dot dot-${p.status.toLowerCase()}`}
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
                <div className="map-tip-cta">Click the country to open details</div>
              </>
            ) : (
              <div className="map-tip-cta">Pending — click the country to start onboarding</div>
            )}
          </div>
        )}
      </div>

      <div className="map-legend" aria-hidden="true">
        <span>
          <i className="legend-dot legend-full" /> Fully onboarded
        </span>
        <span>
          <i className="legend-dot legend-partial" /> Partially onboarded
        </span>
        <span>
          <i className="legend-dot legend-e2" /> In e2
        </span>
        <span>
          <i className="legend-dot legend-e1" /> In e1
        </span>
        <span>
          <i className="legend-dot legend-available" /> Pending
        </span>
        <span className="map-legend-hint mono-tag">scroll to zoom · drag to pan when zoomed</span>
      </div>
    </div>
  )
}
