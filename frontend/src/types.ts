export type AccountType = 'CONSUMER' | 'CORPORATE' | 'SMALL_BUSINESS'
export type LifecycleStatus = 'DRAFT' | 'ACTIVE'
export type CustomDimensionType = 'BOOLEAN' | 'ENUM' | 'TEXT'
export type ApiCategory = 'CORE' | 'COMPOSITE' | 'EVENT_HANDLER'
export type Role = 'OPERATOR' | 'ADMIN'

export type DimensionKey =
  | 'requiresArPosting'
  | 'requiresRealtimeClearing'
  | 'requiresMandateAuthorization'

export interface Dimensions {
  requiresArPosting: boolean
  requiresRealtimeClearing: boolean
  requiresMandateAuthorization: boolean
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
  status: LifecycleStatus
  apis: string[]
  dimensions: Dimensions
  customDimensions: Record<string, string>
}

export interface MarketDocument {
  code: string
  name: string
  currency: string
  region: string
  status: LifecycleStatus
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
}

export interface CuratedMarket {
  code: string
  name: string
  currency: string
  region: string
}

export interface DimensionMeta {
  key: DimensionKey
  label: string
  description: string
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
]

export const EMPTY_DIMENSIONS: Dimensions = {
  requiresArPosting: false,
  requiresRealtimeClearing: false,
  requiresMandateAuthorization: false,
}
