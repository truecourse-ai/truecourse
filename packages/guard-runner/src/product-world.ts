/**
 * THE PRODUCT WORLD, as the engine runs it: build the checkout, bring the
 * whole product up, find out what is running, and take it down again.
 *
 * A repository is operated by three shell scripts in its work tree, written by
 * the setup session that got the product running (the contract they are held
 * to is `@truecourse/shared`'s `guard/world.ts`). This module knows nothing
 * about package managers, containers or frameworks, and that is the point:
 * what it takes to run a product is the scripts' business, and the engine only
 * establishes that they work. It runs each one, gives it a world id and free
 * ports, reads back the file `up.sh` wrote, and checks that the address in it
 * answers.
 *
 * This is the ONE way a product is brought up: the setup session's own
 * done-check, the session that writes a flow's test, and a run of the tests
 * all call it, so a world that booted for one boots for the others.
 *
 * `up.sh` leaves servers running after it exits. They stay in the script's
 * process group, which is how a world whose `down.sh` fails is still stopped.
 */

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { ProductWorldSchema, WORLD_ENV, WORLD_PORT_COUNT, type ProductWorld } from '@truecourse/shared'
import {
  WORLD_SCRIPTS,
  worldLogsDir,
  worldScriptPath,
  worldStatePath,
  type WorldScript,
} from '@truecourse/shared/work-tree'
import { buildOutputTail } from './build.js'
import { BUILD_PASSTHROUGH, constructChildEnv } from './child-env.js'
import { armChildKill, trackProcessGroup } from './child-kill.js'
import { allocateFreePort, releasePort } from './ports.js'

/** An install and a build of a real product. */
const BUILD_TIMEOUT_MS = 30 * 60_000
/** Containers pulled, migrations run, a seed, servers waited on. */
const UP_TIMEOUT_MS = 15 * 60_000
const DOWN_TIMEOUT_MS = 5 * 60_000
/** How long the address `up.sh` reported may take to answer. */
const PROBE_TIMEOUT_MS = 60_000
const PROBE_INTERVAL_MS = 1_000
/** How much of a script's log is read back for its tail. */
const LOG_TAIL_BYTES = 64 * 1024

export interface WorldScriptResult {
  script: WorldScript
  ok: boolean
  exitCode: number | null
  timedOut: boolean
  /** The end of what the script printed. */
  output: string
}

/** The world scripts a tree does not have; empty when it has all three. */
export function missingWorldScripts(repoRoot: string): WorldScript[] {
  return WORLD_SCRIPTS.filter((script) => !fs.existsSync(worldScriptPath(repoRoot, script)))
}

/**
 * The environment a world's scripts run with: the build's allowlist of host
 * variables, plus the world's id, its ports and where it reports to.
 */
export function worldScriptEnv(repoRoot: string, world: { id: string; ports: readonly number[] }): Record<string, string> {
  const base = constructChildEnv({ passthrough: BUILD_PASSTHROUGH })
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(base)) {
    if (value !== undefined) env[name] = value
  }
  return {
    ...env,
    [WORLD_ENV.id]: world.id,
    [WORLD_ENV.ports]: world.ports.join(' '),
    [WORLD_ENV.stateFile]: worldStatePath(repoRoot),
    [WORLD_ENV.logsDir]: worldLogsDir(repoRoot),
  }
}

interface RunScriptOptions {
  env: Record<string, string>
  timeoutMs: number
  signal?: AbortSignal
  /** Called with the spawned script's process group, which outlives the script. */
  onGroup?: (pid: number, untrack: () => void) => void
}

/**
 * Run one world script to its exit. Its output goes to a log file, never a
 * pipe: `up.sh` leaves servers running, and a pipe they inherited would hold
 * this call open for as long as they live.
 */
