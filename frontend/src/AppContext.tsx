import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { api } from './api'
import type { Catalog, MarketDocument, Role } from './types'

interface AppState {
  role: Role
  setRole: (r: Role) => void
  catalog: Catalog | null
  markets: MarketDocument[]
  refreshMarkets: () => Promise<void>
  loading: boolean
  loadError: string | null
}

const Ctx = createContext<AppState | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  // Admin by default: it is the fuller view, and an operator-only session
  // silently hides the custom-behavior tooling rather than explaining it.
  const [role, setRole] = useState<Role>('ADMIN')
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  // Every mutating request is attributed to whoever the toggle says is acting.
  useEffect(() => api.setRole(role), [role])
  const [markets, setMarkets] = useState<MarketDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  /**
   * Re-reads the market list. Callers surface their own failures for actions
   * they initiated, so a refresh that fails only records the load error — and
   * a refresh that succeeds clears one left over from a previous attempt.
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
    Promise.all([api.catalog(), api.markets()])
      .then(([cat, mkts]) => {
        setCatalog(cat)
        setMarkets(mkts)
        setLoadError(null)
      })
      .catch((e: Error) => setLoadError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const value = useMemo(
    () => ({ role, setRole, catalog, markets, refreshMarkets, loading, loadError }),
    [role, catalog, markets, refreshMarkets, loading, loadError],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp outside AppProvider')
  return ctx
}
