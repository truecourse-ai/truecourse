/**
 * `truecourse guard externals` — the interactive provisioning of a third party's
 * account (item 62), plus its read-only fallback.
 *
 * The prompts are scripted (a mocked `@clack/prompts`: every `select`/`text`/
 * `password`/`confirm` pops the next scripted answer, and a `Symbol` answer is a
 * CANCEL), so the whole flow runs against real files: what lands in the committed
 * `recipe.json` versus the gitignored `externals.local.json` is asserted on disk,
 * which is the split the command exists to get right.
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { recipePath, externalsLocalPath } from '@truecourse/guard-runner'
import { makeTempRepo, rmrf } from '../guard-runner/helpers.js'

// Hoisted so the module factory below can reach them (vi.mock is hoisted above
// every other statement in the file).
const { out, answers } = vi.hoisted(() => ({ out: [] as string[], answers: [] as unknown[] }))

// Mocked through the CLI's own copy: pnpm keeps `@clack/prompts` under
// `tools/cli/node_modules`, so the bare specifier does not resolve from this file
// and the mock would silently miss (the real prompts would then block on stdin).
vi.mock('../../tools/cli/node_modules/@clack/prompts', () => {
  const say = (msg?: unknown) => {
    out.push(String(msg ?? ''))
  }
  const answer = (label: string): unknown => {
    if (answers.length === 0) throw new Error(`no scripted answer for prompt: ${label}`)
    return answers.shift()
  }
  return {
    intro: say,
    outro: say,
    cancel: say,
    note: (body: string, title: string) => out.push(`${title}\n${body}`),
    log: { info: say, step: say, message: say, warn: say, error: say, success: say },
    select: async (o: { message: string }) => answer(`select: ${o.message}`),
    text: async (o: { message: string }) => answer(`text: ${o.message}`),
    password: async (o: { message: string }) => answer(`password: ${o.message}`),
    confirm: async (o: { message: string }) => answer(`confirm: ${o.message}`),
    isCancel: (v: unknown) => typeof v === 'symbol',
  }
})

const { runGuardExternals } = await import('../../tools/cli/src/commands/guard-externals')

const CANCEL = Symbol('cancel')

const repos: string[] = []
afterEach(() => {
  while (repos.length) rmrf(repos.pop()!)
  out.length = 0
  answers.length = 0
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

/** A generate report whose ONLY content is the detection this test cares about. */
function writeDetectionReport(r: string, ...services: Record<string, unknown>[]): void {
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
const readJson = (file: string): Record<string, any> =>
  JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, any>

/** Run the command with `process.exit` mocked, returning the code it asked for. */
async function run(opts: Parameters<typeof runGuardExternals>[0]): Promise<number | undefined> {
  let exited: number | undefined
  const spy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exited = code
    throw new Error(`process.exit(${code})`)
  }) as never)
  try {
    await runGuardExternals(opts)
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith('process.exit(')) throw e
  } finally {
    spy.mockRestore()
  }
  return exited
}

describe('guard externals — the read-only view', () => {
  it('lists a declared service with its state and unmet requirement', async () => {
    const r = repo({
      serve: ['node', 'dist/index.js'],
      externals: { stripe: { baseUrlEnv: 'STRIPE_BASE_URL', env: { STRIPE_API_KEY: {} } } },
    })

    await run({ cwd: r, list: true })

    expect(text()).toContain('stripe')
    expect(text()).toContain('unprovided')
    expect(text()).toContain('detection has not run')
  })

  it('is the read path in a non-TTY, without --list and without prompting', async () => {
    const r = repo({
      serve: ['node', 'dist/index.js'],
      externals: {
        stripe: { baseUrlEnv: 'STRIPE_BASE_URL', baseUrl: 'https://sandbox.stripe.test', mode: 'sandbox' },
      },
    })

    // No scripted answers at all: a prompt would throw.
    await run({ cwd: r, interactive: false })

    expect(text()).toContain('stripe')
    expect(text()).toContain('provided')
    expect(text()).toContain('sandbox @ https://sandbox.stripe.test')
  })

  it('says nothing is known when neither detection nor a declaration exists', async () => {
    await run({ cwd: repo(), list: true })

    expect(text()).toContain('detection has not run')
  })
})

