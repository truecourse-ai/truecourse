/**
 * RUNNING FLOW TESTS — the Playwright specs in a work tree's `tests/`
 * directory, executed against a product world that is already up.
 *
 * The specs are plain `@playwright/test` files, so running them is running
 * Playwright: this module writes the directory's configuration, starts the
 * test runner on the specs it was asked for, and reads the report back as one
 * result per flow. The same call is a flow-test session's done-check and a
 * run of the stored tests, so a test that proved itself when it was written is
 * judged the same way every time after.
 *
 * A spec that starts from data runs its own SEED first (`<flow>.seed.ts`,
 * through `flowTest` below), inside the same Playwright test. A seed that does
 * not hold is reported apart from a test that fails: the first is the test's
 * own defect, the second is a finding.
 *
 * What the engine owns in the tests directory, and rewrites on every run:
 *   playwright.config.ts   where the product is, what to record
 *   flow.ts                the running product, and `flowTest`, which binds a spec to its seed
 *   node_modules/@playwright/test   a link to this install, so specs resolve it
 * Everything else there is the specs and their seeds.
 *
 * `@playwright/test` is an optional peer, like the browser it drives: a repo
 * with no tests never needs it, and one that does is told what to install.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { WORLD_ENV, type FlowTestResult, type ProductWorld } from '@truecourse/shared'
import { flowTestResultsDir, flowTestsDir, sanitizeSegment, worldStatePath } from '@truecourse/shared/work-tree'
import { buildOutputTail } from './build.js'
import { BUILD_PASSTHROUGH, constructChildEnv } from './child-env.js'
import { armChildKill } from './child-kill.js'

const DEFAULT_RUN_TIMEOUT_MS = 30 * 60_000
/** One test's own budget: a flow is a handful of pages or requests. */
const TEST_TIMEOUT_MS = 120_000
const DEFAULT_WORKERS = 4

/** A seed's own budget, outside the test's: a sign-up, a few requests, a command or two. */
const SEED_TIMEOUT_MS = 120_000

const CONFIG_FILE = 'playwright.config.ts'
const FLOW_MODULE_FILE = 'flow.ts'
const REPORT_FILE = 'report.json'
const ARTIFACTS_DIR = 'artifacts'

/**
 * The variables a spec, a seed and the configuration read. A seed that runs a
 * command against the world's containers names them by the world id, the way
 * the world scripts do.
 */
export const FLOW_TEST_ENV = {
  baseUrl: 'TC_BASE_URL',
  worldFile: 'TC_WORLD_FILE',
  worldId: WORLD_ENV.id,
  repoRoot: 'TC_REPO_ROOT',
} as const

/**
 * How a test says where its seed got to, as a Playwright annotation: pushed as
 * `failed` before the seed runs and turned to `ok` once it returned, so a seed
 * that threw and one that ran out of time read the same.
 */
const SEED_ANNOTATION = { type: 'seed', failed: 'failed', ok: 'ok' } as const

const PLAYWRIGHT_TEST_MISSING =
  'Running flow tests needs @playwright/test and its browser. Install them with:\n' +
  '  npm install @playwright/test@1.62.1\n' +
  '  npx playwright install chromium'

const CONFIG_SOURCE = `import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  outputDir: './results/run/${ARTIFACTS_DIR}',
  fullyParallel: true,
  retries: 0,
  timeout: ${TEST_TIMEOUT_MS},
  use: {
    baseURL: process.env.${FLOW_TEST_ENV.baseUrl},
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'on',
    video: 'on',
    screenshot: 'only-on-failure',
  },
})
`

