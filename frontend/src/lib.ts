import type {
  AccountType,
  ApiCategory,
  DimensionKey,
  Dimensions,
  DimValue,
  EnvStage,
} from './types'

/** ISO market code → flag emoji (client-side only; never persisted). */
export function flagEmoji(code: string): string {
  const cc = code === 'UK' ? 'GB' : code
  return cc
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)))
}

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  CONSUMER: 'Consumer',
  CORPORATE: 'Corporate',
  BUSINESS_TRAVEL_ACCOUNT: 'Business Travel Account',
}

export const CATEGORY_LABELS: Record<ApiCategory, string> = {
  CORE: 'Core',
  COMPOSITE: 'Composite',
  EVENT_HANDLER: 'Event Handlers',
}

export const CATEGORY_ORDER: ApiCategory[] = ['CORE', 'COMPOSITE', 'EVENT_HANDLER']

export const DIMENSION_SHORT: Record<DimensionKey, string> = {
  requiresArPosting: 'AR',
  requiresRealtimeClearing: 'RT',
  requiresMandateAuthorization: 'MA',
  requiresRepresentableReturn: 'RR',
}

/** Segment labels for the tri-state control. */
export const DIM_LABELS: Record<DimValue, string> = {
  Y: 'Y',
  N: 'N',
  BOTH: 'Both',
}

/** Promotion order. Wire values are uppercase; the UI spells them lowercase. */
export const ENV_ORDER: EnvStage[] = ['E1', 'E2', 'E3']

export const ENV_LABELS: Record<EnvStage, string> = {
  E1: 'e1',
  E2: 'e2',
  E3: 'e3',
}

/** The next environment up, or null once a profile is fully live in e3. */
export function nextEnv(env: EnvStage): EnvStage | null {
  return ENV_ORDER[ENV_ORDER.indexOf(env) + 1] ?? null
}

export const REGION_ORDER = ['AMER', 'EMEA', 'APAC']

export const REGION_NAMES: Record<string, string> = {
  AMER: 'AMER: Americas',
  EMEA: 'EMEA: Europe, Middle East & Africa',
  APAC: 'APAC: Asia Pacific',
}

/**
 * Compact one-character rendering for the dense card and tooltip rows.
 * Also called on custom-dimension values, which are stored as the strings
 * 'true' / 'false' — keep those arms.
 */
export function yn(v: DimValue | boolean | string): string {
  if (typeof v === 'boolean') return v ? 'Y' : 'N'
  if (v === 'true') return 'Y'
  if (v === 'BOTH') return 'B'
  return v === 'Y' ? 'Y' : 'N'
}

/** Representable Return is off the table while clearing is fully realtime. */
export function isDimLocked(key: DimensionKey, dims: Dimensions): boolean {
  return key === 'requiresRepresentableReturn' && dims.requiresRealtimeClearing === 'Y'
}

/**
 * The single write path for dimensions. Every edit surface goes through this
 * so the Representable Return rule cannot drift between them.
 */
export function setDimension(dims: Dimensions, key: DimensionKey, value: DimValue): Dimensions {
  const next = { ...dims, [key]: value }
  return next.requiresRealtimeClearing === 'Y'
    ? { ...next, requiresRepresentableReturn: 'N' }
    : next
}

export function chipClass(v: DimValue): string {
  if (v === 'Y') return 'chip-yes'
  if (v === 'BOTH') return 'chip-both'
  return 'chip-off'
}
