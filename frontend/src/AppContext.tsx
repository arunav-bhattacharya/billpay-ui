import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import type { Capabilities, Catalog, EnvironmentInfo, MarketDocument, Role } from './types'

interface AppState {
  role: Role
  setRole: (r: Role) => void
  catalog: Catalog | null
  environments: EnvironmentInfo[]
  /** e1's deployed build's capability manifest; null while unknown or when e1 is simulated. */
  capabilities: Capabilities | null
  capabilitiesError: string | null
  markets: MarketDocument[]
  refreshMarkets: () => Promise<void>
  loading: boolean
  loadError: string | null
}

const Ctx = createContext<AppState | null>(null)

/** How often the market list is read again while a release is moving through its workflow. */
const POLL_MS = 1500

/** Whether any release is still moving on its own, so the screen should follow it. */
function moving(markets: MarketDocument[]): boolean {
  return markets.some((m) =>
    m.readiness?.some((r) =>
      r.environments.some((e) => {
        const c = e.current
        return !!c && (c.status === 'REQUESTED' || c.status === 'RUNNING' || !!c.lastError)
      }),
    ),
  )
}

export function AppProvider({ children }: { children: ReactNode }) {
  // Admin by default: it is the fuller view, and an operator-only session silently hides the custom-behavior tooling.
  const [role, setRole] = useState<Role>('ADMIN')
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [environments, setEnvironments] = useState<EnvironmentInfo[]>([])
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null)
  const [capabilitiesError, setCapabilitiesError] = useState<string | null>(null)
  // Every request is attributed to whoever the toggle says is acting.
  useEffect(() => api.setRole(role), [role])
  const [markets, setMarkets] = useState<MarketDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  /**
   * Re-reads the market list. Callers surface their own failures for actions they initiated, so a refresh that fails
   * only records the load error, and one that succeeds clears one left over from before.
   */
  const refreshMarkets = useCallback(async () => {
    try {
      setMarkets(await api.markets())
      setLoadError(null)
    } catch (e) {
      setLoadError((e as Error).message)
      throw e
    }
  }, [])

  useEffect(() => {
    Promise.all([api.catalog(), api.markets(), api.environments()])
      .then(([cat, mkts, envs]) => {
        setCatalog(cat)
        setMarkets(mkts)
        setEnvironments(envs)
        setLoadError(null)
        if (envs.find((e) => e.env === 'E1')?.mode === 'CONNECTED') {
          api
            .capabilities('E1')
            .then(setCapabilities)
            .catch((e: Error) => setCapabilitiesError(e.message))
        }
      })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // Follow a release through its workflow: poll while one moves, and stop once nothing does.
  const isMoving = moving(markets)
  useEffect(() => {
    if (!isMoving) return
    const timer = window.setInterval(() => refreshMarkets().catch(() => {}), POLL_MS)
    return () => window.clearInterval(timer)
  }, [isMoving, refreshMarkets])

  const value = useMemo(
    () => ({
      role,
      setRole,
      catalog,
      environments,
      capabilities,
      capabilitiesError,
      markets,
      refreshMarkets,
      loading,
      loadError,
    }),
    [role, catalog, environments, capabilities, capabilitiesError, markets, refreshMarkets, loading, loadError],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp outside AppProvider')
  return ctx
}
