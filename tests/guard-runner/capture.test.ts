import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { loadScenarios, runGuard } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf, writeRecipe, writeScenario, scenario, specBinds } from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

/** The evidence bundle of one settled scenario, as its files. */
function evidence(r: string, evidencePath: string): { invocation: any; transcript: string } {
  const dir = path.join(r, evidencePath)
  return {
    invocation: JSON.parse(fs.readFileSync(path.join(dir, 'invocation.json'), 'utf-8')),
    transcript: fs.readFileSync(path.join(dir, 'transcript.txt'), 'utf-8'),
  }
}

describe('cli capture — a later step uses what an earlier step produced', () => {
  it('flows a captured value into a later step\'s argv, env, and expectation', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/chain.yaml',
      scenario({
        id: 'chain',
        binds: specBinds('cli/version'),
        steps: [
          {
            run: ['--version'],
            capture: { version: { pattern: '^(\\d+\\.\\d+\\.\\d+)' } },
            expect: { exit: 0 },
          },
          // …into the ARGV of a later step (the file it writes is named by it) and
          // into that step's EXPECTATION — both the asserted path and its content.
          {
            run: ['note', 'rel-${captured:version}.txt', 'shipped ${captured:version}'],
            expect: {
              exit: 0,
              stdout: { contains: 'rel-2.4.1.txt' },
              files: { 'rel-${captured:version}.txt': { equals: 'shipped 2.4.1' } },
            },
          },
          // …and into a later step's ENV overlay.
          {
            run: ['env', 'RELKIT_TAG'],
            env: { RELKIT_TAG: 'v${captured:version}' },
            expect: { exit: 0, stdout: { equals: 'RELKIT_TAG=v2.4.1\n' } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = res.latest.scenarios.find((s) => s.id === 'chain')!
    expect(result.failure).toBeUndefined()
    expect(result.outcome).toBe('pass')

    // The transcript records what each step captured, so a failure downstream is
    // diagnosable from the bundle alone.
    const { invocation, transcript } = evidence(r, result.evidencePath!)
    expect(invocation.steps[0].captured).toEqual({ version: '2.4.1' })
    expect(transcript).toContain('capture: {"version":"2.4.1"}')
    // The argv/env in evidence are the RESOLVED ones — what the child actually saw.
    expect(invocation.steps[1].argv).toContain('rel-2.4.1.txt')
    expect(invocation.steps[2].env).toEqual({ RELKIT_TAG: 'v2.4.1' })
  })

  it('a capture that does not match fails ITS OWN step, with the output as evidence', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/miss.yaml',
      scenario({
        id: 'miss',
        binds: specBinds('cli/version'),
        steps: [
          {
            run: ['--version'],
            capture: { build: { pattern: 'build (\\w+)' } },
            expect: { exit: 0 },
          },
          // Never reached: the capture miss stops the scenario at step 1.
          { run: ['note', '${captured:build}.txt', 'x'], expect: { exit: 0 } },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    expect(res.status).toBe('ok')
    if (res.status !== 'ok') return
    const result = res.latest.scenarios.find((s) => s.id === 'miss')!
    expect(result.outcome).toBe('fail')
    expect(result.failure!.step).toBe(1)
    expect(result.failure!.expected).toContain('capture "build"')
    expect(result.failure!.expected).toContain('build (\\w+)')
    // The output that failed to yield the value rides the failure.
    expect(result.failure!.stdout).toContain('2.4.1')

    const { invocation } = evidence(r, result.evidencePath!)
    expect(invocation.steps).toHaveLength(1)
  })

  it('captures from stderr and from the combined output when the step says so', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/streams.yaml',
      scenario({
        id: 'streams',
        binds: specBinds('cli/version'),
        steps: [
          {
            run: ['warn'],
            capture: {
              skipped: { pattern: 'skipped (\\S+) ', from: 'stderr' },
              scanned: { pattern: 'scanned (\\d+) files', from: 'output' },
            },
            expect: { exit: 0 },
          },
          {
            run: ['note', 'r.txt', '${captured:scanned} files, skipped ${captured:skipped}'],
            expect: { exit: 0, files: { 'r.txt': { equals: '3 files, skipped bulk.js' } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('run did not settle')
    const result = res.latest.scenarios.find((s) => s.id === 'streams')!
    expect(result.failure).toBeUndefined()
    expect(result.outcome).toBe('pass')
  })

  it('captures the RAW stream — a normalizer must not eat the value a scenario carries', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/raw.yaml',
      scenario({
        id: 'raw',
        binds: specBinds('cli/version'),
        // `versions` rewrites `2.4.1` in every COMPARED string; the capture still
        // sees what the program actually printed.
        normalize: ['versions'],
        steps: [
          { run: ['--version'], capture: { v: { pattern: '^(\\d+\\.\\d+\\.\\d+)' } }, expect: { exit: 0 } },
          { run: ['note', 'v.txt', '${captured:v}'], expect: { exit: 0 } },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('run did not settle')
    const result = res.latest.scenarios.find((s) => s.id === 'raw')!
    expect(result.outcome).toBe('pass')
    const { invocation } = evidence(r, result.evidencePath!)
    expect(invocation.steps[0].captured).toEqual({ v: '2.4.1' })
  })
})

describe('cli comparison — a captured number is assertable', () => {
  it('at-least, at-most and equals all hold against a captured value', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/compare.yaml',
      scenario({
        id: 'compare',
        binds: specBinds('cli/version'),
        steps: [
          { run: ['tick'], capture: { first: { pattern: 'tick (\\d+)' } }, expect: { exit: 0 } },
          {
            run: ['tick'],
            expect: {
              exit: 0,
              stdout: { compare: { number: 'tick (\\d+)', atLeast: '${captured:first}' } },
            },
          },
          {
            run: ['tick'],
            expect: {
              exit: 0,
              stdout: { compare: { number: 'tick (\\d+)', atMost: 3, atLeast: 3, equals: 3 } },
            },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('run did not settle')
    const result = res.latest.scenarios.find((s) => s.id === 'compare')!
    expect(result.failure).toBeUndefined()
    expect(result.outcome).toBe('pass')
  })

  it('an at-most that is exceeded fails showing BOTH numbers', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/over-budget.yaml',
      scenario({
        id: 'over-budget',
        binds: specBinds('cli/version'),
        steps: [
          { run: ['tick'], capture: { estimate: { pattern: 'tick (\\d+)' } }, expect: { exit: 0 } },
          {
            run: ['tick'],
            expect: { exit: 0, stdout: { compare: { number: 'tick (\\d+)', atMost: '${captured:estimate}' } } },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('run did not settle')
    const result = res.latest.scenarios.find((s) => s.id === 'over-budget')!
    expect(result.outcome).toBe('fail')
    expect(result.failure!.step).toBe(2)
    // The RESOLVED expectation, not the token — a reader sees the two numbers.
    expect(result.failure!.expected).toContain('at most 1')
    expect(result.failure!.actual).toContain('2')
    const { transcript } = evidence(r, result.evidencePath!)
    expect(transcript).toContain('at most 1')
  })

  it('a comparison BESIDE a text matcher is still evaluated — a holding half never ends the check', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/both-halves.yaml',
      scenario({
        id: 'both-halves',
        binds: specBinds('cli/version'),
        steps: [
          {
            run: ['tick'],
            // `contains` holds; the comparison beside it does not. One assertion in
            // two halves — reporting green here would prove nothing about the number.
            expect: {
              exit: 0,
              stdout: { contains: 'tick', compare: { number: 'tick (\\d+)', atMost: 0 } },
            },
          },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('run did not settle')
    const result = res.latest.scenarios.find((s) => s.id === 'both-halves')!
    expect(result.outcome).toBe('fail')
    expect(result.failure!.expected).toContain('at most 0')
  })

  it('a subject that carries no number is a mismatch quoting the raw text, never NaN', async () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/not-a-number.yaml',
      scenario({
        id: 'not-a-number',
        binds: specBinds('cli/version'),
        steps: [
          { run: ['whoami'], expect: { exit: 0, stdout: { compare: { number: 'tz=(\\S+)', atMost: 10 } } } },
        ],
      }),
    )

    const res = await runGuard({ repoRoot: r, skipBuild: true })
    if (res.status !== 'ok') throw new Error('run did not settle')
    const result = res.latest.scenarios.find((s) => s.id === 'not-a-number')!
    expect(result.outcome).toBe('fail')
    expect(result.failure!.actual).toContain('UTC')
    expect(result.failure!.actual).toContain('not a number')
  })
})

describe('capture cross-checks — loud at load, never a run-time surprise', () => {
  const step = (over: Record<string, unknown>): any => ({ run: ['--version'], expect: { exit: 0 }, ...over })

  it('a duplicate capture name is a load error', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/dup.yaml',
      scenario({
        id: 'dup',
        steps: [
          step({ capture: { v: { pattern: '(\\d+)' } } }),
          step({ capture: { v: { pattern: '(\\d+)' } } }),
        ],
      }),
    )

    const { errors } = loadScenarios(r)
    expect(errors).toHaveLength(1)
    expect(errors[0].file).toContain('dup.yaml')
    expect(errors[0].message).toContain('"v"')
    expect(errors[0].message).toContain('step 1')
  })

  it('a forward reference is a load error naming what IS available', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/forward.yaml',
      scenario({
        id: 'forward',
        steps: [
          step({ capture: { a: { pattern: '(\\d+)' } } }),
          step({ run: ['note', '${captured:b}.txt', 'x'] }),
          step({ capture: { b: { pattern: '(\\d+)' } } }),
        ],
      }),
    )

    const { errors } = loadScenarios(r)
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('step 2')
    expect(errors[0].message).toContain('${captured:b}')
    expect(errors[0].message).toContain('${captured:a}')
  })

  it('a self reference is a load error — order matters', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/self.yaml',
      scenario({
        id: 'self',
        steps: [
          step({
            capture: { n: { pattern: 'tick (\\d+)' } },
            expect: { exit: 0, stdout: { contains: '${captured:n}' } },
          }),
        ],
      }),
    )

    const { errors } = loadScenarios(r)
    expect(errors).toHaveLength(1)
    expect(errors[0].message).toContain('captures itself')
  })

  it('a scenario whose captures compose loads clean', () => {
    const r = repo()
    writeRecipe(r)
    writeScenario(
      r,
      'cli/ok.yaml',
      scenario({
        id: 'ok',
        steps: [step({ capture: { v: { pattern: '(\\d+)' } } }), step({ run: ['note', '${captured:v}', 'x'] })],
      }),
    )

    const { scenarios, errors } = loadScenarios(r)
    expect(errors).toEqual([])
    expect(scenarios).toHaveLength(1)
  })
})