function runWorldScript(repoRoot: string, script: WorldScript, opts: RunScriptOptions): Promise<WorldScriptResult> {
  const logPath = `${worldLogsDir(repoRoot)}/${script}.log`
  const failed = (output: string): WorldScriptResult => ({ script, ok: false, exitCode: null, timedOut: false, output })
  if (opts.signal?.aborted) return Promise.resolve(failed(''))
  fs.mkdirSync(worldLogsDir(repoRoot), { recursive: true })
  const log = fs.openSync(logPath, 'w')
  return new Promise<WorldScriptResult>((resolve) => {
    const child = spawn('sh', [worldScriptPath(repoRoot, script)], {
      cwd: repoRoot,
      env: opts.env,
      // Its own process group, so the servers it leaves behind can be reached.
      detached: true,
      stdio: ['ignore', log, log],
    })
    const kill = armChildKill(child, opts.timeoutMs, opts.signal, { processGroup: true })
    if (opts.onGroup && child.pid !== undefined) {
      opts.onGroup(child.pid, trackProcessGroup(child, { deregisterOn: 'manual' }))
    }
    let settled = false
    const finish = (exitCode: number | null, extra = ''): void => {
      if (settled) return
      settled = true
      kill.disarm()
      fs.closeSync(log)
      resolve({
        script,
        ok: exitCode === 0 && !kill.timedOut,
        exitCode,
        timedOut: kill.timedOut,
        output: buildOutputTail(readTail(logPath) + extra),
      })
    }
    child.on('error', (err) => finish(null, `\n${err.message}`))
    child.on('exit', (code) => finish(code))
  })
}

