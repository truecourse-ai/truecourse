/**
 * The unadjudicated effect sentence — ONE copy, shared by the CLI generate summary
 * and the dashboard generate overview. It used to be written twice, and the two
 * copies had already drifted (`test(s)` on the terminal, real pluralization on
 * screen), which is how the same corpus starts reading differently depending on
 * where you look at it.
 */
import { describe, it, expect } from 'vitest'
import {
  GuardUnadjudicatedStageSchema,
  guardUnadjudicatedEffect,
  GUARD_UNADJUDICATED_REMEDY,
} from '@truecourse/shared'

describe('guardUnadjudicatedEffect', () => {
  it('says what a lost fidelity stage left behind, pluralized', () => {
    expect(guardUnadjudicatedEffect({ stage: 'guard.fidelity', affected: 41 })).toBe(
      '41 tests persisted passing, never reviewed against their flow',
    )
    expect(guardUnadjudicatedEffect({ stage: 'guard.fidelity', affected: 1 })).toContain('1 test persisted')
  })

  it('says what a lost triage stage left behind, pluralized', () => {
    expect(guardUnadjudicatedEffect({ stage: 'guard.triage', affected: 7 })).toContain(
      '7 tests committed failing and untriaged',
    )
    expect(guardUnadjudicatedEffect({ stage: 'guard.triage', affected: 1 })).toContain('1 test committed')
  })

  // The remedy is only true because the affected flows are left UNSETTLED and
  // authoring is cached — both pinned in the generator tests. The sentence must
  // keep saying exactly that, on every surface at once.
  it('states the remedy the engine actually implements', () => {
    expect(GUARD_UNADJUDICATED_REMEDY).toContain('left unsettled')
    expect(GUARD_UNADJUDICATED_REMEDY).toContain('authoring is cached')
  })

  it('accepts only the two adjudication stages', () => {
    expect(GuardUnadjudicatedStageSchema.safeParse({ stage: 'guard.extract', affected: 1 }).success).toBe(false)
    expect(GuardUnadjudicatedStageSchema.safeParse({ stage: 'guard.triage', affected: 0 }).success).toBe(true)
  })
})
