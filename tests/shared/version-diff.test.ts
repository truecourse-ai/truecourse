/**
 * The diff between two versions of a scenario set, read off their manifests:
 * a flow is added, retired, amended or kept by its id and its fingerprints, a
 * claim is covered while a live flow with a scenario has a milestone on it, and
 * an orphaned entry counts as retired.
 */
import { describe, it, expect } from 'vitest'
import { diffScenarioSets, type GuardManifest, type GuardManifestFlow } from '@truecourse/shared'

/** The claim a test flow's one milestone proves, named after the flow. */
const claimOf = (flowId: string): string => `claim::docs/a.md::${flowId}`

const flow = (over: Partial<GuardManifestFlow> & Pick<GuardManifestFlow, 'flowId'>): GuardManifestFlow => ({
  flowFingerprint: 'sha256:f',
  milestones: [{ order: 1, doc: 'docs/a.md', claimId: claimOf(over.flowId), claimTitle: over.flowId, sentences: [over.flowId] }],
  bindings: [{ doc: 'docs/a.md', sentences: [over.flowId] }],
  scenarios: [{ id: `${over.flowId}-1`, drivers: ['cli'], status: 'passing' }],
  interfaces: [],
  generationInputsHash: 'h1',
  gaps: [],
  retiredScenarios: [],
  ...over,
})

const manifest = (flows: GuardManifestFlow[]): GuardManifest => ({ flows })

describe('diffScenarioSets', () => {
  it('sorts flows into added, retired, amended and kept, with the inputs that moved', () => {
    const prior = manifest([
      flow({ flowId: 'kept' }),
      flow({ flowId: 'amended', generationInputs: { recipe: 'r1', interfaces: 'i1' } }),
      flow({ flowId: 'retired' }),
    ])
    const next = manifest([
      flow({ flowId: 'kept' }),
      flow({ flowId: 'amended', generationInputsHash: 'h2', generationInputs: { recipe: 'r1', interfaces: 'i2' } }),
      flow({ flowId: 'added' }),
    ])
    const diff = diffScenarioSets(prior, next)
    expect(diff.flows).toEqual({
      added: ['added'],
      retired: ['retired'],
      amended: [{ flowId: 'amended', movedInputs: ['interfaces'] }],
      kept: ['kept'],
    })
    expect(diff.scenarios).toEqual({ added: ['added-1'], removed: ['retired-1'] })
    expect(diff.claims).toEqual({ gained: [claimOf('added')], lost: [claimOf('retired')] })
  })

  it('reads a flow whose fingerprint moved as amended, with null inputs when the prior recorded none', () => {
    const diff = diffScenarioSets(
      manifest([flow({ flowId: 'f' })]),
      manifest([flow({ flowId: 'f', flowFingerprint: 'sha256:g' })]),
    )
    expect(diff.flows.amended).toEqual([{ flowId: 'f', movedInputs: null }])
    expect(diff.flows.kept).toEqual([])
  })

  it('treats an orphaned entry as retired, and keeps its scenarios counted', () => {
    const prior = manifest([flow({ flowId: 'f' })])
    const next = manifest([flow({ flowId: 'f', orphaned: true })])
    const diff = diffScenarioSets(prior, next)
    expect(diff.flows.retired).toEqual(['f'])
    // The orphaned test is still on disk: it did not leave the set.
    expect(diff.scenarios).toEqual({ added: [], removed: [] })
    // But it no longer covers its claim, which no live flow proves.
    expect(diff.claims.lost).toEqual([claimOf('f')])
  })

  it('a claim on a flow without a scenario is not covered', () => {
    const diff = diffScenarioSets(null, manifest([flow({ flowId: 'f', scenarios: [] })]))
    expect(diff.flows.added).toEqual(['f'])
    expect(diff.claims.gained).toEqual([])
  })

  it('two absent manifests differ in nothing', () => {
    expect(diffScenarioSets(null, null)).toEqual({
      flows: { added: [], retired: [], amended: [], kept: [] },
      scenarios: { added: [], removed: [] },
      claims: { gained: [], lost: [] },
    })
  })
})
