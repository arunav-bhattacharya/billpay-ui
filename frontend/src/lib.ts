import type {
  AccountType,
  ApiCategory,
  Behavior,
  BehaviorKey,
  BehaviorMeta,
  BehaviorValue,
  Capabilities,
  Capability,
  EnvMarketDocument,
  EnvStage,
  MarketDocument,
  OperationsSettings,
  ReleaseStatus,
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
  requiresBankConfirmation: 'BC',
}

/** Segment labels for the tri-state control. */
export const BEHAVIOR_VALUE_LABELS: Record<BehaviorValue, string> = {
  Y: 'Y',
  N: 'N',
  BOTH: 'Both',
}

/** What each release status means, as a person reads it. */
export const RELEASE_STATUS_LABELS: Record<ReleaseStatus, string> = {
  REQUESTED: 'Requested',
  RUNNING: 'Running',
  WAITING_FOR_SIGN_OFF: 'Waiting for sign-off',
  ACTIVE: 'Active',
  FAILED: 'Failed',
  ROLLED_BACK: 'Rolled back',
  SUPERSEDED: 'Superseded',
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

/** Whether an account type can take a behavior at all; any other holds it at N (catalog `accountTypes`). */
export function behaviorAppliesTo(meta: BehaviorMeta, accountType: AccountType): boolean {
  return meta.accountTypes.includes(accountType)
}

/** The single write path for a behavior, so every edit surface sets them the same way. */
export function setBehavior(behavior: Behavior, key: BehaviorKey, value: BehaviorValue): Behavior {
  return { ...behavior, [key]: value }
}

/**
 * A profile's behaviors as one account type can hold them: a behavior that type can't take is N. The wizard sets one
 * behavior set for every account type it creates, so this is where Corporate's bank confirmation becomes N.
 */
export function behaviorFor(behavior: Behavior, accountType: AccountType, metas: BehaviorMeta[]): Behavior {
  const next = { ...behavior }
  for (const meta of metas) if (!behaviorAppliesTo(meta, accountType)) next[meta.key] = 'N'
  return next
}

/** "e1's build 1.4.2", or just "e1's build" when the build doesn't say which it is. */
export function buildLabel(capabilities: Capabilities): string {
  const v = capabilities.buildVersion
  return v && v !== 'unspecified' && v !== 'dev' ? `e1's build ${v}` : "e1's build"
}

/** The manifest names the third account type as billpay-core does. */
export function manifestAccountType(type: AccountType): string {
  return type === 'BUSINESS_TRAVEL_ACCOUNT' ? 'BUSINESS_TRAVEL' : type
}

/**
 * Which Y/N settings a profile needs that the deployed build's manifest lacks. The manifest lists, per account type,
 * the settings a release could go live with; BOTH needs its Y and its N. A pre-check only: step 1 of the onboarding
 * workflow is the full check.
 */
export function missingCombinations(
  accountType: AccountType,
  behavior: Behavior,
  capabilities: Capabilities,
): Capability[] {
  const values = (v: BehaviorValue): ('Y' | 'N')[] => (v === 'BOTH' ? ['Y', 'N'] : [v])
  const type = manifestAccountType(accountType)
  const wanted: Capability[] = []
  for (const ar of values(behavior.requiresArPosting))
    for (const rt of values(behavior.requiresRealtimeClearing))
      for (const ma of values(behavior.requiresMandateAuthorization))
        for (const bc of values(behavior.requiresBankConfirmation))
          wanted.push({
            accountType: type,
            requiresArPosting: ar,
            requiresRealtimeClearing: rt,
            requiresMandateAuthorization: ma,
            requiresBankConfirmation: bc,
          })
  const key = (c: Capability) =>
    [c.accountType, c.requiresArPosting, c.requiresRealtimeClearing, c.requiresMandateAuthorization, c.requiresBankConfirmation].join('|')
  const have = new Set(capabilities.combinations.map(key))
  return wanted.filter((c) => !have.has(key(c)))
}

// ---- ISO-8601 durations, as the release JSON carries them ----

export type DurationUnit = 'S' | 'M' | 'H' | 'D'

export const DURATION_UNIT_LABELS: Record<DurationUnit, string> = {
  S: 'seconds',
  M: 'minutes',
  H: 'hours',
  D: 'days',
}

/**
 * A duration as one number and unit: `PT90M` is 90 minutes, `P2D` 2 days. A duration mixing units reads in the
 * smallest; null for an empty or unreadable value.
 */
export function parseDuration(iso?: string | null): { amount: number; unit: DurationUnit } | null {
  if (!iso) return null
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso.trim().toUpperCase())
  if (!m || iso.trim().toUpperCase() === 'P' || iso.trim().toUpperCase() === 'PT') return null
  const [d, h, min, sec] = m.slice(1).map((x) => (x ? Number(x) : 0))
  const seconds = ((d * 24 + h) * 60 + min) * 60 + sec
  if (sec > 0 || seconds === 0) return { amount: seconds, unit: 'S' }
  if (seconds % 86400 === 0 && d > 0 && h === 0 && min === 0) return { amount: seconds / 86400, unit: 'D' }
  if (seconds % 3600 === 0) return { amount: seconds / 3600, unit: 'H' }
  return { amount: seconds / 60, unit: 'M' }
}

