import { createContext, useContext } from 'react'
import type { Capabilities, Catalog, EnvironmentInfo, MarketDocument, Role } from './types'

export interface AppState {
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

export const Ctx = createContext<AppState | null>(null)

export function useApp(): AppState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp outside AppProvider')
  return ctx
}
