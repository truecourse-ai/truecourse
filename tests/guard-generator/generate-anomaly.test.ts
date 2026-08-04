import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { GenerateRunner } from '@truecourse/guard-generator'
import { readManifest, loadScenarios } from '@truecourse/guard-runner'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeApiRecipe,
  writeDoc,
  writeCorpus,
  raw,
  rawApi,
  extractBy,
  authorBy,
  runGenerate,
  journeysOf,
  cliJourney,
  apiJourney,
  flowOfAll,
  faithfulReviewer,
  stampMilestones,
} from './helpers.js'

const FIXTURE_API_INERT = fileURLToPath(new URL('../fixtures/guard-fixture-api/server-inert.mjs', import.meta.url))

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

const DOC = 'docs/cli.md'

/** A doc with `n` sibling sections, each stating one exit-0 behavior. */
function manySections(n: number): string {
  return Array.from({ length: n }, (_, i) => [`## s${String(i).padStart(2, '0')}`, 'the command exits 0.'].join('\n')).join(
    '\n\n',
  )
}

/**
 * A no-op entry that PASSES pre-flight (it prints usage for the probes: no-args,
 * `--help`, `--version`) but does nothing for any real command — exit 0, no output.
 * That is exactly the entry the anomaly gate must catch after pre-flight lets it by.
 */
function writeSilentEntry(r: string, rel = 'silent.mjs'): void {
  fs.writeFileSync(
    path.join(r, rel),
    [
      'const a = process.argv[2]',
      "if (a === undefined || a === '--help' || a === '--version') process.stdout.write('usage: silent\\n')",
      'process.exit(0)',
      '',
    ].join('\n'),
  )
}

describe('generateGuards — no-op recipe anomaly abort (cli)', () => {
  it('aborts as recipe-failed, writes nothing, and spends NO retry/fidelity calls', async () => {
    const r = repo()
    writeRecipe(r, { build: 'true', entry: ['node', 'silent.mjs'] })
    writeSilentEntry(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, manySections(22))

    let authorCalls = 0
    let retryCalls = 0
    const gen: GenerateRunner = async (ctx) => {
      authorCalls++
      if (ctx.retry) retryCalls++
      // A real command the silent entry ignores: exit 0, no output, instant.
      return { scenario: stampMilestones(raw(ctx.flow.title, [{ run: ['do'], expect: { exit: 0 } }]), ctx.milestones.length) }
    }
    let fidelityCalls = 0

    const res = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, cliJourney(['silent'])),
      extractRunner: extractBy({}),
      generateRunner: gen,
      fidelityRunner: faithfulReviewer(() => fidelityCalls++),
      // A generous threshold so node's ~40ms startup does not disqualify the no-op
      // steps — the test targets the ABORT orchestration, not sub-10ms real timing.
      noOpThresholdMs: 100_000,
    })

    // Aborted loudly as a recipe failure — naming the entry and the counts.
    expect(res.status).toBe('recipe-failed')
    expect(res.reason).toContain('silent.mjs')
    expect(res.reason).toContain('do-nothing')
    expect(res.reason).toMatch(/22 of 22/)

    // Nothing written, no findings, no partial persistence — the abort happens
    // before the persist stage, so rollback is by construction.
    expect(res.written).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(loadScenarios(r).scenarios).toEqual([])
    expect(readManifest(r)).toBeNull()

    // Round-1 authoring ran once per flow; NO retry, and fidelity never fired.
    expect(authorCalls).toBe(22)
    expect(retryCalls).toBe(0)
    expect(fidelityCalls).toBe(0)
  })

  it('does NOT abort when the entry produces output (a healthy CLI at scale)', async () => {
    // relkit `--version` writes output → no step is a no-op → the gate never trips,
    // even with well over the minimum sample of scenarios.
    const r = repo()
    writeRecipe(r) // default fixture entry (relkit)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, manySections(22))

    let fidelityCalls = 0
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: authorBy({}),
      fidelityRunner: faithfulReviewer(() => fidelityCalls++),
      noOpThresholdMs: 100_000,
    })

    expect(res.status).toBe('ok')
    expect(res.written).toHaveLength(22)
    expect(fidelityCalls).toBe(22) // the pipeline ran to completion, no abort
  })
})

describe('generateGuards — dead-stub anomaly abort (api)', () => {
  const API_DOC = 'docs/api.md'
  const API_DOC_CONTENT = [
    '## alpha',
    'GET /alpha answers the alpha resource.',
    '',
    '## beta',
    'POST /beta records a beta event.',
  ].join('\n')

  it('aborts as recipe-failed when every route answers the same empty status', async () => {
    const r = repo()
    // The inert fixture: boots, health-checks, then 404s EVERYTHING with an empty
    // body — the dead stub the boot preflight cannot catch.
    writeApiRecipe(r, { entry: null, serve: ['node', FIXTURE_API_INERT] })
    writeCorpus(r, [{ ref: API_DOC }])
    writeDoc(r, API_DOC, API_DOC_CONTENT)

    // One flow over both claims; the authored journey asserts the stub's uniform
    // 404 on both routes, so WITHOUT the gate all 20 steps would PASS and a green
    // corpus proving nothing would be committed.
    const steps = [
      ...Array.from({ length: 10 }, () => ({ request: { method: 'GET', path: '/alpha' }, expect: { status: 404 }, milestone: 1 })),
      ...Array.from({ length: 10 }, () => ({ request: { method: 'POST', path: '/beta', json: {} }, expect: { status: 404 }, milestone: 2 })),
    ]
    let fidelityCalls = 0
    const gen: GenerateRunner = async () => ({ scenario: rawApi('alpha then beta', steps) })

    const res = await runGenerate({
      repoRoot: r,
      journeys: journeysOf(r, apiJourney('GET', '/alpha'), apiJourney('POST', '/beta')),
      extractRunner: extractBy({
        alpha: [{ driver: 'api', claim: 'GET /alpha answers the alpha resource', reason: 'HTTP status' }],
        beta: [{ driver: 'api', claim: 'POST /beta records a beta event', reason: 'HTTP status' }],
      }),
      flowsRunner: flowOfAll('alpha then beta'),
      generateRunner: gen,
      fidelityRunner: faithfulReviewer(() => fidelityCalls++),
    })

    expect(res.status).toBe('recipe-failed')
    expect(res.reason).toContain('dead stub')
    expect(res.reason).toMatch(/20 of 20/)
    expect(res.reason).toContain('status (404)')

    expect(res.written).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(loadScenarios(r).scenarios).toEqual([])
    expect(readManifest(r)).toBeNull()
    expect(fidelityCalls).toBe(0)
  })
})
