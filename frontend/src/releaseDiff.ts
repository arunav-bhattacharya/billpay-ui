import { describeDuration, parseDuration } from './lib'
import { BEHAVIOR_KEYS } from './types'
import type { Catalog, ReleaseConfig } from './types'

/** One field that differs between the version the target runs and the draft. */
export interface Change {
  group: 'APIs' | 'Behaviors' | 'Operations'
  label: string
  key: string
  before: string | null
  after: string | null
}

/** Operations keys as a person reads them; anything unlisted shows its key. */
const OPERATIONS_LABELS: Record<string, string> = {
  timeZone: 'Time zone',
  executionTime: 'Execution time',
  cancellationWindow: 'Cancellation window',
  executionCutoff: 'Execution cutoff',
  executionFloorTps: 'Execution floor (TPS)',
  allocationFetchBefore: 'Fetch allocations before',
  allocationAlertAfter: 'Allocation alert after',
  ravenStatuses: 'Raven statuses',
  payWithMrPoints: 'Pay with MR Points',
  pendingSweepAfter: 'Pending sweep after',
  testAccounts: 'Test accounts',
  'representment.representableReasons': 'Representable reasons',
  'representment.maxRepresentments': 'Most representments',
  'representment.delayDays': 'Representment delay (days)',
  'bankConfirmation.confirmationWindow': 'Bank confirmation window',
  'bankConfirmation.statusCheckDelay': 'First status call',
  'bankConfirmation.statusCheckInterval': 'Between status calls',
  'bankConfirmation.statusCheckMaxInterval': 'Longest status gap',
  'cardAuthentication.provider': 'Card provider',
  'cardAuthentication.authenticationWindow': 'Authentication window',
  'ruleSettings.maxPaymentAmount': 'Largest payment',
  'ruleSettings.acceptedInstrumentTypes': 'Instrument types',
}

function show(v: unknown): string | null {
  if (v === undefined || v === null) return null
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'none'
  if (typeof v === 'boolean') return v ? 'on' : 'off'
  if (typeof v === 'string' && parseDuration(v) && v.startsWith('P')) return `${describeDuration(v)} (${v})`
  return String(v)
}

/** Every key below the top level, as "parent.child", so a nested block diffs field by field. */
function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flatten(v as Record<string, unknown>, path))
    else out[path] = v
  }
  return out
}

/** The draft against the version the target runs, grouped by what changed, as people talk about it. */
export function diffReleases(before: ReleaseConfig, after: ReleaseConfig, catalog: Catalog | null): Change[] {
  const changes: Change[] = []
  const was = new Set(before.apis ?? [])
  const now = new Set(after.apis ?? [])
  const title = (name: string) => catalog?.apis.find((a) => a.name === name)?.title ?? name
  for (const name of now) if (!was.has(name)) changes.push({ group: 'APIs', label: title(name), key: name, before: 'not taken', after: 'taken' })
  for (const name of was) if (!now.has(name)) changes.push({ group: 'APIs', label: title(name), key: name, before: 'taken', after: 'not taken' })

  for (const key of BEHAVIOR_KEYS) {
    const b = before.behaviors?.[key]
    const a = after.behaviors?.[key]
    const label = catalog?.behaviors.find((m) => m.key === key)?.label ?? key
    if ((b?.value ?? 'N') !== (a?.value ?? 'N')) changes.push({ group: 'Behaviors', label, key, before: b?.value ?? 'N', after: a?.value ?? 'N' })
    const bj = (b?.yesForJourneys ?? []).join(', ')
    const aj = (a?.yesForJourneys ?? []).join(', ')
    if (bj !== aj) changes.push({ group: 'Behaviors', label: `${label}: Y for`, key: `${key}.yesForJourneys`, before: bj || 'none', after: aj || 'none' })
  }

  const rest = (c: ReleaseConfig) => {
    const copy: Record<string, unknown> = { ...c }
    delete copy.apis
    delete copy.behaviors
    return flatten(copy)
  }
  const b = rest(before)
  const a = rest(after)
  for (const key of [...new Set([...Object.keys(b), ...Object.keys(a)])].sort()) {
    if (JSON.stringify(b[key]) !== JSON.stringify(a[key])) {
      changes.push({ group: 'Operations', label: OPERATIONS_LABELS[key] ?? key, key, before: show(b[key]), after: show(a[key]) })
    }
  }
  return changes
}