describe('guard externals — provisioning', () => {
  it('declares a new service, committing the declaration and storing the secret locally', async () => {
    const r = repo()
    answers.push(
      '\0new', // which service
      'stripe', // name
      'STRIPE_BASE_URL', // base url env
      'https://sandbox.stripe.test', // base url
      'sandbox', // mode
      'test-mode account', // description
      true, // add an env var?
      'STRIPE_API_KEY', // its name
      'secret', // where the value comes from
      'sk_test_abcd1234', // the value
      false, // add another?
      true, // write it?
    )

    await run({ cwd: r, interactive: true })

    // The DECLARATION is committed; the value is not (the `{}` shape means "the app
    // needs this variable, the value lives in the overlay").
    const recipe = readJson(recipePath(r))
    expect(recipe.api.externals.stripe).toEqual({
      baseUrlEnv: 'STRIPE_BASE_URL',
      baseUrl: 'https://sandbox.stripe.test',
      mode: 'sandbox',
      env: { STRIPE_API_KEY: {} },
      description: 'test-mode account',
    })
    expect(JSON.stringify(recipe)).not.toContain('sk_test_abcd1234')

    // The SECRET is in the gitignored overlay.
    expect(readJson(externalsLocalPath(r))).toEqual({
      stripe: { env: { STRIPE_API_KEY: 'sk_test_abcd1234' } },
    })

    // Fully resolved ⇒ provided, and the terminal never echoed the key.
    expect(text()).toContain('provided')
    expect(text()).not.toContain('sk_test_abcd1234')
    expect(text()).toContain('••••1234')
  })

  it('commits a shell-variable NAME rather than a value, and reports what is still missing', async () => {
    const r = repo()
    answers.push(
      '\0new',
      'open-meteo',
      'OPEN_METEO_BASE_URL',
      '', // no base URL yet
      '', // no mode
      '', // no description
      true,
      'OPEN_METEO_KEY',
      'from-env',
      'MY_OPEN_METEO_KEY', // the shell variable to read
      false,
      true,
    )

    await run({ cwd: r, interactive: true })

    expect(readJson(recipePath(r)).api.externals['open-meteo']).toEqual({
      baseUrlEnv: 'OPEN_METEO_BASE_URL',
      env: { OPEN_METEO_KEY: { valueFromEnv: 'MY_OPEN_METEO_KEY' } },
    })
    // No values anywhere ⇒ no overlay file at all.
    expect(fs.existsSync(externalsLocalPath(r))).toBe(false)
    expect(text()).toContain('no base URL provided')
  })

  // Item 63: an HTTP-detected vendor reached through two hosts has TWO override
  // variables. The base-URL field takes the first; the loop must OFFER the second by
  // name, or a user who answers every question still leaves half the app pointing at
  // the live upstream.
  it('offers the extra base-URL variables an HTTP-detected service was seen using', async () => {
    const r = repo()
    writeDetectionReport(r, {
      service: 'open-meteo',
      source: 'http',
      evidence: [{ filePath: 'src/config.ts', url: 'https://api.open-meteo.com' }],
      baseUrlEnv: 'GEOCODING_BASE_URL',
      baseUrlEnvs: [
        {
          envVar: 'GEOCODING_BASE_URL',
          defaultUrl: 'https://geocoding-api.open-meteo.com',
          confidence: 'literal-fallback',
        },
        { envVar: 'FORECAST_BASE_URL', defaultUrl: 'https://api.open-meteo.com', confidence: 'literal-fallback' },
      ],
    })
    answers.push(
      'open-meteo',
      'GEOCODING_BASE_URL', // pre-filled from detection
      'https://stub.test',
      '', // no mode
      '', // no description
      true, // yes, add the offered FORECAST_BASE_URL
      'FORECAST_BASE_URL',
      'inline',
      'https://stub.test',
      false, // nothing else
      true, // write it
    )

    await run({ cwd: r, interactive: true })

    expect(text()).toContain('also detected as base-URL overrides: FORECAST_BASE_URL (today https://api.open-meteo.com)')
    expect(readJson(recipePath(r)).api.externals['open-meteo']).toEqual({
      baseUrlEnv: 'GEOCODING_BASE_URL',
      baseUrl: 'https://stub.test',
      // `inline` is the ROUTING answer, not a stored field: the value itself lands
      // in the committed recipe, which is the point of choosing inline.
      env: { FORECAST_BASE_URL: { value: 'https://stub.test' } },
    })
    expect(fs.existsSync(externalsLocalPath(r))).toBe(false)
  })

  it('removes a declaration (and its stored values) on request', async () => {
    const r = repo({
      serve: ['node', 'dist/index.js'],
      externals: { stripe: { baseUrlEnv: 'STRIPE_BASE_URL', env: { STRIPE_API_KEY: {} } } },
    })
    fs.writeFileSync(
      externalsLocalPath(r),
      JSON.stringify({ stripe: { env: { STRIPE_API_KEY: 'sk_live_zzzz' } } }, null, 2) + '\n',
    )
    answers.push('stripe', 'remove', true)

    await run({ cwd: r, interactive: true })

    expect(readJson(recipePath(r)).api.externals).toBeUndefined()
    expect(fs.existsSync(externalsLocalPath(r))).toBe(false)
    expect(text()).toContain('removed')
  })

  it('writes nothing when a prompt is cancelled', async () => {
    const r = repo()
    const before = fs.readFileSync(recipePath(r), 'utf-8')
    answers.push('\0new', CANCEL)

    const exited = await run({ cwd: r, interactive: true })

    expect(exited).toBe(0)
    expect(text()).toContain('Cancelled')
    expect(fs.readFileSync(recipePath(r), 'utf-8')).toBe(before)
  })

  it('writes nothing when the final confirmation is declined', async () => {
    const r = repo()
    const before = fs.readFileSync(recipePath(r), 'utf-8')
    answers.push('\0new', 'stripe', 'STRIPE_BASE_URL', 'https://x.test', 'sandbox', '', false, false)

    await run({ cwd: r, interactive: true })

    expect(text()).toContain('Nothing written')
    expect(fs.readFileSync(recipePath(r), 'utf-8')).toBe(before)
  })

  it('refuses a write against a recipe with no api block, with the engine wording', async () => {
    const r = repo(null) // an `entry` recipe: no `api` block to hang externals off
    answers.push('\0new', 'stripe', 'STRIPE_BASE_URL', 'https://x.test', 'sandbox', '', false, true)

    const exited = await run({ cwd: r, interactive: true })

    expect(exited).toBe(1)
    expect(text()).toContain('no `api` block')
    expect(readJson(recipePath(r)).api).toBeUndefined()
  })
})
