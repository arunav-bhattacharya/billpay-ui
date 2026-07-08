import type { AccountType, ApiCategory, DimensionKey } from './types'

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
  SMALL_BUSINESS: 'Small Business',
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
}

export const REGION_ORDER = ['AMER', 'EMEA', 'APAC']

export const REGION_NAMES: Record<string, string> = {
  AMER: 'AMER: Americas',
  EMEA: 'EMEA: Europe, Middle East & Africa',
  APAC: 'APAC: Asia Pacific',
}

/** Booleans render as Y / N wherever profiles are shown. */
export function yn(v: boolean | string): string {
  const b = typeof v === 'string' ? v === 'true' : v
  return b ? 'Y' : 'N'
}