const FLOW_MODULE_SOURCE = `import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { test as base, type APIRequestContext } from '@playwright/test'

export interface WorldAccount {
  name: string
  role?: string
  email?: string
  username?: string
  password?: string
  token?: string
  tokenUsage?: string
  notes?: string
}

export interface World {
  /** Where a person opens the product. Also Playwright's \`baseURL\`. */
  baseUrl: string
  /** Every other address the product answers on, by name. */
  urls: Record<string, string>
  /** Accounts the product's own installation made. None was created for a test. */
  accounts: WorldAccount[]
  notes?: string
}

/** The running product this test run is pointed at. */
export const world: World = { urls: {}, accounts: [], ...JSON.parse(readFileSync(process.env.${FLOW_TEST_ENV.worldFile}!, 'utf-8')) }

/** An account the product's installation made, by name; throws when there is none. */
export function account(name: string): WorldAccount {
  const found = world.accounts.find((a) => a.name === name)
  if (!found) throw new Error(\`no account "\${name}" in this world (has: \${world.accounts.map((a) => a.name).join(', ') || 'none'})\`)
  return found
}

/** What a flow's seed is handed. */
export interface SeedContext {
  world: World
  /** HTTP against the product, relative to \`world.baseUrl\`. Closed when the seed returns. */
  request: APIRequestContext
  /**
   * A token no other run of any seed has, lowercase letters and digits. Every
   * name, email and slug the seed creates carries it.
   */
  unique: string
}

/**
 * A flow's \`test\`, bound to its seed: the seed runs before the test body,
 * every time, and what it returns is the test's \`seeded\` fixture.
 */
export function flowTest<Seeded>(seed: (context: SeedContext) => Promise<Seeded>) {
  return base.extend<{ seeded: Seeded }>({
    seeded: [
      async ({ playwright }, use, testInfo) => {
        const mark = { type: '${SEED_ANNOTATION.type}', description: '${SEED_ANNOTATION.failed}' }
        testInfo.annotations.push(mark)
        const request = await playwright.request.newContext({ baseURL: world.baseUrl })
        let seeded: Seeded
        try {
          seeded = await seed({ world, request, unique: Date.now().toString(36) + randomBytes(3).toString('hex') })
        } finally {
          await request.dispose()
        }
        mark.description = '${SEED_ANNOTATION.ok}'
        await use(seeded)
      },
      { auto: true, timeout: ${SEED_TIMEOUT_MS} },
    ],
  })
}
`

/** Where `@playwright/test` is installed, or nothing when it is not. */
function playwrightTestDir(): string | undefined {
  try {
    return path.dirname(createRequire(import.meta.url).resolve('@playwright/test/package.json'))
  } catch {
    return undefined
  }
}

/**
 * Lay down what the engine owns in the tests directory. Idempotent; returns
 * the reason it could not, which is `@playwright/test` not being installed.
 */
export function prepareFlowTestsDir(repoRoot: string): { ok: true; cli: string } | { ok: false; reason: string } {
  const installed = playwrightTestDir()
  if (!installed) return { ok: false, reason: PLAYWRIGHT_TEST_MISSING }
  const dir = flowTestsDir(repoRoot)
  fs.mkdirSync(path.join(dir, 'node_modules', '@playwright'), { recursive: true })
  fs.writeFileSync(path.join(dir, CONFIG_FILE), CONFIG_SOURCE)
  fs.writeFileSync(path.join(dir, FLOW_MODULE_FILE), FLOW_MODULE_SOURCE)
  const link = path.join(dir, 'node_modules', '@playwright', 'test')
  fs.rmSync(link, { recursive: true, force: true })
  fs.symlinkSync(installed, link, 'dir')
  return { ok: true, cli: path.join(installed, 'cli.js') }
}

/** The world a test run is pointed at: what `up.sh` reported, and the id it was brought up under. */
export interface FlowTestWorld {
  id: string
  world: ProductWorld
}

/**
 * The environment a test run has: the build's allowlist of host variables,
 * where the product is, and where this install keeps its browsers.
 */
export function flowTestEnv(repoRoot: string, { id, world }: FlowTestWorld): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(constructChildEnv({ passthrough: BUILD_PASSTHROUGH }))) {
    if (value !== undefined) env[name] = value
  }
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH
  return {
    ...env,
    ...(browsers ? { PLAYWRIGHT_BROWSERS_PATH: browsers } : {}),
    [FLOW_TEST_ENV.baseUrl]: world.baseUrl,
    [FLOW_TEST_ENV.worldFile]: worldStatePath(repoRoot),
    [FLOW_TEST_ENV.worldId]: id,
    [FLOW_TEST_ENV.repoRoot]: repoRoot,
  }
}

export interface RunFlowTestsOptions {
  world: FlowTestWorld
  /** The specs to run, each with the flow it proves. */
  tests: ReadonlyArray<{ flowId: string; file: string }>
  /** How many specs run at once against the one world. */
  workers?: number
  /**
   * Names this run's own directory under `tests/results/`. Runs with different
   * labels can be in flight at once (one per flow-test session); two with the
   * same label would overwrite each other's report and recordings.
   */
  label?: string
  timeoutMs?: number
  signal?: AbortSignal
}

