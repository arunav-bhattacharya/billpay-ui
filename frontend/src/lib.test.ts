import { describe, expect, it } from 'vitest'
import { behaviorFor, describeDuration, formatDuration, missingCombinations, parseDuration } from './lib'
import type { BehaviorMeta, Capabilities } from './types'

describe('ISO durations', () => {
  it('reads one number and unit, and writes it back', () => {
    expect(parseDuration('PT1H')).toEqual({ amount: 1, unit: 'H' })
    expect(parseDuration('PT90M')).toEqual({ amount: 90, unit: 'M' })
    expect(parseDuration('P2D')).toEqual({ amount: 2, unit: 'D' })
    expect(parseDuration('PT0S')).toEqual({ amount: 0, unit: 'S' })
    expect(parseDuration('an hour')).toBeNull()
    expect(parseDuration('')).toBeNull()
    expect(formatDuration(24, 'H')).toBe('PT24H')
    expect(formatDuration(2, 'D')).toBe('P2D')
    expect(describeDuration('PT1H')).toBe('1 hour')
    expect(describeDuration('PT30M')).toBe('30 minutes')
  })
})

const behaviors: BehaviorMeta[] = [
  { key: 'requiresArPosting', label: 'Good-faith Credit', description: '', bothRuleByJourney: true, accountTypes: ['CONSUMER', 'CORPORATE', 'BUSINESS_TRAVEL_ACCOUNT'] },
  { key: 'requiresBankConfirmation', label: 'Bank Confirmation', description: '', bothRuleByJourney: false, accountTypes: ['CONSUMER'] },
]

describe('behaviors per account type', () => {
  it('holds a behavior an account type can not take at N', () => {
    const b = { requiresArPosting: 'Y', requiresRealtimeClearing: 'N', requiresMandateAuthorization: 'N', requiresBankConfirmation: 'BOTH' } as const
    expect(behaviorFor(b, 'CONSUMER', behaviors).requiresBankConfirmation).toBe('BOTH')
    expect(behaviorFor(b, 'CORPORATE', behaviors).requiresBankConfirmation).toBe('N')
    expect(behaviorFor(b, 'CORPORATE', behaviors).requiresArPosting).toBe('Y')
  })
})

describe('the manifest pre-check', () => {
  const manifest: Capabilities = {
    buildVersion: '1.0',
    combinations: [
      { accountType: 'CONSUMER', requiresArPosting: 'Y', requiresRealtimeClearing: 'N', requiresMandateAuthorization: 'N', requiresBankConfirmation: 'N' },
      { accountType: 'BUSINESS_TRAVEL', requiresArPosting: 'Y', requiresRealtimeClearing: 'N', requiresMandateAuthorization: 'N', requiresBankConfirmation: 'N' },
    ],
  }

  it('needs both halves of a BOTH, and names business travel as billpay-core does', () => {
    const plain = { requiresArPosting: 'Y', requiresRealtimeClearing: 'N', requiresMandateAuthorization: 'N', requiresBankConfirmation: 'N' } as const
    expect(missingCombinations('CONSUMER', plain, manifest)).toEqual([])
    expect(missingCombinations('BUSINESS_TRAVEL_ACCOUNT', plain, manifest)).toEqual([])
    const both = { ...plain, requiresArPosting: 'BOTH' } as const
    const missing = missingCombinations('CONSUMER', both, manifest)
    expect(missing).toHaveLength(1)
    expect(missing[0].requiresArPosting).toBe('N')
  })
})
