import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { generateGuards, ExtractedClaimSchema } from '@truecourse/guard-generator'
import type { ExtractRunner, GenerateRunner, ExemplarRunner } from '@truecourse/guard-generator'
import {
  loadPackInputs,
  readManifest,
  readPackManifest,
  writePackManifest,
  writeManifest,
  packDir,
} from '@truecourse/guard-runner'
import { GUARD_FORMAT_VERSION, type GuardScenario } from '@truecourse/shared'
import { makeTempRepo, rmrf, writeRecipe, writeDoc, writeCorpus, raw } from './helpers.js'
import { stubAuxRunners } from './helpers.js'

/**
 * Item 9 end to end: a `support`-flavor claim ("supports/handles/parses X") generates
 * a diverse exemplar pack via ONE cached LLM call, authors ONE rule scenario bound to
 * the pack, and birth validation runs the documented operation over EVERY exemplar
 * before committing. A regenerate is a no-op (the exemplars are content-cached), and a
 * user-added repro dropped into the pack survives regeneration (the ratchet). The stub
 * extract/exemplar runners stand in for the LLM; the pipeline under test is everything
 * downstream (classification threading, generation, seeding, authoring, birth, persist).
 */
describe('support mining — a "supports X" claim becomes a generated-exemplar pack scenario (e2e)', () => {
  const repos: string[] = []
  afterEach(() => {
    while (repos.length) rmrf(repos.pop()!)
  })
  function repo(): string {
    const r = makeTempRepo()
    repos.push(r)
    return r
  }

  const DOC = 'docs/json.md'
  const DOC_CONTENT = ['## JSON', '', 'relkit parse accepts any valid JSON document.', ''].join('\n')

  /** Extract runner emitting ONE support claim for the JSON format. */
  const extractSupport: ExtractRunner = async ({ outline }) => {
    const target = outline.find((e) => e.headingText === 'JSON') ?? outline[outline.length - 1]
    return {
      claims: [
        {
          claim: 'relkit parse accepts any valid JSON document',
          driver: 'cli',
          sectionAnchor: target.anchor,
          reason: 'parse exits 0 on valid JSON',
          flavor: 'support',
          support: { kind: 'format', subject: 'the JSON data format' },
        },
      ],
    }
  }

  /** Extract runner emitting a NORMAL claim (a mere mention — not a support promise). */
  const extractNormal: ExtractRunner = async ({ outline }) => {
    const target = outline.find((e) => e.headingText === 'JSON') ?? outline[outline.length - 1]
    return {
      claims: [
        {
          claim: 'relkit --version prints the version and exits 0',
          driver: 'cli',
          sectionAnchor: target.anchor,
          reason: 'exit code is observable',
        },
      ],
    }
  }

  /** Author runner: ONE rule scenario running `parse input` over each staged exemplar. */
  const authorRule: GenerateRunner = async ({ claims }) =>
    claims.map((c) => ({
      ref: c.ref,
      scenarios: [raw('parse accepts every valid JSON input', [{ run: ['parse', 'input'], expect: { exit: 0 } }])],
    }))

  /** Author runner producing an ordinary (non-pack) scenario. */
  const authorPlain: GenerateRunner = async ({ claims }) =>
    claims.map((c) => ({ ref: c.ref, scenarios: [raw('prints version', [{ run: ['--version'], expect: { exit: 0 } }])] }))

  /** An exemplar runner returning fixed contents; `onCall` fires once per generation. */
  function exemplarsReturning(contents: string[], onCall?: () => void): ExemplarRunner {
    return async () => {
      onCall?.()
      return { exemplars: contents.map((content, i) => ({ content, note: `case ${i + 1}` })) }
    }
  }

  it('generates the pack, births the rule over every exemplar, commits + caches, persists one scenario', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, DOC_CONTENT)

    let exemplarCalls = 0
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractSupport,
      generateRunner: authorRule,
      exemplarRunner: exemplarsReturning(['{"a":1}\n', '[1,2,3]\n', '"x"\n'], () => exemplarCalls++),
      supportPackSize: 3,
    })

    expect(res.status).toBe('ok')
    expect(res.errors).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(res.written).toHaveLength(1)
    // The exemplar generator ran exactly once (one support claim).
    expect(exemplarCalls).toBe(1)

    // The committed scenario binds to the engine-generated pack.
    const scenario = yaml.load(fs.readFileSync(path.join(r, res.written[0].file), 'utf-8')) as GuardScenario
    expect(scenario.inputs).toBeDefined()
    expect(scenario.inputs!.as).toBe('input')
    const pack = scenario.inputs!.pack
    expect(pack).toMatch(/^sup-/) // a support-generated pack id

    // The pack directory + manifest live under the committable scenarios tree.
    expect(fs.existsSync(path.join(r, '.truecourse/scenarios/corpus', pack, 'pack.json'))).toBe(true)

    // The generated exemplars were written byte-faithfully as the pack files.
    const loaded = loadPackInputs(r, pack)
    expect(loaded.ok).toBe(true)
    if (loaded.ok) {
      expect(loaded.files.map((f) => f.content).sort()).toEqual(['"x"\n', '[1,2,3]\n', '{"a":1}\n'].sort())
    }
    // The manifest marks generated files as `seed` and its provenance surfaces the ratchet.
    const manifest = readPackManifest(r, pack)!
    expect(manifest.files.every((f) => f.source === 'seed')).toBe(true)
    expect(manifest.provenance).toContain('source":"user')

    // Coverage/manifest join is unchanged — the manifest just lists the scenario id.
    const scenarioManifest = readManifest(r)
    expect(scenarioManifest?.sections.some((s) => s.scenarioIds.includes(scenario.id))).toBe(true)
  })

  it('a re-generate is a no-op — the exemplars are content-cached (no second generation call)', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, DOC_CONTENT)

    let calls = 0
    const runner = exemplarsReturning(['{"a":1}\n', '[1,2,3]\n'], () => calls++)
    await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: extractSupport, generateRunner: authorRule, exemplarRunner: runner, supportPackSize: 2 })
    expect(calls).toBe(1)

    // Force the whole pipeline to re-run (fresh manifest) with the SAME claim: the
    // exemplar pack is served from the guard/exemplars cache — no second generation.
    writeManifest(r, { guard: GUARD_FORMAT_VERSION, sections: [] })
    calls = 0
    const res2 = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: extractSupport, generateRunner: authorRule, exemplarRunner: runner, supportPackSize: 2 })
    expect(calls).toBe(0)
    expect(res2.written).toHaveLength(1)
  })

  it('a broken exemplar COMMITS as drift NAMING the offending corpus file', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, DOC_CONTENT)

    // The second exemplar is invalid JSON — `parse input` exits 5 on it, breaking the rule.
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractSupport,
      generateRunner: authorRule,
      exemplarRunner: exemplarsReturning(['{"a":1}\n', '{oops not json\n']),
      supportPackSize: 2,
    })

    expect(res.status).toBe('ok')
    // No triage ⇒ real drift: the failing support scenario COMMITS with a diagnosis.
    expect(res.birthFindings).toEqual([])
    expect(res.written).toHaveLength(1)
    // The diagnosis names the corpus file that is the repro (sorted files → exemplar-02).
    expect(res.written[0].diagnosis?.actual).toContain('exemplar-02')
  })

  it('a user-added repro dropped into the pack survives regeneration (the ratchet)', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, DOC_CONTENT)

    const runner = exemplarsReturning(['{"a":1}\n', '[1,2,3]\n'])
    const res1 = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: extractSupport, generateRunner: authorRule, exemplarRunner: runner, supportPackSize: 2 })
    const pack = res1.written[0] && (yaml.load(fs.readFileSync(path.join(r, res1.written[0].file), 'utf-8')) as GuardScenario).inputs!.pack
    expect(pack).toBeTruthy()

    // A user drops a real-world repro into the pack dir by hand and marks it `user` in
    // the manifest — the convention the provenance advertises.
    const userFile = '{"real":"repro"}\n'
    fs.writeFileSync(path.join(packDir(r, pack!), 'repro-user.json'), userFile)
    const m = readPackManifest(r, pack!)!
    writePackManifest(r, { ...m, files: [...m.files, { name: 'repro-user.json', source: 'user', note: 'reported bug' }] })

    // Force a full regenerate (fresh manifest). Cache hit ⇒ no exemplar call, but the
    // pack is re-materialized — and the user file must NOT be removed.
    writeManifest(r, { guard: GUARD_FORMAT_VERSION, sections: [] })
    await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: extractSupport, generateRunner: authorRule, exemplarRunner: runner, supportPackSize: 2 })

    // The user file is still on disk, still swept, and still marked `user` in the manifest.
    expect(fs.existsSync(path.join(packDir(r, pack!), 'repro-user.json'))).toBe(true)
    const after = readPackManifest(r, pack!)!
    expect(after.files.find((f) => f.name === 'repro-user.json')?.source).toBe('user')
    const loaded = loadPackInputs(r, pack!)
    expect(loaded.ok && loaded.files.some((f) => f.content === userFile)).toBe(true)
  })

  it('a support claim whose exemplar generation fails errors its section — never a pack-less scenario', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, DOC_CONTENT)

    const throwing: ExemplarRunner = async () => {
      throw new Error('exemplar model down')
    }
    const res = await generateGuards({ ...stubAuxRunners(), repoRoot: r, extractRunner: extractSupport, generateRunner: authorRule, exemplarRunner: throwing })

    expect(res.written).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(res.errors.some((e) => e.message.includes('support-claim exemplar generation failed'))).toBe(true)
    // No pack directory was left behind for a claim that could not generate one.
    expect(fs.existsSync(path.join(r, '.truecourse/scenarios/corpus'))).toBe(false)
  })

  it('classifies only support claims — a normal claim (mere mention) generates NO pack, no exemplar call', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, DOC_CONTENT)

    let calls = 0
    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractNormal,
      generateRunner: authorPlain,
      exemplarRunner: exemplarsReturning(['{"a":1}\n'], () => calls++),
    })

    expect(res.status).toBe('ok')
    expect(res.written).toHaveLength(1)
    // A normal claim never triggers exemplar generation and never binds a pack.
    expect(calls).toBe(0)
    const scenario = yaml.load(fs.readFileSync(path.join(r, res.written[0].file), 'utf-8')) as GuardScenario
    expect(scenario.inputs).toBeUndefined()
    expect(fs.existsSync(path.join(r, '.truecourse/scenarios/corpus'))).toBe(false)
  })
})