/** One number and unit as the ISO duration billpay-core reads. */
export function formatDuration(amount: number, unit: DurationUnit): string {
  if (unit === 'D') return `P${amount}D`
  return `PT${amount}${unit}`
}

/** "1 hour", "30 minutes": an ISO duration for a person. */
export function describeDuration(iso?: string | null): string {
  const d = parseDuration(iso)
  if (!d) return iso ?? ''
  const word = DURATION_UNIT_LABELS[d.unit]
  return `${d.amount} ${d.amount === 1 ? word.slice(0, -1) : word}`
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

/* ---------- read-only summary, for the market page and the review step ---------- */

/** The Operations settings as short lines, leaving out what is unset. */
export function operationsSummary(ops: OperationsSettings, accountType?: AccountType): [string, string][] {
  const rows: [string, string][] = []
  if (ops.timeZone) rows.push(['Time zone', ops.timeZone])
  rows.push(['Execution time', ops.executionTime ?? '00:00 (default)'])
  rows.push(['Cancellation window', ops.cancellationWindow ? describeDuration(ops.cancellationWindow) : '1 hour (default)'])
  if (ops.executionCutoff) rows.push(['Execution cutoff', describeDuration(ops.executionCutoff)])
  if (ops.executionFloorTps != null) rows.push(['Execution floor', `${ops.executionFloorTps} TPS`])
  if (accountType === 'CORPORATE' || accountType === undefined) {
    if (ops.allocationFetchBefore) rows.push(['Fetch allocations', `${describeDuration(ops.allocationFetchBefore)} before`])
    if (ops.allocationAlertAfter) rows.push(['Allocation alert', `after ${describeDuration(ops.allocationAlertAfter)}`])
  }
  rows.push([
    'Representment',
    ops.representment
      ? `${ops.representment.representableReasons.join(', ') || 'no reasons'} · up to ${ops.representment.maxRepresentments} · after ${ops.representment.delayDays} days`
      : 'none',
  ])
  rows.push(['Raven', ops.ravenStatuses ? ops.ravenStatuses.join(', ') || 'none' : 'default five'])
  if (ops.bankConfirmation?.confirmationWindow) rows.push(['Bank confirmation', describeDuration(ops.bankConfirmation.confirmationWindow)])
  if (ops.cardAuthentication?.provider) {
    rows.push(['Card provider', `${ops.cardAuthentication.provider}${ops.cardAuthentication.authenticationWindow ? ` · ${describeDuration(ops.cardAuthentication.authenticationWindow)}` : ''}`])
  }
  if (ops.ruleSettings?.maxPaymentAmount) rows.push(['Largest payment', ops.ruleSettings.maxPaymentAmount])
  if (ops.ruleSettings?.acceptedInstrumentTypes?.length) rows.push(['Instrument types', ops.ruleSettings.acceptedInstrumentTypes.join(', ')])
  rows.push(['MR Points', ops.payWithMrPoints ? 'offered' : 'off'])
  if (ops.testAccounts?.length) rows.push(['Test accounts', ops.testAccounts.join(', ')])
  return rows
}
