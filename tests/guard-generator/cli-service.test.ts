/**
 * The cli MANAGED-SERVICE authoring surface: the `boot`/`signal`/`logs` step
 * shapes validate through the authored-scenario schema, the cli system prompt
 * teaches WHEN to reach for them (and the exact syntax), composition covers a
 * boot's argv head, and an authored service scenario births green against the
 * relkit fixture's real long-running monitor.
 */

import { describe, it, expect, afterEach } from 'vitest'
import {
  GENERATE_SYSTEM_PROMPT,
  GENERATE_API_SYSTEM_PROMPT,
  RawGeneratedScenarioSchema,
  cliCompositionDefect,
  type RawGeneratedScenario,
} from '@truecourse/guard-generator'
import { loadScenarios } from '@truecourse/guard-runner'
import type { GuardCliStep } from '@truecourse/shared'
import {
  makeTempRepo,
  rmrf,
  writeRecipe,
  writeDoc,
  writeCorpus,
  raw,
  extractBy,
  authorBy,
  runGenerate,
} from './helpers.js'

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
})
function repo(): string {
  const r = makeTempRepo()
  repos.push(r)
  return r
}

const SERVICE_STEPS: GuardCliStep[] = [
  { boot: { run: ['serve'], ready: { stream: 'stdout', match: 'relkit monitor listening' } } },
  { run: ['status'], expect: { exit: 0, stdout: { contains: 'monitor is running' } } },
  { signal: { name: 'SIGTERM', expect: { exitCode: 0 } } },
]

describe('cli service steps — authored schema', () => {
  it('accepts boot/signal/logs steps in an authored cli scenario', () => {
    const parsed = RawGeneratedScenarioSchema.parse({
      title: 'the monitor starts and stops cleanly',
      driver: 'cli',
      steps: [
        { boot: { run: ['serve'], env: { LOG: '1' }, ready: { stream: 'stdout', match: 'listening' } }, milestone: 1 },
        { run: ['status'], expect: { exit: 0 }, milestone: 2 },
        { logs: { stream: 'stdout', match: { pattern: 'handled #\\d+' }, sinceLastStep: true, count: 1 } },
        { signal: { name: 'SIGTERM', expect: { exitCode: 0, withinMs: 5000 } }, milestone: 3 },
      ],
    })
    expect(parsed.steps).toHaveLength(4)
  })

  it('refuses a boot without a readiness line — a cli service has no health path', () => {
    expect(() =>
      RawGeneratedScenarioSchema.parse({
        title: 't',
        driver: 'cli',
        steps: [{ boot: { run: ['serve'] } }],
      }),
    ).toThrow()
  })

  it('refuses a boot that smuggles run-step fields', () => {
    expect(() =>
      RawGeneratedScenarioSchema.parse({
        title: 't',
        driver: 'cli',
        steps: [{ boot: { run: ['serve'], ready: { stream: 'stdout', match: 'x' } }, expect: { exit: 0 } }],
      }),
    ).toThrow()
  })

  it('run-only scenarios parse exactly as before (additive, no format bump)', () => {
    const parsed = RawGeneratedScenarioSchema.parse({
      title: 't',
      driver: 'cli',
      steps: [{ run: ['--version'], expect: { exit: 0 } }],
    })
    expect(parsed.steps).toEqual([{ run: ['--version'], expect: { exit: 0 } }])
  })
})

describe('cli service steps — the authoring prompt', () => {
  it('teaches the service shape: when to reach for it and the exact step syntax', () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain('# A long-running SERVICE is drivable')
    // WHEN: the milestones speak of starting/staying up/stopping/tailing.
    expect(GENERATE_SYSTEM_PROMPT).toContain('a command that KEEPS RUNNING')
    expect(GENERATE_SYSTEM_PROMPT).toContain('a command that runs\nto completion stays an ordinary \`run\` step')
    // The syntax, verbatim shapes.
    expect(GENERATE_SYSTEM_PROMPT).toContain('"ready": { "stream": "stdout", "match": "listening" }')
    expect(GENERATE_SYSTEM_PROMPT).toContain('"signal": { "name": "SIGTERM" | "SIGINT"')
    expect(GENERATE_SYSTEM_PROMPT).toContain('"sinceLastStep": true')
    // The boundary the other way: a command that exits stays a `run` step.
    expect(GENERATE_SYSTEM_PROMPT).toContain('never a \`boot\`')
  })

  it('the api authoring prompt is untouched by the cli service vocabulary', () => {
    // The api boot has a health path and needs no readiness matcher — the cli
    // shape must not leak into it.
    expect(GENERATE_API_SYSTEM_PROMPT).not.toContain('"ready": { "stream"')
    expect(GENERATE_API_SYSTEM_PROMPT).not.toContain('A long-running SERVICE is drivable')
  })
})

describe('cli service steps — composition', () => {
  it('flags a boot whose argv head repeats the entrypoint or names a foreign binary', () => {
    const entry = ['node', 'bin.mjs']
    const foreign = cliCompositionDefect(
      [{ boot: { run: ['npm', 'start'], ready: { stream: 'stdout', match: 'x' } } }] as GuardCliStep[],
      entry,
    )
    expect(foreign).toContain('boot.run[0]')
    expect(foreign).toContain('foreign binary')
    const repeats = cliCompositionDefect(
      [{ boot: { run: ['bin.mjs', 'serve'], ready: { stream: 'stdout', match: 'x' } } }] as GuardCliStep[],
      entry,
    )
    expect(repeats).toContain('boot.run[0]')
    expect(repeats).toContain('repeats the entrypoint')
  })

  it('a clean service scenario composes', () => {
    expect(cliCompositionDefect(SERVICE_STEPS, ['node', 'bin.mjs'])).toBeNull()
  })
})

describe('cli service steps — authored end-to-end', () => {
  it('an authored service scenario births green against the fixture monitor and is committed', async () => {
    const r = repo()
    writeRecipe(r)
    writeCorpus(r, [{ ref: 'docs/monitor.md' }])
    writeDoc(
      r,
      'docs/monitor.md',
      ['## monitor', '`relkit serve` starts the monitor, `status` checks it, SIGTERM stops it cleanly.'].join('\n'),
    )
    const res = await runGenerate({
      repoRoot: r,
      extractRunner: extractBy({}),
      generateRunner: authorBy({
        monitor: raw('The monitor starts, answers a health check, and stops cleanly', [
          { ...SERVICE_STEPS[0], milestone: 1 },
          { ...SERVICE_STEPS[1], milestone: 1 },
          { ...SERVICE_STEPS[2], milestone: 1 },
        ] as RawGeneratedScenario['steps']),
      }),
    })
    expect(res.written.map((w) => w.flowId)).toEqual(['monitor'])
    expect(res.birthFindings).toEqual([])
    // The committed corpus carries the service steps as authored.
    const committed = loadScenarios(r).scenarios.find((s) => s.id === 'monitor.cli.1')!
    expect(committed.steps[0]).toMatchObject({
      boot: { run: ['serve'], ready: { stream: 'stdout', match: 'relkit monitor listening' } },
    })
  })
})
