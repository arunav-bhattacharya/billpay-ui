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
  const [role, setRole] = useState<Role>('OPERATOR')
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [markets, setMarkets] = useState<MarketDocument[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refreshMarkets = useCallback(async () => {
    setMarkets(await api.markets())
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
