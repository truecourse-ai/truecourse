/**
 * Item 8 — the invariant runner: a scenario with `inputs.pack` runs its steps ONCE
 * PER corpus file (fresh sandbox each), a failing file NAMES itself in the failure
 * (that file is the repro) and one bad file fails the sweep, an orphaned pack fails
 * LOUD, per-file progress ticks, and the two property forms — `stableOnRerun`
 * (determinism / in-place idempotence) and `stdinFromStep` (step-chaining) — hold.
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
  runScenario,
  resolveEntry,
  writePack,
  type RunScenarioContext,
} from '@truecourse/guard-runner'
import type { GuardPackManifest } from '@truecourse/shared'
import { makeTempRepo, rmrf, writeSpecDoc, scenario, FIXTURE_BIN } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  writeSpecDoc(r)
  repos.push(r)
  return r
}

function ctxFor(r: string, overrides: Partial<RunScenarioContext> = {}): RunScenarioContext {
  return {
    repoRoot: r,
    runId: 'test-run',
    resolvedEntry: resolveEntry(r, ['node', FIXTURE_BIN]),
    stepTimeoutMs: 10_000,
    capturePassEvidence: false,
    ...overrides,
  }
}

/** Seed a pack of input files (names → content) with a minimal manifest. */
function seedPack(r: string, pack: string, files: Record<string, string>): void {
  const manifest: GuardPackManifest = {
    pack,
    provenance: 'test',
    files: Object.keys(files).map((name) => ({ name, source: 'seed' })),
  }
  writePack(r, manifest, files)
}

describe('runScenario — invariant sweep over an input pack (item 8)', () => {
  it('runs the steps once per corpus file and passes when every file holds the rule', async () => {
    const r = repo()
    seedPack(r, 'inv-json', { 's1.json': '{"a":1}\n', 's2.json': '{"b":2}\n', 's3.json': '{"c":3}\n' })
    const ticks: Array<[number, number]> = []
    const res = await runScenario(
      scenario({ id: 'valid.1', inputs: { pack: 'inv-json', as: 'input' }, steps: [{ run: ['parse', 'input'], expect: { exit: 0 } }] }),
      ctxFor(r, { onInput: (done, total) => ticks.push([done, total]) }),
    )
    expect(res.outcome).toBe('pass')
    // Per-file progress ticked 0 → 3 across the three inputs (counters, no bars).
    expect(ticks).toEqual([[0, 3], [1, 3], [2, 3], [3, 3]])
  })

  it('names the failing corpus file and fails the whole scenario on one bad input', async () => {
    const r = repo()
    // s2 is invalid JSON — `parse` exits 5, so the exit-0 expectation fails on it.
    seedPack(r, 'inv-mixed', { 's1.json': '{"ok":1}\n', 's2.json': '{bad json\n', 's3.json': '{"ok":3}\n' })
    const res = await runScenario(
      scenario({ id: 'mixed.1', inputs: { pack: 'inv-mixed', as: 'input' }, steps: [{ run: ['parse', 'input'], expect: { exit: 0 } }] }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('fail')
    expect(res.failure!.input).toBe('s2.json')
    expect(res.failure!.actual).toContain('s2.json')
    // The failing program's raw stderr rode along (the usage error it printed).
    expect(res.failure!.stderr).toContain('not valid JSON')
  })

  it('fails LOUD when the referenced pack is missing — never a silent skip', async () => {
    const r = repo()
    const res = await runScenario(
      scenario({ id: 'ghost.1', inputs: { pack: 'ghost', as: 'input' }, steps: [{ run: ['parse', 'input'], expect: { exit: 0 } }] }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('error')
    expect(res.failure!.actual).toContain('ghost')
    expect(res.failure!.actual).toMatch(/not found/)
  })

  it('stableOnRerun passes for an idempotent in-place fix over the whole pack', async () => {
    const r = repo()
    seedPack(r, 'inv-fmt', { 's1.json': '{"a":1,"b":2}\n', 's2.json': '{"x":9}\n' })
    const res = await runScenario(
      scenario({
        id: 'idem.1',
        inputs: { pack: 'inv-fmt', as: 'input' },
        steps: [{ run: ['normalize', 'input'], expect: { exit: 0 }, stableOnRerun: true }],
      }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('pass')
  })

  it('stableOnRerun fails when the step output is not deterministic (stdout differs)', async () => {
    const r = repo()
    // `tick` prints an incrementing counter — its stdout differs run to run.
    const res = await runScenario(
      scenario({ id: 'unstable.1', steps: [{ run: ['tick'], expect: { exit: 0 }, stableOnRerun: true }] }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('fail')
    expect(res.failure!.expected).toMatch(/identical stdout on re-run/)
  })

  it('stableOnRerun fails and names the file when a fix is NOT idempotent (input keeps changing)', async () => {
    const r = repo()
    seedPack(r, 'inv-bump', { 'only.json': '{"a":1}\n' })
    const res = await runScenario(
      scenario({
        id: 'nonidem.1',
        inputs: { pack: 'inv-bump', as: 'input' },
        steps: [{ run: ['bump', 'input'], expect: { exit: 0 }, stableOnRerun: true }],
      }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('fail')
    expect(res.failure!.input).toBe('only.json')
    expect(res.failure!.actual).toContain('changed on the second run')
  })

  it('step-chaining: the fmt output re-parses clean (stdout of step 1 → stdin of step 2)', async () => {
    const r = repo()
    seedPack(r, 'inv-chain', { 's1.json': '{"a":1,"b":2}\n', 's2.json': '[1,2,3]\n' })
    const res = await runScenario(
      scenario({
        id: 'chain.1',
        inputs: { pack: 'inv-chain', as: 'input' },
        steps: [
          { run: ['fmt', 'input'], expect: { exit: 0 } },
          { run: ['parse'], stdinFromStep: 1, expect: { exit: 0, stdout: { contains: 'valid' } } },
        ],
      }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('pass')
  })

  it('rejects a forward/self stdinFromStep reference as a loud error', async () => {
    const r = repo()
    const res = await runScenario(
      scenario({ id: 'badchain.1', steps: [{ run: ['parse'], stdinFromStep: 1, expect: { exit: 0 } }] }),
      ctxFor(r),
    )
    expect(res.outcome).toBe('error')
    expect(res.failure!.actual).toContain('stdinFromStep')
  })
})