export type FlowTestsRun = { ok: true; results: FlowTestResult[] } | { ok: false; reason: string }

/**
 * Run the named specs against the world and return one result per spec, in the
 * order asked. A spec the report does not mention (it did not compile, or the
 * run died first) is a failure carrying what the runner printed.
 */
export async function runFlowTests(repoRoot: string, opts: RunFlowTestsOptions): Promise<FlowTestsRun> {
  const prepared = prepareFlowTestsDir(repoRoot)
  if (!prepared.ok) return prepared
  if (opts.tests.length === 0) return { ok: true, results: [] }

  const dir = flowTestsDir(repoRoot)
  const resultsDir = path.join(flowTestResultsDir(repoRoot), sanitizeSegment(opts.label ?? 'run'))
  const reportPath = path.join(resultsDir, REPORT_FILE)
  fs.mkdirSync(resultsDir, { recursive: true })
  fs.rmSync(reportPath, { force: true })

  const run = await runPlaywright(prepared.cli, dir, {
    args: [
      'test',
      '--config',
      CONFIG_FILE,
      '--workers',
      String(opts.workers ?? DEFAULT_WORKERS),
      '--output',
      path.join(resultsDir, ARTIFACTS_DIR),
      // Anchored on the directory, so `a.spec.ts` selects neither `x-a.spec.ts`
      // nor a file of the same name a session left in a subdirectory.
      ...opts.tests.map((t) => `${escapeRegExp(path.join(path.basename(dir), t.file))}$`),
    ],
    env: { ...flowTestEnv(repoRoot, opts.world), PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath },
    logPath: path.join(resultsDir, 'run.log'),
    timeoutMs: opts.timeoutMs ?? DEFAULT_RUN_TIMEOUT_MS,
    ...(opts.signal ? { signal: opts.signal } : {}),
  })

  const report = readReport(reportPath)
  if (!report) {
    const how = run.timedOut ? 'ran out of time' : `exited ${run.exitCode ?? 'without a code'}`
    return { ok: false, reason: `the test run ${how} without writing a report:\n${run.output}` }
  }

  // A spec that does not load stops Playwright before any test runs. It is
  // that spec's failure alone: the rest are run again without it.
  const broken = brokenSpecs(report, opts.tests)
  if (broken.size > 0 && broken.size < opts.tests.length) {
    const rest = await runFlowTests(repoRoot, { ...opts, tests: opts.tests.filter((t) => !broken.has(t.file)) })
    if (!rest.ok) return rest
    const restByFile = new Map(rest.results.map((r) => [r.file, r]))
    return {
      ok: true,
      results: opts.tests.map(
        ({ flowId, file }) =>
          restByFile.get(file) ?? { flowId, file, outcome: 'fail', durationMs: 0, error: broken.get(file)!, attachments: [] },
      ),
    }
  }

  const byFile = collectByFile(report, repoRoot)
  const loadErrors = (report.errors ?? []).map((e) => stripAnsi(e.message ?? '')).filter(Boolean).join('\n')
  return {
    ok: true,
    results: opts.tests.map(({ flowId, file }) => {
      const found = byFile.get(file)
      if (found) return { flowId, file, ...found }
      return {
        flowId,
        file,
        outcome: 'fail' as const,
        durationMs: 0,
        error: broken.get(file) ?? (loadErrors || `the run did not report ${file}:\n${run.output}`),
        attachments: [],
      }
    }),
  }
}

/** The asked-for specs a load error names, each with what Playwright said about it. */
function brokenSpecs(report: PwReport, tests: RunFlowTestsOptions['tests']): Map<string, string> {
  const broken = new Map<string, string>()
  for (const error of report.errors ?? []) {
    const message = stripAnsi(error.message ?? '')
    const named = tests.find(
      (t) => path.basename(error.location?.file ?? '') === t.file || message.includes(t.file),
    )
    if (named) broken.set(named.file, [broken.get(named.file), message].filter(Boolean).join('\n'))
  }
  return broken
}

interface PlaywrightRun {
  exitCode: number | null
  timedOut: boolean
  output: string
}

