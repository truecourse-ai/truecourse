import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { generateGuards, type GenerateRunner } from '@truecourse/guard-generator'
import { readManifest, loadScenarios } from '@truecourse/guard-runner'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  authorBy,
  faithfulReviewer,
  PASSING_STEPS,
} from './helpers.js'
import { stubAuxRunners } from './helpers.js'

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
const ONE_SECTION = ['## version', '`relkit --version` prints the version and exits 0.'].join('\n')

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

/** 20 passing scenarios (each asserts exit 0, which the silent no-op satisfies). */
function twentyPassing(): ReturnType<typeof raw>[] {
  return Array.from({ length: 20 }, (_, i) => raw(`noop ${i}`, [{ run: ['do', String(i)], expect: { exit: 0 } }]))
}

describe('generateGuards — no-op recipe anomaly abort', () => {
  it('aborts as recipe-failed, writes nothing, and spends NO retry calls', async () => {
    const r = repo()
    writeRecipe(r, { build: 'true', entry: ['node', 'silent.mjs'] })
    writeSilentEntry(r)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, ONE_SECTION)

    let authorCalls = 0
    let retryCalls = 0
    const gen: GenerateRunner = async (ctx) => {
      authorCalls++
      if (ctx.claims.some((c) => c.retry)) retryCalls++
      return ctx.claims.map((c) => ({ ref: c.ref, scenarios: twentyPassing() }))
    }
    let fidelityCalls = 0
    const fidelity = faithfulReviewer(() => fidelityCalls++)

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: gen,
      fidelityRunner: fidelity,
      // A generous threshold so node's ~40ms startup does not disqualify the no-op
      // steps — the test targets the ABORT orchestration, not sub-10ms real timing.
      noOpThresholdMs: 100_000,
    })

    // Aborted loudly as a recipe failure — naming the entry and the counts.
    expect(res.status).toBe('recipe-failed')
    expect(res.reason).toContain('node silent.mjs')
    expect(res.reason).toContain('do-nothing')
    expect(res.reason).toMatch(/20 of 20/)

    // Nothing written, no findings, no partial persistence.
    expect(res.written).toEqual([])
    expect(res.birthFindings).toEqual([])
    expect(loadScenarios(r).scenarios).toEqual([])
    expect((readManifest(r)?.sections ?? []).some((s) => s.anchor === 'version')).toBe(false)

    // The round-1 authoring ran ONCE; NO retry — the abort fires before any retry is
    // dispatched, and every later section short-circuits. Fidelity runs CONCURRENTLY
    // with the birth that trips the anomaly (item 16), so the racing section's reviews
    // are spent — an accepted cost of parallel fidelity; the abort still prevents any
    // retry round and any later-section spend.
    expect(authorCalls).toBe(1)
    expect(retryCalls).toBe(0)
    expect(fidelityCalls).toBe(20)
  })

  it('does NOT abort when the entry produces output (a healthy CLI at scale)', async () => {
    // relkit `--version` writes output → no step is a no-op → the gate never trips,
    // even with well over the minimum sample of scenarios.
    const r = repo()
    writeRecipe(r) // default fixture entry (relkit)
    writeCorpus(r, [{ ref: DOC, areaTags: ['tools/relkit'] }])
    writeDoc(r, DOC, ONE_SECTION)

    const twentyTwo = Array.from({ length: 22 }, (_, i) => raw(`v${i}`, PASSING_STEPS))
    let fidelityCalls = 0

    const res = await generateGuards({
      ...stubAuxRunners(),
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: authorBy({ version: twentyTwo }),
      fidelityRunner: faithfulReviewer(() => fidelityCalls++),
    })

    expect(res.status).toBe('ok')
    expect(res.written).toHaveLength(22)
    expect(fidelityCalls).toBe(22) // the pipeline ran to completion, no abort
    expect(readManifest(r)!.sections.find((s) => s.anchor === 'version')!.scenarioIds).toHaveLength(22)
  })
})
