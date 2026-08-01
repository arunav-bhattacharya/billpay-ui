import type {
  AccountType,
  ApiCategory,
  Behavior,
  BehaviorKey,
  BehaviorValue,
  EnvMarketDocument,
  EnvStage,
  MarketDocument,
  MarketProfile,
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
  /** Wire value keeps the longer name; only the label was shortened. */
  BUSINESS_TRAVEL_ACCOUNT: 'Business Travel',
}

/**
 * Presentation order for account types. The server already sorts a market's
 * profiles this way; this is for lists the client builds itself, such as the
 * account types picked in the onboarding wizard.
 */
export const ACCOUNT_TYPE_ORDER: AccountType[] = [
  'CONSUMER',
  'CORPORATE',
  'BUSINESS_TRAVEL_ACCOUNT',
]

export function byAccountType(a: AccountType, b: AccountType): number {
  return ACCOUNT_TYPE_ORDER.indexOf(a) - ACCOUNT_TYPE_ORDER.indexOf(b)
}

export const CATEGORY_LABELS: Record<ApiCategory, string> = {
  CORE: 'Core',
  COMPOSITE: 'Composite',
  EVENT_HANDLER: 'Event Handlers',
}

export const CATEGORY_ORDER: ApiCategory[] = ['CORE', 'COMPOSITE', 'EVENT_HANDLER']

export const BEHAVIOR_SHORT: Record<BehaviorKey, string> = {
  requiresArPosting: 'GC',
  requiresRealtimeClearing: 'RT',
  requiresMandateAuthorization: 'MA',
  requiresRepresentableReturn: 'RR',
}

/** Segment labels for the tri-state control. */
export const BEHAVIOR_VALUE_LABELS: Record<BehaviorValue, string> = {
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

/** What each environment is for, spelled out — used by the readiness columns. */
export const ENV_NAMES: Record<EnvStage, string> = {
  E1: 'Development',
  E2: 'Testing',
  E3: 'Production',
}

/** The next environment up, or null once a profile is fully live in e3. */
export function nextEnv(env: EnvStage): EnvStage | null {
  return ENV_ORDER[ENV_ORDER.indexOf(env) + 1] ?? null
}

/**
 * Whether a profile has been signed off in the environment it currently
 * occupies — the server's condition for letting it be promoted out, mirrored
 * here so the button can say no before the request does.
 */
export function isSignedOff(profile: MarketProfile): boolean {
  return profile.verifiedIn === profile.status
}

/** True once a profile at `status` has been promoted as far as `env`. */
export function reaches(status: EnvStage, env: EnvStage): boolean {
  return ENV_ORDER.indexOf(status) >= ENV_ORDER.indexOf(env)
}

/**
 * The market as one environment holds it.
 *
 * Configuration is stored once, but a profile only exists in the environments
 * it has been promoted through — so Production carries a strictly smaller
 * document than Development, and each environment's readiness is its own.
 */
export function projectToEnv(doc: MarketDocument, env: EnvStage): EnvMarketDocument {
  const profiles = doc.profiles.filter((p) => reaches(p.status, env))
  const ids = new Set(profiles.map((p) => p.id))
  return {
    market: doc.market,
    environment: env,
    customDimensionDefs: doc.customDimensionDefs,
    profiles,
    readiness: doc.readiness
      ?.filter((r) => ids.has(r.profileId))
      .map((r) => ({ ...r, environments: r.environments.filter((e) => e.env === env) })),
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

export const REGION_ORDER = ['AMER', 'EMEA', 'APAC']

/**
 * What each region code stands for. The code itself is the key, so a heading
 * can set the abbreviation apart from what it expands to rather than having to
 * split one string back up.
 */
export const REGION_NAMES: Record<string, string> = {
  AMER: 'Americas',
  EMEA: 'Europe, Middle East & Africa',
  APAC: 'Asia Pacific',
}

/**
 * Compact one-character rendering for the dense card and tooltip rows.
 * Also called on custom-behavior values, which are stored as the strings
 * 'true' / 'false' — keep those arms.
 */
export function yn(v: BehaviorValue | boolean | string): string {
  if (typeof v === 'boolean') return v ? 'Y' : 'N'
  if (v === 'true') return 'Y'
  if (v === 'BOTH') return 'B'
  return v === 'Y' ? 'Y' : 'N'
}

/** Representable Return is off the table while clearing is fully realtime. */
export function isBehaviorLocked(key: BehaviorKey, behavior: Behavior): boolean {
  return key === 'requiresRepresentableReturn' && behavior.requiresRealtimeClearing === 'Y'
}

/**
 * The single write path for behavior. Every edit surface goes through this
 * so the Representable Return rule cannot drift between them.
 */
export function setBehavior(
  behavior: Behavior,
  key: BehaviorKey,
  value: BehaviorValue,
): Behavior {
  const next = { ...behavior, [key]: value }
  return next.requiresRealtimeClearing === 'Y'
    ? { ...next, requiresRepresentableReturn: 'N' }
    : next
}

/** Absolute timestamp for revision rows and readiness completion lines. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** "3 days ago" — paired with the absolute time, never replacing it. */
export function formatRelative(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ]
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(-Math.round(seconds / size), unit)
  }
  return 'just now'
}