function runPlaywright(
  cli: string,
  cwd: string,
  opts: { args: string[]; env: Record<string, string>; logPath: string; timeoutMs: number; signal?: AbortSignal },
): Promise<PlaywrightRun> {
  if (opts.signal?.aborted) return Promise.resolve({ exitCode: null, timedOut: false, output: '' })
  const log = fs.openSync(opts.logPath, 'w')
  return new Promise<PlaywrightRun>((resolve) => {
    const child = spawn(process.execPath, [cli, ...opts.args, '--reporter', 'json,line'], {
      cwd,
      env: opts.env,
      detached: true,
      stdio: ['ignore', log, log],
    })
    const kill = armChildKill(child, opts.timeoutMs, opts.signal, { processGroup: true })
    let settled = false
    const finish = (exitCode: number | null): void => {
      if (settled) return
      settled = true
      kill.disarm()
      fs.closeSync(log)
      let output = ''
      try {
        output = buildOutputTail(fs.readFileSync(opts.logPath, 'utf-8'))
      } catch {
        /* nothing was printed */
      }
      resolve({ exitCode, timedOut: kill.timedOut, output })
    }
    child.on('error', () => finish(null))
    child.on('exit', (code) => finish(code))
  })
}

// -- the report ---------------------------------------------------------------

/** The slice of Playwright's JSON report this module reads. */
interface PwReport {
  suites?: PwSuite[]
  errors?: Array<{ message?: string; location?: { file?: string } }>
}
interface PwSuite {
  file?: string
  specs?: PwSpec[]
  suites?: PwSuite[]
}
interface PwSpec {
  file?: string
  tests?: Array<{ annotations?: PwAnnotation[]; results?: PwResult[] }>
}
interface PwAnnotation {
  type?: string
  description?: string
}
interface PwResult {
  status?: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted'
  duration?: number
  error?: { message?: string }
  errors?: Array<{ message?: string }>
  attachments?: Array<{ name?: string; path?: string }>
}

function readReport(reportPath: string): PwReport | undefined {
  try {
    return JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as PwReport
  } catch {
    return undefined
  }
}

type FileResult = Omit<FlowTestResult, 'flowId' | 'file'>

/**
 * Fold the report into one result per spec file: it passes when every test in
 * it did, and a test whose seed did not hold makes it `seed-failed`.
 */
function collectByFile(report: PwReport, repoRoot: string): Map<string, FileResult> {
  const byFile = new Map<string, PwResult[]>()
  const seedFailed = new Set<string>()
  const walk = (suite: PwSuite): void => {
    for (const spec of suite.specs ?? []) {
      const file = path.basename(spec.file ?? suite.file ?? '')
      if (!file) continue
      const results = byFile.get(file) ?? []
      // The LAST result of a test is the one that stands (earlier ones are retries).
      for (const test of spec.tests ?? []) {
        const last = test.results?.at(-1)
        if (!last) continue
        results.push(last)
        const seed = test.annotations?.find((a) => a.type === SEED_ANNOTATION.type)
        if (seed?.description === SEED_ANNOTATION.failed) seedFailed.add(file)
      }
      byFile.set(file, results)
    }
    for (const child of suite.suites ?? []) walk(child)
  }
  for (const suite of report.suites ?? []) walk(suite)

  // An attachment is reported under the output directory as it was given, or
  // under its real path when the tree was reached through a link.
  const roots = [repoRoot, fs.realpathSync(repoRoot)]
  const treeRelative = (file: string): string => {
    const root = roots.find((r) => file.startsWith(r + path.sep)) ?? repoRoot
    return path.relative(root, file).split(path.sep).join('/')
  }
  const folded = new Map<string, FileResult>()
  for (const [file, results] of byFile) {
    const failed = results.filter((r) => r.status !== 'passed' && r.status !== 'skipped')
    const ran = results.filter((r) => r.status !== 'skipped')
    const error = failed
      .flatMap((r) => (r.errors?.length ? r.errors : r.error ? [r.error] : []))
      .map((e) => stripAnsi(e.message ?? ''))
      .filter(Boolean)
      .join('\n\n')
    folded.set(file, {
      outcome: seedFailed.has(file) ? 'seed-failed' : failed.length > 0 ? 'fail' : ran.length === 0 ? 'skipped' : 'pass',
      durationMs: results.reduce((sum, r) => sum + (r.duration ?? 0), 0),
      ...(failed.length > 0 ? { error: error || `ended ${failed[0].status ?? 'without a status'}` } : {}),
      attachments: results.flatMap((r) =>
        (r.attachments ?? []).flatMap((a) =>
          a.name && a.path ? [{ name: a.name, path: treeRelative(a.path) }] : [],
        ),
      ),
    })
  }
  return folded
}

function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
