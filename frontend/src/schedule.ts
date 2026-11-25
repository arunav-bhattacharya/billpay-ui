import { parseDuration } from './lib'
import type { Behavior, BehaviorKey, ReleaseConfig } from './types'

/**
 * When a market's scheduled run happens, from the release it runs: `executionTime` in its `timeZone`, midnight when
 * unset; the cancellation window closes `cancellationWindow` before it (1 hour when unset); a cutoff market must finish
 * within `executionCutoff`. Times are computed per zone with the platform's time-zone data, so daylight saving moves
 * them; holidays are not in the config, so they are not shown.
 */

const MINUTE = 60_000

/** The zone's offset from UTC at an instant, in minutes (Europe/Berlin in winter: 60). */
export function zoneOffsetMinutes(zone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / MINUTE)
}

/** The zone's calendar date at an instant. */
function localDate(zone: string, at: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value)
  return { y: get('year'), m: get('month'), d: get('day') }
}

/** The instant a local wall time happens in a zone, settling the offset twice so it holds across a change. */
export function localToUtc(zone: string, y: number, m: number, d: number, hour: number, minute: number): Date {
  const wall = Date.UTC(y, m - 1, d, hour, minute)
  let guess = wall - zoneOffsetMinutes(zone, new Date(wall)) * MINUTE
  guess = wall - zoneOffsetMinutes(zone, new Date(guess)) * MINUTE
  return new Date(guess)
}

/** The next run at or after [from]: today's local run if it hasn't happened, else tomorrow's. */
export function nextRun(zone: string, executionTime: string | undefined, from: Date): Date {
  const [hour, minute] = (executionTime ?? '00:00').split(':').map(Number)
  const today = localDate(zone, from)
  for (let add = 0; add < 3; add++) {
    const day = new Date(Date.UTC(today.y, today.m - 1, today.d + add))
    const run = localToUtc(zone, day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), hour, minute)
    if (run.getTime() >= from.getTime()) return run
  }
  throw new Error(`no run found for ${zone} ${executionTime}`)
}

function minutes(iso: string | undefined, fallback: number): number {
  const d = parseDuration(iso)
  if (!d) return fallback
  const per = { S: 1 / 60, M: 1, H: 60, D: 1440 }[d.unit]
  return d.amount * per
}

export interface RunWindow {
  run: Date
  /** When cancels and updates close. */
  windowOpensAt: Date
  /** When a cutoff market's run must have finished, or null. */
  cutoffAt: Date | null
  zone: string
  localTime: string
}

/** A release's next run and its windows; null when the release has no time zone and so takes no scheduled payments. */
export function runWindow(config: ReleaseConfig, from: Date): RunWindow | null {
  if (!config.timeZone) return null
  const run = nextRun(config.timeZone, config.executionTime, from)
  const cancel = minutes(config.cancellationWindow, 60)
  const cutoff = config.executionCutoff ? minutes(config.executionCutoff, 0) : null
  return {
    run,
    windowOpensAt: new Date(run.getTime() - cancel * MINUTE),
    cutoffAt: cutoff ? new Date(run.getTime() + cutoff * MINUTE) : null,
    zone: config.timeZone,
    localTime: config.executionTime ?? '00:00',
  }
}

/** "01:00 UTC" */
export function utcLabel(at: Date): string {
  return `${String(at.getUTCHours()).padStart(2, '0')}:${String(at.getUTCMinutes()).padStart(2, '0')}`
}

/** A release's behaviors as its JSON holds them. */
export function releaseBehavior(config: ReleaseConfig): Behavior {
  const value = (k: BehaviorKey) => config.behaviors?.[k]?.value ?? 'N'
  return {
    requiresArPosting: value('requiresArPosting'),
    requiresRealtimeClearing: value('requiresRealtimeClearing'),
    requiresMandateAuthorization: value('requiresMandateAuthorization'),
    requiresBankConfirmation: value('requiresBankConfirmation'),
  }
}
