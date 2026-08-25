import { describe, it, expect, afterEach } from 'vitest'
import { rebuildManifestFromScenarios, writeManifest, readManifest, manifestPath } from '@truecourse/guard-runner'
import { GuardManifestSchema, flowFingerprint, type GuardManifest } from '@truecourse/shared'
import { makeTempRepo, rmrf, writeRecipe, writeScenario, scenario } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

const bindsFor = (...sections: string[]) =>
  sections.map((section) => ({ doc: 'docs/spec.md', section, fingerprint: `sha256:${section}` }))

describe('GuardManifestSchema', () => {
  it('round-trips through JSON', () => {
    const manifest: GuardManifest = {
      flows: [
        {
          flowId: 'task-lifecycle',
          flowFingerprint: 'sha256:flow',
          bindings: [{ doc: 'docs/spec.md', anchor: 'a/b', fingerprint: 'sha256:1' }],
          scenarios: [{ id: 'task-lifecycle.cli.1', drivers: ['cli'], status: 'passing' }],
          interfaces: [{ surface: 'cli', interfaceIds: ['cli/tasks-add'] }],
          generationInputsHash: null,
          gaps: [],
        },
      ],
    }
    const reparsed = GuardManifestSchema.parse(JSON.parse(JSON.stringify(manifest)))
    expect(reparsed).toEqual(manifest)
  })

  it('defaults the generation-inputs hash slot to null, and gaps/interfaces to []', () => {
    const parsed = GuardManifestSchema.parse({
      flows: [{ flowId: 'f', flowFingerprint: 'sha256:x', bindings: [], scenarios: [] }],
    })
    expect(parsed.flows[0].generationInputsHash).toBeNull()
    expect(parsed.flows[0].gaps).toEqual([])
    expect(parsed.flows[0].interfaces).toEqual([])
  })

  it('carries a test committed FAILING at birth, and defaults a status-less entry to passing', () => {
    const parsed = GuardManifestSchema.parse({
      flows: [
        {
          flowId: 'f',
          flowFingerprint: 'sha256:x',
          bindings: [],
          scenarios: [
            { id: 'f.cli.1', drivers: ['cli'], status: 'failing' },
            // A manifest written before failing tests were committed carries none.
            { id: 'f.api.1', drivers: ['api'] },
          ],
        },
      ],
    })
    expect(parsed.flows[0].scenarios.map((s) => s.status)).toEqual(['failing', 'passing'])
  })
})

describe('rebuildManifestFromScenarios', () => {
  it('groups scenarios by the flow they realize, unioning the sections they bind', () => {
    const r = repo()
    writeRecipe(r)
    const flow = { id: 'task-lifecycle', fingerprint: 'sha256:flow' }
    writeScenario(
      r,
      'a.yaml',
      scenario({ id: 'task-lifecycle.cli.1', flow, binds: bindsFor('one', 'two'), steps: [{ run: [], expect: { exit: 0 } }] }),
    )
    writeScenario(
      r,
      'b.yaml',
      scenario({
        id: 'task-lifecycle.cli.2',
        flow,
        binds: bindsFor('one'),
        interface: { path: ['cli/tasks-list'], fingerprints: ['sha256:j2'] },
        steps: [{ run: [], expect: { exit: 0 } }],
      }),
    )

    const manifest = rebuildManifestFromScenarios(r)
    expect(manifest.flows).toHaveLength(1)
    expect(manifest.flows[0]).toEqual({
      flowId: 'task-lifecycle',
      flowFingerprint: 'sha256:flow',
      bindings: [
        { doc: 'docs/spec.md', anchor: 'one', fingerprint: 'sha256:one' },
        { doc: 'docs/spec.md', anchor: 'two', fingerprint: 'sha256:two' },
      ],
      scenarios: [
        { id: 'task-lifecycle.cli.1', drivers: ['cli'], status: 'passing' },
        { id: 'task-lifecycle.cli.2', drivers: ['cli'], status: 'passing' },
      ],
      // Rebuilt from the committed scenarios: only interfaces they actually ground
      // on can be recovered (a blocked surface left no file to read a plan from).
      interfaces: [{ surface: 'cli', interfaceIds: ['cli/tasks-list'] }],
      generationInputsHash: null,
      gaps: [],
    })
  })

  it('records the drivers a scenario’s STEPS exercise, not one surface tag', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'mixed.yaml',
      scenario({
        id: 'mixed.cli.1',
        binds: bindsFor('one'),
        steps: [
          { run: ['analyze'], expect: { exit: 0 } },
          { driver: 'web', navigate: '/board', expect: { text: { contains: 'ok' } } },
          { request: { method: 'GET', path: '/api/board' }, expect: { status: 200 } },
        ],
      }),
    )
    const manifest = rebuildManifestFromScenarios(r)
    // Registry order, and every driver it touches — the coverage classification
    // counts it under each, instead of calling the whole thing a CLI test.
    expect(manifest.flows[0].scenarios).toEqual([
      { id: 'mixed.cli.1', drivers: ['cli', 'api', 'web'], status: 'passing' },
    ])
  })

  it('gives each hand-written scenario its Manual pseudo-flow', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 'h1.yaml', scenario({ id: 'hand.1', title: 'a hand-written guard', binds: bindsFor('one'), steps: [{ run: [], expect: { exit: 0 } }] }))
    writeScenario(r, 'h2.yaml', scenario({ id: 'hand.2', binds: bindsFor('two'), steps: [{ run: [], expect: { exit: 0 } }] }))

    const manifest = rebuildManifestFromScenarios(r)
    expect(manifest.flows.map((f) => f.flowId)).toEqual(['manual/hand.1', 'manual/hand.2'])
    expect(manifest.flows[0].flowFingerprint).toBe(
      flowFingerprint([{ order: 1, doc: 'docs/spec.md', anchor: 'one', claimTitle: 'a hand-written guard' }]),
    )
    expect(manifest.flows[0].scenarios).toEqual([{ id: 'hand.1', drivers: ['cli'], status: 'passing' }])
  })

  it('writes and reads back a schema-valid manifest', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 's.yaml', scenario({ id: 's', binds: bindsFor('one'), steps: [{ run: [], expect: { exit: 0 } }] }))

    const built = rebuildManifestFromScenarios(r)
    const written = writeManifest(r, built)
    expect(written).toBe(manifestPath(r))

    const read = readManifest(r)
    expect(read).toEqual(built)
    expect(() => GuardManifestSchema.parse(read)).not.toThrow()
  })

  it('returns null when no manifest exists', () => {
    expect(readManifest(repo())).toBeNull()
  })
})