describe('support claim schema (item 9)', () => {
  it('parses a support-flavor claim with its subject payload', () => {
    const parsed = ExtractedClaimSchema.parse({
      claim: 'supports the Postgres dialect',
      driver: 'cli',
      sectionAnchor: 'dialects',
      reason: 'parses Postgres SQL',
      flavor: 'support',
      support: { kind: 'dialect', subject: 'the Postgres SQL dialect', extension: 'sql' },
    })
    expect(parsed.flavor).toBe('support')
    expect(parsed.support?.subject).toBe('the Postgres SQL dialect')
    expect(parsed.support?.extension).toBe('sql')
  })

  it('back-compat: a claim with no flavor/support parses as a normal claim (old caches load)', () => {
    const parsed = ExtractedClaimSchema.parse({
      claim: 'exits 0',
      driver: 'cli',
      sectionAnchor: 'x',
      reason: 'exit observable',
    })
    expect(parsed.flavor).toBeUndefined()
    expect(parsed.support).toBeUndefined()
  })

  it('rejects an unknown support kind', () => {
    expect(() =>
      ExtractedClaimSchema.parse({
        claim: 'c',
        driver: 'cli',
        sectionAnchor: 'x',
        reason: 'r',
        flavor: 'support',
        support: { kind: 'protocol', subject: 'HTTP/2' },
      }),
    ).toThrow()
  })
})
