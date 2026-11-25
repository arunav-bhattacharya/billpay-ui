import { describe, expect, it } from 'vitest'
import { localToUtc, nextRun, releaseBehavior, runWindow, zoneOffsetMinutes } from './schedule'

describe('time zones', () => {
  it('reads each zone offset, daylight saving included', () => {
    expect(zoneOffsetMinutes('Europe/Berlin', new Date('2026-01-15T12:00:00Z'))).toBe(60)
    expect(zoneOffsetMinutes('Europe/Berlin', new Date('2026-07-15T12:00:00Z'))).toBe(120)
    expect(zoneOffsetMinutes('America/New_York', new Date('2026-11-25T12:00:00Z'))).toBe(-300)
    expect(zoneOffsetMinutes('Asia/Tokyo', new Date('2026-11-25T12:00:00Z'))).toBe(540)
  })

  it('turns a local wall time into the instant it happens', () => {
    expect(localToUtc('Europe/Berlin', 2026, 11, 25, 2, 0).toISOString()).toBe('2026-11-25T01:00:00.000Z')
    expect(localToUtc('America/New_York', 2026, 11, 25, 0, 0).toISOString()).toBe('2026-11-25T05:00:00.000Z')
    // The night New York springs forward (2026-03-08): midnight is still on standard time.
    expect(localToUtc('America/New_York', 2026, 3, 8, 0, 0).toISOString()).toBe('2026-03-08T05:00:00.000Z')
    expect(localToUtc('America/New_York', 2026, 3, 9, 0, 0).toISOString()).toBe('2026-03-09T04:00:00.000Z')
  })

  it("finds today's run, or tomorrow's once it has passed", () => {
    const from = new Date('2026-11-24T21:40:00Z')
    expect(nextRun('Europe/Berlin', '02:00', from).toISOString()).toBe('2026-11-25T01:00:00.000Z')
    expect(nextRun('Asia/Tokyo', '00:30', from).toISOString()).toBe('2026-11-25T15:30:00.000Z')
    expect(nextRun('America/New_York', undefined, from).toISOString()).toBe('2026-11-25T05:00:00.000Z')
  })
})

describe('a release run window', () => {
  it('closes cancels before the run and holds a cutoff after it', () => {
    const w = runWindow(
      { timeZone: 'Europe/Amsterdam', executionTime: '01:00', cancellationWindow: 'PT2H', executionCutoff: 'PT3H' },
      new Date('2026-11-24T21:40:00Z'),
    )!
    expect(w.run.toISOString()).toBe('2026-11-25T00:00:00.000Z')
    expect(w.windowOpensAt.toISOString()).toBe('2026-11-24T22:00:00.000Z')
    expect(w.cutoffAt!.toISOString()).toBe('2026-11-25T03:00:00.000Z')
    expect(runWindow({}, new Date())).toBeNull()
  })

  it('reads behaviors back from a release', () => {
    expect(releaseBehavior({ behaviors: { requiresArPosting: { value: 'BOTH' } } }).requiresArPosting).toBe('BOTH')
    expect(releaseBehavior({}).requiresBankConfirmation).toBe('N')
  })
})
