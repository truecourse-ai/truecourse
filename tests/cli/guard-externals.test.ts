/**
 * `truecourse guard externals` — the READ-ONLY view of this repo's third parties.
 *
 * Interactive provisioning moved into `truecourse guard setup`, so what this command
 * owns is rendering: one line per service, the state, and the unmet requirements.
 * The WRITE half it used to drive (`writeGuardExternals` — the committed-declaration
 * vs gitignored-secret split) is engine code and stays covered where it lives, in
 * `tests/core/guard-externals.test.ts`.
 *
 * The detection SOURCE is the interesting change here: it is `guard/setup.json` now,
 * so the page is populated before the first (expensive) generate, with the generate
 * report kept as the fallback for a repo that predates setup.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { recipePath } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf } from '../guard-runner/helpers.js'

// Hoisted so the module factory below can reach it (vi.mock is hoisted above every
// other statement in the file).
const { out } = vi.hoisted(() => ({ out: [] as string[] }))

// Mocked through the CLI's own copy: pnpm keeps `@clack/prompts` under
// `tools/cli/node_modules`, so the bare specifier does not resolve from this file
// and the mock would silently miss.
vi.mock('../../tools/cli/node_modules/@clack/prompts', () => {
  const say = (msg?: unknown) => {
    out.push(String(msg ?? ''))
  }
  return {
    intro: say,
    outro: say,
    cancel: say,
    note: (body: string, title: string) => out.push(`${title}\n${body}`),
    log: { info: say, step: say, message: say, warn: say, error: say, success: say },
    // A prompt is a bug now: this command has no interactive path left.
    select: async () => {
      throw new Error('guard externals must never prompt')
    },
    text: async () => {
      throw new Error('guard externals must never prompt')
    },
    password: async () => {
      throw new Error('guard externals must never prompt')
    },
    confirm: async () => {
      throw new Error('guard externals must never prompt')
    },
    isCancel: (v: unknown) => typeof v === 'symbol',
  }
})

const { runGuardExternals } = await import('../../tools/cli/src/commands/guard-externals')

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
  out.length = 0
  vi.restoreAllMocks()
})

/** A repo with a minimal, VALID api recipe — externals declare onto its `api` block. */
function repo(api: Record<string, unknown> | null = { serve: ['node', 'dist/index.js'] }): string {
  const dir = makeTempRepo()
  repos.push(dir)
  const file = recipePath(dir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    JSON.stringify(
      { build: 'npm run build', ...(api ? { api } : { entry: ['node', 'cli.js'] }) },
      null,
      2,
    ) + '\n',
  )
  return dir
}

/** A `guard setup` record whose only content is the detection under test. */
function writeSetupDetection(r: string, ...services: Record<string, unknown>[]): void {
  const file = path.join(r, '.truecourse', 'guard', 'setup.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        ranAt: '2026-07-31T00:00:00Z',
        status: 'ok',
        recipe: { status: 'ok', outcome: 'exists' },
        detection: { externalServices: services, database: null, datastoreUrls: [] },
      },
      null,
      2,
    ) + '\n',
  )
}

/** The legacy source: detection recorded by a `guard generate` report. */
function writeGenerateDetection(r: string, ...services: Record<string, unknown>[]): void {
  const file = path.join(r, '.truecourse', 'guard', 'result.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        generatedAt: '2026-07-28T00:00:00Z',
        status: 'ok',
        noChanges: false,
        sectionsTotal: 0,
        sectionsChanged: 0,
        skippedUnchanged: 0,
        written: [],
        coverageGaps: [],
        birthFindings: [],
        errors: [],
        extractionFailures: [],
        orphaned: [],
        externalServices: services,
      },
      null,
      2,
    ) + '\n',
  )
}

const text = (): string => out.join('\n')

describe('guard externals — the read-only view', () => {
  it('lists a declared service with its state and unmet requirement', async () => {
    const r = repo({
      serve: ['node', 'dist/index.js'],
      externals: { stripe: { baseUrlEnv: 'STRIPE_BASE_URL', env: { STRIPE_API_KEY: {} } } },
    })

    await runGuardExternals({ cwd: r, list: true })

    expect(text()).toContain('stripe')
    expect(text()).toContain('unprovided')
    expect(text()).toContain('no detection yet')
  })

  it('renders a provided account with its mode and origin', async () => {
    const r = repo({
      serve: ['node', 'dist/index.js'],
      externals: {
        stripe: { baseUrlEnv: 'STRIPE_BASE_URL', baseUrl: 'https://sandbox.stripe.test', mode: 'sandbox' },
      },
    })

    await runGuardExternals({ cwd: r })

    expect(text()).toContain('stripe')
    expect(text()).toContain('provided')
    expect(text()).toContain('sandbox @ https://sandbox.stripe.test')
  })

  it('says nothing is known when neither detection nor a declaration exists', async () => {
    await runGuardExternals({ cwd: repo(), list: true })

    expect(text()).toContain('No detection yet')
    expect(text()).toContain('truecourse guard setup')
  })

  // Detection is SETUP's, not generate's — the whole point being that this
  // page works before a single extraction call has been paid for.
  it('shows a detected-but-undeclared service from the `guard setup` record alone', async () => {
    const r = repo()
    writeSetupDetection(r, {
      service: 'open-meteo',
      source: 'http',
      evidence: [{ filePath: 'src/config.ts', url: 'https://api.open-meteo.com' }],
      baseUrlEnv: 'FORECAST_BASE_URL',
    })

    await runGuardExternals({ cwd: r, list: true })

    expect(text()).toContain('open-meteo')
    expect(text()).toContain('not declared in recipe.json')
    expect(text()).not.toContain('no detection yet')
  })

  // A repo that generated before setup existed keeps its detection: the fallback is
  // what stops the page going blank on an upgrade.
  it('falls back to the generate report when no setup record exists', async () => {
    const r = repo()
    writeGenerateDetection(r, {
      service: 'stripe',
      category: 'payment',
      evidence: [{ filePath: 'src/pay.ts', importSource: 'stripe' }],
    })

    await runGuardExternals({ cwd: r, list: true })

    expect(text()).toContain('stripe')
    expect(text()).not.toContain('no detection yet')
  })

  it('never prompts, with or without --list', async () => {
    const r = repo()
    // The mocked prompts throw; reaching either call would fail the test.
    await runGuardExternals({ cwd: r })
    await runGuardExternals({ cwd: r, list: true })

    expect(text()).toContain('truecourse guard setup')
  })
})
