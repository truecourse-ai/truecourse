import { describe, it, expect, afterEach } from 'vitest'
import { rebuildManifestFromScenarios, writeManifest, readManifest, manifestPath } from '@truecourse/guard-runner'
import { GuardManifestSchema, type GuardManifest } from '@truecourse/shared'
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

const bindsFor = (section: string) => ({ doc: 'docs/spec.md', section, fingerprint: `sha256:${section}` })

describe('GuardManifestSchema', () => {
  it('round-trips through JSON', () => {
    const manifest: GuardManifest = {
      guard: 1,
      sections: [
        { doc: 'docs/spec.md', anchor: 'a/b', fingerprint: 'sha256:1', scenarioIds: ['x'], generationInputsHash: null },
      ],
    }
    const reparsed = GuardManifestSchema.parse(JSON.parse(JSON.stringify(manifest)))
    expect(reparsed).toEqual(manifest)
  })

  it('defaults the generation-inputs hash slot to null', () => {
    const parsed = GuardManifestSchema.parse({
      guard: 1,
      sections: [{ doc: 'd', anchor: 'a', fingerprint: 'sha256:1', scenarioIds: [] }],
    })
    expect(parsed.sections[0].generationInputsHash).toBeNull()
  })
})

describe('rebuildManifestFromScenarios', () => {
  it('groups scenarios by section and records anchor, fingerprint, and sorted ids', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(r, 'a.yaml', scenario({ id: 'sec1.b', binds: bindsFor('one'), steps: [{ run: [], expect: { exit: 0 } }] }))
    writeScenario(r, 'b.yaml', scenario({ id: 'sec1.a', binds: bindsFor('one'), steps: [{ run: [], expect: { exit: 0 } }] }))
    writeScenario(r, 'c.yaml', scenario({ id: 'sec2', binds: bindsFor('two'), steps: [{ run: [], expect: { exit: 0 } }] }))

    const manifest = rebuildManifestFromScenarios(r)
    expect(manifest.guard).toBe(1)
    expect(manifest.sections).toHaveLength(2)
    expect(manifest.sections.map((s) => s.anchor)).toEqual(['one', 'two']) // sorted by anchor
    expect(manifest.sections[0]).toMatchObject({
      doc: 'docs/spec.md',
      anchor: 'one',
      fingerprint: 'sha256:one',
      scenarioIds: ['sec1.a', 'sec1.b'], // sorted
      generationInputsHash: null,
    })
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
