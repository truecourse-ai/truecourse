/**
 * The diff between two versions of a scenario set, read off their manifests:
 * a flow is added, retired, amended or kept by its id and its fingerprints, a
 * section's coverage follows the live flows that bind it with a scenario, and
 * an orphaned entry counts as retired.
 */
import { describe, it, expect } from 'vitest'
import { diffScenarioSets, type GuardManifest, type GuardManifestFlow } from '@truecourse/shared'

const flow = (over: Partial<GuardManifestFlow> & Pick<GuardManifestFlow, 'flowId'>): GuardManifestFlow => ({
  flowFingerprint: 'sha256:f',
  bindings: [{ doc: 'docs/a.md', anchor: over.flowId, fingerprint: 'sha256:s' }],
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
      flow({ flowId: 'amended', generationInputs: { recipe: 'r1', section: 's1' } }),
      flow({ flowId: 'retired' }),
    ])
    const next = manifest([
      flow({ flowId: 'kept' }),
      flow({ flowId: 'amended', generationInputsHash: 'h2', generationInputs: { recipe: 'r1', section: 's2' } }),
      flow({ flowId: 'added' }),
    ])
    const diff = diffScenarioSets(prior, next)
    expect(diff.flows).toEqual({
      added: ['added'],
      retired: ['retired'],
      amended: [{ flowId: 'amended', movedInputs: ['section'] }],
      kept: ['kept'],
    })
    expect(diff.scenarios).toEqual({ added: ['added-1'], removed: ['retired-1'] })
    expect(diff.sections).toEqual({
      gained: [{ doc: 'docs/a.md', anchor: 'added' }],
      lost: [{ doc: 'docs/a.md', anchor: 'retired' }],
    })
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
    // But it no longer covers the section, which nothing live binds.
    expect(diff.sections.lost).toEqual([{ doc: 'docs/a.md', anchor: 'f' }])
  })

  it('a section bound by a flow without a scenario is not covered', () => {
    const diff = diffScenarioSets(null, manifest([flow({ flowId: 'f', scenarios: [] })]))
    expect(diff.flows.added).toEqual(['f'])
    expect(diff.sections.gained).toEqual([])
  })

  it('two absent manifests differ in nothing', () => {
    expect(diffScenarioSets(null, null)).toEqual({
      flows: { added: [], retired: [], amended: [], kept: [] },
      scenarios: { added: [], removed: [] },
      sections: { gained: [], lost: [] },
    })
  })
})
