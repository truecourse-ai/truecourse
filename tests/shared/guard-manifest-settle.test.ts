/**
 * THE SETTLE INVARIANT, as a pure predicate over a manifest entry: a flow that
 * records a `generationInputsHash` (and is therefore skipped by every future
 * generate) must account for each surface it PLANNED with a committed test XOR a
 * gap. Neither is a permanent, silent coverage hole — nothing left to re-run it and
 * nothing to say why there is no test.
 */

import { describe, it, expect } from 'vitest'
import {
  unaccountedSurfaces,
  violatesSettleInvariant,
  type GuardManifestFlow,
} from '@truecourse/shared'

const HASH = 'sha256:1111'

function entry(overrides: Partial<GuardManifestFlow> = {}): GuardManifestFlow {
  return {
    flowId: 'create-a-task',
    flowFingerprint: 'sha256:flow',
    bindings: [{ doc: 'docs/cli.md', anchor: 'tasks', fingerprint: 'sha256:section' }],
    scenarios: [],
    journeys: [{ surface: 'cli', journeyIds: ['cli/tasks'] }],
    generationInputsHash: HASH,
    gaps: [],
    ...overrides,
  }
}

describe('unaccountedSurfaces', () => {
  it('is empty when the planned surface committed a test', () => {
    const flow = entry({ scenarios: [{ id: 'create-a-task.cli.1', surface: 'cli', status: 'passing' }] })
    expect(unaccountedSurfaces(flow)).toEqual([])
    expect(violatesSettleInvariant(flow)).toBe(false)
  })

  it('is empty when a committed test FAILED — a red test is an outcome', () => {
    const flow = entry({ scenarios: [{ id: 'create-a-task.cli.1', surface: 'cli', status: 'failing' }] })
    expect(violatesSettleInvariant(flow)).toBe(false)
  })

  it('is empty when the planned surface recorded a gap instead', () => {
    const flow = entry({ gaps: [{ surface: 'cli', kind: 'blocked-on', reason: 'blocked on db: create a task' }] })
    expect(unaccountedSurfaces(flow)).toEqual([])
    expect(violatesSettleInvariant(flow)).toBe(false)
  })

  it('names a planned surface that recorded NEITHER', () => {
    expect(unaccountedSurfaces(entry())).toEqual(['cli'])
    expect(violatesSettleInvariant(entry())).toBe(true)
  })

  it('names only the unaccounted surface when a sibling is covered', () => {
    const flow = entry({
      journeys: [
        { surface: 'cli', journeyIds: ['cli/tasks'] },
        { surface: 'api', journeyIds: ['api/post-tasks'] },
      ],
      scenarios: [{ id: 'create-a-task.cli.1', surface: 'cli', status: 'passing' }],
    })
    expect(unaccountedSurfaces(flow)).toEqual(['api'])
    expect(violatesSettleInvariant(flow)).toBe(true)
  })

  it('holds vacuously for a flow that planned nothing (every surface gapped at match)', () => {
    const flow = entry({
      journeys: [],
      gaps: [{ surface: 'cli', kind: 'unrealizable', reason: 'no journey serves this' }],
    })
    expect(unaccountedSurfaces(flow)).toEqual([])
    expect(violatesSettleInvariant(flow)).toBe(false)
  })

  it('is NOT a violation while the flow is unsettled — it is already work', () => {
    const flow = entry({ generationInputsHash: null })
    // The surface is still unaccounted for…
    expect(unaccountedSurfaces(flow)).toEqual(['cli'])
    // …but with no hash the next generate re-runs it anyway, which is the fix.
    expect(violatesSettleInvariant(flow)).toBe(false)
  })
})
