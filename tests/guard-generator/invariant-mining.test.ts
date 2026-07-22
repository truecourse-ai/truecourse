import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { generateGuards } from '@truecourse/guard-generator'
import type { ExtractRunner, GenerateRunner } from '@truecourse/guard-generator'
import { loadPackInputs, readManifest } from '@truecourse/guard-runner'
import type { GuardScenario } from '@truecourse/shared'
import { makeTempRepo, rmrf, writeRecipe, writeDoc, writeCorpus, raw } from './helpers.js'
import { stubAuxRunners } from './helpers.js'

/**
 * Item 8 end to end: an `invariant`-flavor claim seeds an input-corpus pack from its
 * example blocks, authors ONE rule scenario bound to the pack, and birth validation
 * runs the rule over the WHOLE pack before committing. When the rule holds over every
 * seeded input the scenario persists (and the manifest just lists its id — the
 * coverage/manifest join is unchanged); when one seed breaks the rule, birth surfaces
 * a finding that NAMES the offending corpus file.
 */
describe('invariant mining — a documented always/never rule becomes a pack-swept scenario (e2e)', () => {
  const repos: string[] = []
  afterEach(() => {
    while (repos.length) rmrf(repos.pop()!)
  })
  function repo(): string {
    const r = makeTempRepo()
    repos.push(r)
    return r
  }

  const DOC = 'docs/fix.md'
  const DOC_CONTENT = ['## Fix', '', 'Running fix never breaks your input; it is idempotent for any config.', ''].join('\n')

  /** An extract runner that emits ONE invariant claim carrying `examples` seed blocks. */
  function extractInvariant(blocks: string[]): ExtractRunner {
    return async ({ outline }) => {
      const target = outline.find((e) => e.headingText === 'Fix') ?? outline[outline.length - 1]
      return {
        claims: [
          {
            claim: 'fix is idempotent for any config',
            driver: 'cli',
            sectionAnchor: target.anchor,
            reason: 'parsing the input always succeeds',
            flavor: 'invariant',
            examples: blocks.map((b) => ({ block: b, outcome: 'parses clean' })),
          },
        ],
      }
    }
  }

  /** An author runner that returns ONE rule scenario asserting each staged input parses. */
  const authorRule: GenerateRunner = async ({ claims }) =>
    claims.map((c) => ({
      ref: c.ref,
      scenarios: [raw('fix is idempotent for every config', [{ run: ['parse', 'input'], expect: { exit: 0 } }])],
    }))

  it('seeds the pack, births the rule over every input, and persists one invariant scenario', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, DOC_CONTENT)

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractInvariant(['{"a":1}\n', '{"b":2,"c":3}\n']),
      generateRunner: authorRule,
    })

    expect(res.status).toBe('ok')
    expect(res.errors).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(res.written).toHaveLength(1)

    // The committed scenario binds to an engine-seeded pack.
    const scenario = yaml.load(fs.readFileSync(path.join(r, res.written[0].file), 'utf-8')) as GuardScenario
    expect(scenario.inputs).toBeDefined()
    expect(scenario.inputs!.as).toBe('input')
    const pack = scenario.inputs!.pack

    // The pack was seeded from the doc's own example blocks, byte-faithfully.
    const loaded = loadPackInputs(r, pack)
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      expect(loaded.files.map((f) => f.content).sort()).toEqual(['{"a":1}\n', '{"b":2,"c":3}\n'].sort())
    }
    // The pack directory + manifest live under the committable scenarios tree.
    expect(fs.existsSync(path.join(r, '.truecourse/scenarios/corpus', pack, 'pack.json'))).toBe(true)

    // Coverage/manifest join is unchanged — the manifest just lists the scenario id.
    const manifest = readManifest(r)
    expect(manifest?.sections.some((s) => s.scenarioIds.includes(scenario.id))).toBe(true)
  })

  it('a seed that breaks the rule COMMITS as drift NAMING the offending file', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, DOC_CONTENT)

    // The second seed is invalid JSON — `parse input` exits 5 on it, breaking the rule.
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractInvariant(['{"a":1}\n', '{oops not json\n']),
      generateRunner: authorRule,
    })

    expect(res.status).toBe('ok')
    // No triage ⇒ real drift: the failing invariant scenario COMMITS with a diagnosis.
    expect(res.birthFindings).toEqual([])
    expect(res.written).toHaveLength(1)
    // The diagnosis names the corpus file that is the repro (sorted seeds → sample-02).
    expect(res.written[0].diagnosis?.actual).toContain('sample-02')
  })
})