function readTail(file: string): string {
  try {
    const { size } = fs.statSync(file)
    const length = Math.min(size, LOG_TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    const fd = fs.openSync(file, 'r')
    try {
      fs.readSync(fd, buffer, 0, length, size - length)
    } finally {
      fs.closeSync(fd)
    }
    return buffer.toString('utf-8')
  } catch {
    return ''
  }
}

/** A world's identity on this host: what its scripts name things after, and the ports they may bind. */
export interface WorldSlot {
  id: string
  ports: number[]
}

/** Reserve the ports a world's scripts may bind. Released by {@link releaseWorldSlot}. */
export async function reserveWorldSlot(id: string): Promise<WorldSlot> {
  const ports: number[] = []
  for (let i = 0; i < WORLD_PORT_COUNT; i += 1) ports.push(await allocateFreePort())
  return { id, ports }
}

export function releaseWorldSlot(slot: WorldSlot): void {
  for (const port of slot.ports) releasePort(port)
}

export interface WorldRunOptions {
  slot: WorldSlot
  signal?: AbortSignal
}

/** Install and build the checkout. Once per checkout; `up.sh` assumes it ran. */
export function buildProductWorld(repoRoot: string, opts: WorldRunOptions): Promise<WorldScriptResult> {
  return runWorldScript(repoRoot, 'build', {
    env: worldScriptEnv(repoRoot, opts.slot),
    timeoutMs: BUILD_TIMEOUT_MS,
    ...(opts.signal ? { signal: opts.signal } : {}),
  })
}

/** A product that is up. */
export interface RunningWorld {
  world: ProductWorld
  /** Stop the product and discard its data. Safe to call more than once. */
  down(): Promise<WorldScriptResult>
}

export type WorldBootFailure = {
  ok: false
  /** Which part of coming up did not hold. */
  stage: 'scripts' | 'up' | 'report' | 'answer'
  reason: string
}

export type WorldBoot = { ok: true; running: RunningWorld } | WorldBootFailure

/**
 * Bring the product up and establish that it is: `up.sh` exits zero, the file
 * it wrote says where the product is, and that address answers. A world that
 * fails any of the three is taken down again before this returns.
 */
export async function bootProductWorld(repoRoot: string, opts: WorldRunOptions): Promise<WorldBoot> {
  const missing = missingWorldScripts(repoRoot)
  if (missing.length > 0) {
    return { ok: false, stage: 'scripts', reason: `no ${missing.map((s) => `world/${s}.sh`).join(', ')} in the work tree` }
  }
  const env = worldScriptEnv(repoRoot, opts.slot)
  fs.rmSync(worldStatePath(repoRoot), { force: true })

  let group: { pid: number; untrack: () => void } | undefined
  let downResult: Promise<WorldScriptResult> | undefined
  const down = (): Promise<WorldScriptResult> => {
    downResult ??= (async () => {
      const result = await runWorldScript(repoRoot, 'down', { env, timeoutMs: DOWN_TIMEOUT_MS })
      // Whatever `down.sh` missed is still in the group `up.sh` started.
      if (group) {
        try {
          process.kill(-group.pid, 'SIGKILL')
        } catch {
          /* the group is already gone */
        }
        group.untrack()
      }
      return result
    })()
    return downResult
  }
  const fail = async (stage: WorldBootFailure['stage'], reason: string): Promise<WorldBootFailure> => {
    await down()
    return { ok: false, stage, reason }
  }

  // Whatever an earlier run left under this world's id is taken down first: a
  // job that was cancelled or crashed never ran its own teardown, and its
  // containers would hold the names this boot is about to use.
  await runWorldScript(repoRoot, 'down', { env, timeoutMs: DOWN_TIMEOUT_MS, ...(opts.signal ? { signal: opts.signal } : {}) })

  const up = await runWorldScript(repoRoot, 'up', {
    env,
    timeoutMs: UP_TIMEOUT_MS,
    ...(opts.signal ? { signal: opts.signal } : {}),
    onGroup: (pid, untrack) => {
      group = { pid, untrack }
    },
  })
  if (!up.ok) {
    const how = up.timedOut ? `did not finish in ${UP_TIMEOUT_MS / 60_000} minutes` : `exited ${up.exitCode ?? 'without a code'}`
    return fail('up', `world/up.sh ${how}:\n${up.output}`)
  }

  const report = readWorldReport(repoRoot)
  if (!report.ok) return fail('report', report.reason)

  const answer = await awaitAnswer(report.world.baseUrl, opts.signal)
  if (answer) return fail('answer', `${report.world.baseUrl} ${answer}\n\nworld/up.sh printed:\n${up.output}`)

  return { ok: true, running: { world: report.world, down } }
}

function readWorldReport(repoRoot: string): { ok: true; world: ProductWorld } | { ok: false; reason: string } {
  const file = worldStatePath(repoRoot)
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf-8')
  } catch {
    return { ok: false, reason: `world/up.sh exited zero but wrote no world file to $${WORLD_ENV.stateFile}` }
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch (err) {
    return { ok: false, reason: `the world file is not JSON: ${err instanceof Error ? err.message : String(err)}` }
  }
  const parsed = ProductWorldSchema.safeParse(json)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    return { ok: false, reason: `the world file does not say what is running:\n- ${issues.join('\n- ')}` }
  }
  return { ok: true, world: parsed.data }
}

/**
 * Wait for the product's address to answer. Any response short of a server
 * error counts: a redirect to a sign-in page is a product that is up. Returns
 * what went wrong, or nothing.
 */
async function awaitAnswer(url: string, signal?: AbortSignal): Promise<string | undefined> {
  const deadline = Date.now() + PROBE_TIMEOUT_MS
  let last = 'never answered'
  while (Date.now() < deadline) {
    if (signal?.aborted) return 'was not waited for: the run was cancelled'
    try {
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10_000) })
      if (response.status < 500) return undefined
      last = `answered ${response.status}`
    } catch (err) {
      last = `did not answer (${err instanceof Error ? err.message : String(err)})`
    }
    await new Promise((resolve) => setTimeout(resolve, PROBE_INTERVAL_MS))
  }
  return `${last} within ${PROBE_TIMEOUT_MS / 1000}s of world/up.sh exiting`
}
