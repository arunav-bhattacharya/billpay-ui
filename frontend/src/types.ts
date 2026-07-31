export type AccountType = 'CONSUMER' | 'CORPORATE' | 'BUSINESS_TRAVEL_ACCOUNT'
/** Deployment environment. Strictly linear — promoted one stage at a time. */
export type EnvStage = 'E1' | 'E2' | 'E3'
export type CustomDimensionType = 'BOOLEAN' | 'ENUM' | 'TEXT'
export type ApiCategory = 'CORE' | 'COMPOSITE' | 'EVENT_HANDLER'
export type Role = 'OPERATOR' | 'ADMIN'

export type DimensionKey =
  | 'requiresArPosting'
  | 'requiresRealtimeClearing'
  | 'requiresMandateAuthorization'
  | 'requiresRepresentableReturn'

/** 'BOTH' = required for some flows but not others. */
export type DimValue = 'Y' | 'N' | 'BOTH'

export interface Dimensions {
  requiresArPosting: DimValue
  requiresRealtimeClearing: DimValue
  requiresMandateAuthorization: DimValue
  /** Only meaningful when realtime clearing is not 'Y'; never 'BOTH'. */
  requiresRepresentableReturn: DimValue
}

export interface CustomDimensionDef {
  key: string
  label: string
  type: CustomDimensionType
  allowedValues: string[]
  description?: string | null
}

export interface MarketProfile {
  id?: string
  accountType: AccountType
  status: EnvStage
  apis: string[]
  dimensions: Dimensions
  customDimensions: Record<string, string>
}

/** Country-specific attributes, grouped under `market` in the document. */
export interface MarketInfo {
  code: string
  name: string
  currency: string
  region: string
}

export interface MarketDocument {
  market: MarketInfo
  status: EnvStage
  customDimensionDefs: CustomDimensionDef[]
  profiles: MarketProfile[]
  createdAt?: string
  updatedAt?: string
}

export interface ApiSpec {
  name: string
  category: ApiCategory
  method: string
  path: string
  summary: string
  description: string
  /** Dimensions this API typically calls for — guidance only, never auto-selected. */
  suggests: DimensionKey[]
  /** Deep link into the One-Data API spec book. */
  specUrl: string
}

export interface CuratedMarket {
  code: string
  name: string
  currency: string
  region: string
  /** Account types this market supports (defaults to all three server-side). */
  allowedAccountTypes: AccountType[]
}

export interface DimensionMeta {
  key: DimensionKey
  label: string
  description: string
  /** False for strictly Y/N dimensions — the control renders two segments. */
  allowsBoth: boolean
}

export interface AccountTypeMeta {
  key: AccountType
  label: string
  description: string
}

export interface Catalog {
  apis: ApiSpec[]
  markets: CuratedMarket[]
  dimensions: DimensionMeta[]
  accountTypes: AccountTypeMeta[]
}

export const DIMENSION_KEYS: DimensionKey[] = [
  'requiresArPosting',
  'requiresRealtimeClearing',
  'requiresMandateAuthorization',
  'requiresRepresentableReturn',
]

export const EMPTY_DIMENSIONS: Dimensions = {
  requiresArPosting: 'N',
  requiresRealtimeClearing: 'N',
  requiresMandateAuthorization: 'N',
  requiresRepresentableReturn: 'N',
}
