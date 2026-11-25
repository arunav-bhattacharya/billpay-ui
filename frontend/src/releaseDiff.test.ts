import { describe, expect, it } from 'vitest'
import { diffReleases } from './releaseDiff'

describe('the release diff', () => {
  it('groups changes the way people talk about them', () => {
    const before = {
      apis: ['CreatePayment.v3'],
      behaviors: { requiresBankConfirmation: { value: 'N' as const } },
      executionTime: '01:00',
      bankConfirmation: { confirmationWindow: 'PT24H' },
    }
    const after = {
      apis: ['CreatePayment.v3', 'CreatePaymentSubmission.v1'],
      behaviors: { requiresBankConfirmation: { value: 'BOTH' as const } },
      executionTime: '02:00',
      bankConfirmation: { confirmationWindow: 'PT48H' },
    }
    const changes = diffReleases(before, after, null)
    expect(changes.map((c) => [c.group, c.key, c.before, c.after])).toEqual([
      ['APIs', 'CreatePaymentSubmission.v1', 'not taken', 'taken'],
      ['Behaviors', 'requiresBankConfirmation', 'N', 'BOTH'],
      ['Operations', 'bankConfirmation.confirmationWindow', '24 hours (PT24H)', '48 hours (PT48H)'],
      ['Operations', 'executionTime', '01:00', '02:00'],
    ])
    expect(diffReleases(after, after, null)).toEqual([])
  })
})
