/**
 * A committed scenario, told as a STORY — the plain sentences a reviewer reads
 * instead of the declarative YAML the engine runs. Every `expect` matcher becomes
 * one sentence, `setup` becomes the world the scenario is placed in, each step becomes
 * what it DOES plus what it remembers, and the flow's promise leads. ONE source,
 * rendered by both the dashboard (the scenario detail's Story mode) and the CLI
 * (`guard flows --show <id> --story`), so what a reviewer reads can never drift
 * from what runs.
 *
 * Two vocabularies, because this line's scenarios are api JOURNEYS as often as cli
 * invocations: requests (method/path/body), captures (`capture` /
 * `captureHeaders`, chained as `${var}`), the server PROCESS lifecycle (boot,
 * signal, logs) and the seeded/stubbed world on the api side; argv, stdin, per-step
 * env and file assertions on the cli side.
 *
 * Its terse sibling is {@link describeGuardScenarioSteps} (`scenario.ts`), which
 * renders the same steps as a command + one-line expectation for the dashboard's
 * structured step list and the runner's evidence transcript. This module is the
 * PROSE register: full sentences, the world, and the promise. Both read the same
 * parsed scenario, so neither can invent a step the other does not have.
 *
 * Pure and runner-free — it reads only the shared scenario shape, so the client and
 * the CLI import it without pulling the guard-runner in.
 */

import {
  GuardScenarioSchema,
  isApiBootStep,
  isApiLogsStep,
  isApiRequestStep,
  isApiSignalStep,
  isCliBootStep,
  isCliRunStep,
  isCliSignalStep,
  type GuardApiExpect,
  type GuardApiStep,
  type GuardCliStep,
  type GuardExpect,
  type GuardExternals,
  type GuardFileMatcher,
  type GuardGit,
  type GuardHttpStubs,
  type GuardJsonMatcher,
  type GuardLogMatch,
  type GuardScenario,
  type GuardSetup,
  type GuardStreamMatcher,
} from './scenario.js'
import type { GuardDriverId } from './drivers.js'

/** One step of a scenario, told in words. */
export interface GuardStoryStep {
  /** 1-based position — the number a failure's `step` names. */
  n: number
  /** What the step DOES, as a sentence ("POST /todos, sending JSON …"). */
  does: string
  /** Env this step alone runs under, as `K=V` (a cli step, or an api `boot`). */
  env?: string[]
  /** What is piped to the program's stdin (cli). */
  stdin?: string
  /** Earlier captures this step's request/argv refers to, as `${name}`. */
  uses?: string[]
  /** What the step REMEMBERS for later steps, one sentence each. */
  captures?: string[]
  /** Every assertion, one sentence each, in the order the runner evaluates them. */
  expectations: string[]
  /** The flow milestone this step realizes, when it names one. */
  milestone?: number
  /** Repeat count when the step runs more than once. */
  repeat?: number
}

/** A whole scenario as the words a reviewer reads. */
export interface GuardScenarioStory {
  id: string
  /** The scenario title — what it verifies, in one line. */
  title: string
  driver: GuardDriverId
  /**
   * The flow's promise in plain words, denormalized onto the artifact at write
   * time. Absent on a hand-written scenario and on one written before the field.
   */
  promise?: string
  /** The recipe server the scenario drives, when it names one (api, multi-server). */
  server?: string
  /** The WORLD the scenario is placed in before its first step, one sentence each. */
  world: string[]
  steps: GuardStoryStep[]
  /** The normalizations applied to every compared value, in plain words. */
  normalizers: string[]
  /** The spec sections the scenario is bound to. */
  binds: { doc: string; section: string }[]
}

/** Longer values collapse to one line and truncate — a story line stays scannable. */
function short(value: string, max = 80): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed
}

/** A short-ened value in typographic quotes, for embedding in a sentence. */
function quoted(value: string): string {
  return `“${short(value)}”`
}

/** A JSON value as one short line — a body, a matcher's `equals`. */
function json(value: unknown): string {
  try {
    return short(JSON.stringify(value) ?? String(value))
  } catch {
    return short(String(value))
  }
}

// --- Matchers, as sentences -------------------------------------------------

/** `is exactly “x”` / `contains “x”` / `matches /x/` — one stream/body/header matcher. */
function streamSentence(m: GuardStreamMatcher): string {
  if (m.equals !== undefined) return `is exactly ${quoted(m.equals)}`
  if (m.contains !== undefined) return `contains ${quoted(m.contains)}`
  return `matches /${short(m.matches ?? '')}/`
}

function fileSentence(rel: string, m: GuardFileMatcher): string {
  if (m.exists === true || m.absent === false) return `the file ${rel} exists`
  if (m.absent === true || m.exists === false) return `the file ${rel} is gone`
  if (m.equals !== undefined) return `the file ${rel} is exactly ${quoted(m.equals)}`
  return `the file ${rel} contains ${quoted(m.contains ?? '')}`
}

function jsonSentence(path: string, m: GuardJsonMatcher): string {
  const subject = path === '' ? 'the response body' : `\`${path}\` in the response body`
  if (m.exists) return `${subject} is present`
  if (m.absent) return `${subject} is absent`
  if (m.equals !== undefined) return `${subject} is ${json(m.equals)}`
  if (m.contains !== undefined) return `${subject} contains ${quoted(m.contains)}`
  return `${subject} matches /${short(m.matches ?? '')}/`
}

/** Every `expect` matcher of a cli step, in the order the runner evaluates them. */
export function describeCliExpectations(expect: GuardExpect): string[] {
  const lines: string[] = []
  if (expect.exit !== undefined) lines.push(`the exit code is ${expect.exit}`)
  if (expect.stdout) lines.push(`stdout ${streamSentence(expect.stdout)}`)
  if (expect.stderr) lines.push(`stderr ${streamSentence(expect.stderr)}`)
  for (const [rel, m] of Object.entries(expect.files ?? {})) lines.push(fileSentence(rel, m))
  return lines
}

/** Every `expect` matcher of an api request step, in evaluation order. */
export function describeApiExpectations(expect: GuardApiExpect): string[] {
  const lines: string[] = []
  if (expect.status !== undefined) lines.push(`the response status is ${expect.status}`)
  for (const [name, m] of Object.entries(expect.headers ?? {})) {
    lines.push(`the response header \`${name}\` ${streamSentence(m)}`)
  }
  if (expect.body) lines.push(`the response body ${streamSentence(expect.body)}`)
  for (const [path, m] of Object.entries(expect.json ?? {})) lines.push(jsonSentence(path, m))
  if (expect.schema) {
    lines.push('the whole response body conforms to the schema the documented operation declares for that status')
  }
  return lines
}

/** `“x”` / `/x/` — one log-line matcher. */
function logMatchSentence(m: GuardLogMatch): string {
  return typeof m === 'string' ? quoted(m) : `/${short(m.pattern)}/`
}

// --- The world (`setup`), as sentences ---------------------------------------

function gitSentences(git: GuardGit): string[] {
  const parts: string[] = []
  const commits = git.commits?.length ?? 0
  if (commits > 0) parts.push(`${commits} commit${commits === 1 ? '' : 's'}`)
  const staged = git.staged?.length ?? 0
  if (staged > 0) parts.push(`${staged} staged file${staged === 1 ? '' : 's'}`)
  const branch = git.branch ? ` on branch \`${git.branch}\`` : ''
  return [
    parts.length > 0
      ? `A git repository${branch} is created in the sandbox with ${parts.join(' and ')}.`
      : `A git repository${branch} is created in the sandbox.`,
  ]
}

function httpStubSentences(stubs: GuardHttpStubs): string[] {
  return Object.entries(stubs).map(([name, stub]) => {
    const routes = stub.routes.map((r) => `${r.method} ${r.path}`).join(', ')
    const unmatched =
      stub.unmatched === '404'
        ? 'a call to anything else answers 404'
        : 'a call to anything else fails the scenario'
    const asserted = stub.routes.filter((r) => r.expect).length
    const counted = stub.routes.filter((r) => r.calls !== undefined)
    const extra: string[] = []
    if (asserted > 0) extra.push(`${asserted} of them assert what the app sent`)
    for (const r of counted) {
      extra.push(
        r.calls === 0
          ? `${r.method} ${r.path} must never be called`
          : `${r.method} ${r.path} must be called exactly ${r.calls} time${r.calls === 1 ? '' : 's'}`,
      )
    }
    const tail = extra.length > 0 ? ` ${extra.join('; ')}.` : ''
    return `A fake \`${name}\` service answers ${routes} — ${unmatched}.${tail}`
  })
}

function externalsSentences(externals: GuardExternals): string[] {
  return Object.entries(externals).map(([name, ext]) => {
    const parts: string[] = []
    for (const fault of ext.faults ?? []) {
      const where = fault.match
        ? `${fault.match.method ?? 'every'} ${fault.match.path ?? 'call'}`.trim()
        : 'every call'
      const what: string[] = []
      if (fault.delayMs !== undefined) what.push(`waits ${fault.delayMs}ms`)
      if (fault.refuse) what.push('refuses the connection')
      if (fault.respond) what.push(`answers ${fault.respond.status}`)
      if (what.length === 0) what.push('passes through untouched')
      parts.push(`${where} ${what.join(' then ')}${fault.once ? ' (once, then the next rule)' : ''}`)
    }
    if (ext.calls !== undefined) {
      parts.push(
        ext.calls === 0
          ? 'and the app must never call it'
          : `and the app must call it exactly ${ext.calls} time${ext.calls === 1 ? '' : 's'}`,
      )
    }
    return `The real \`${name}\` service is scripted: ${parts.join('; ')}.`
  })
}

/** The `setup` block as the world the scenario is placed in, one sentence per capability. */
export function describeWorld(setup: GuardSetup | undefined): string[] {
  if (!setup) return []
  const lines: string[] = []
  const files = Object.keys(setup.files ?? {})
  if (files.length > 0) {
    lines.push(
      `The sandbox starts with ${files.length} seeded file${files.length === 1 ? '' : 's'}: ${files.join(', ')}.`,
    )
  }
  const env = Object.entries(setup.env ?? {})
  if (env.length > 0) {
    lines.push(`The program runs with ${env.map(([k, v]) => `\`${k}=${short(v, 40)}\``).join(', ')} in its environment.`)
  }
  if (setup.git) lines.push(...gitSentences(setup.git))
  if (setup.http) lines.push(...httpStubSentences(setup.http))
  if (setup.externals) lines.push(...externalsSentences(setup.externals))
  return lines
}

/** The closed normalizer set, in the words a reader needs. */
const NORMALIZER_SENTENCE: Record<string, string> = {
  timestamps: 'timestamps are masked before comparison',
  'abs-paths': 'absolute paths are masked before comparison',
  versions: 'version strings are masked before comparison',
  durations: 'durations are masked before comparison',
}

// --- Steps -------------------------------------------------------------------

/** The `${name}` references in a string, minus the engine's own reserved token. */
const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

function collectVars(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    for (const m of value.matchAll(VAR_RE)) if (m[1] !== 'unique') into.add(m[1])
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) collectVars(v, into)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) collectVars(v, into)
  }
}

/** A cli step's `run` argv as one command string (empty argv runs the bare entry). */
export function describeArgv(run: readonly string[]): string {
  if (run.length === 0) return 'run the program with no arguments'
  return `run the program with \`${run.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}\``
}

function cliStoryStep(step: GuardCliStep, n: number): GuardStoryStep {
  const base = {
    n,
    ...(step.milestone != null ? { milestone: step.milestone } : {}),
  }
  if (isCliBootStep(step)) {
    const env = Object.entries(step.boot.env ?? {}).map(([k, v]) => `${k}=${v}`)
    const { stream, match } = step.boot.ready
    return {
      ...base,
      does:
        step.boot.run.length === 0
          ? 'start the program as a service'
          : `start the service with \`${step.boot.run.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}\``,
      ...(env.length > 0 ? { env } : {}),
      expectations: [`its ${stream} prints a line matching ${logMatchSentence(match)} — then it keeps running`],
    }
  }
  if (isCliSignalStep(step)) {
    const expectations: string[] = []
    if (step.signal.expect?.exitCode !== undefined) {
      expectations.push(`the process exits with code ${step.signal.expect.exitCode}`)
    }
    if (step.signal.expect?.withinMs !== undefined) {
      expectations.push(`it goes down within ${step.signal.expect.withinMs}ms`)
    }
    return { ...base, does: `send ${step.signal.name} to the running service`, expectations }
  }
  if (!isCliRunStep(step)) {
    const { stream, match, count, sinceLastStep } = step.logs
    const subject =
      count === undefined
        ? `at least one ${stream} line matches`
        : count === 0
          ? `no ${stream} line matches`
          : count === 1
            ? `exactly 1 ${stream} line matches`
            : `exactly ${count} ${stream} lines match`
    const expectations = [`${subject} ${logMatchSentence(match)}`]
    if (sinceLastStep) {
      expectations.push('only output written since the previous step began counts')
    }
    return { ...base, does: `read what the service wrote to ${stream}`, expectations }
  }
  const env = Object.entries(step.env ?? {}).map(([k, v]) => `${k}=${v}`)
  const uses = new Set<string>()
  collectVars(step.run, uses)
  collectVars(step.stdin, uses)
  return {
    ...base,
    does: describeArgv(step.run),
    ...(env.length > 0 ? { env } : {}),
    ...(step.stdin !== undefined ? { stdin: short(step.stdin) } : {}),
    ...(uses.size > 0 ? { uses: [...uses] } : {}),
    expectations: describeCliExpectations(step.expect),
    ...(step.repeat != null && step.repeat > 1 ? { repeat: step.repeat } : {}),
  }
}

function requestSentence(step: Extract<GuardApiStep, { request: unknown }>): string {
  const { method, path, body, json: jsonBody } = step.request
  if (jsonBody !== undefined) return `${method} ${path}, sending JSON ${json(jsonBody)}`
  if (body !== undefined) return `${method} ${path}, sending ${quoted(body)}`
  return `${method} ${path}`
}

function apiStoryStep(step: GuardApiStep, n: number): GuardStoryStep {
  const base = {
    n,
    ...(step.milestone != null ? { milestone: step.milestone } : {}),
  }
  if (isApiBootStep(step)) {
    const env = Object.entries(step.boot.env ?? {}).map(([k, v]) => `${k}=${v}`)
    const e = step.boot.expect
    const expectations: string[] = []
    if (!e || e.ready) expectations.push('the server answers its health path and is ready to serve')
    if (e?.exitCode !== undefined) expectations.push(`the process exits with code ${e.exitCode}`)
    for (const s of e?.stderrContains ?? []) expectations.push(`its stderr contains ${quoted(s)}`)
    return {
      ...base,
      does: env.length > 0 ? '(re)start the app server' : 'start the app server',
      ...(env.length > 0 ? { env } : {}),
      expectations,
    }
  }
  if (isApiSignalStep(step)) {
    const expectations: string[] = []
    if (step.signal.expect?.exitCode !== undefined) {
      expectations.push(`the process exits with code ${step.signal.expect.exitCode}`)
    }
    if (step.signal.expect?.withinMs !== undefined) {
      expectations.push(`it goes down within ${step.signal.expect.withinMs}ms`)
    }
    return { ...base, does: `send ${step.signal.name} to the running server`, expectations }
  }
  if (isApiLogsStep(step)) {
    const { stream, match, count, sinceLastStep } = step.logs
    const subject =
      count === undefined
        ? `at least one ${stream} line matches`
        : count === 0
          ? `no ${stream} line matches`
          : count === 1
            ? `exactly 1 ${stream} line matches`
            : `exactly ${count} ${stream} lines match`
    const expectations = [`${subject} ${logMatchSentence(match)}`]
    if (sinceLastStep) {
      expectations.push('only output written since the previous step began counts')
    }
    return { ...base, does: `read what the server wrote to ${stream}`, expectations }
  }
  if (!isApiRequestStep(step)) return { ...base, does: 'an unrecognized step', expectations: [] }

  const uses = new Set<string>()
  collectVars(step.request.path, uses)
  collectVars(step.request.headers, uses)
  collectVars(step.request.body, uses)
  collectVars(step.request.json, uses)
  const captures = [
    ...Object.entries(step.capture ?? {}).map(
      ([name, path]) => `remembers \`${name}\` from ${path === '' ? 'the response body' : `\`${path}\` in the response body`}`,
    ),
    ...Object.entries(step.captureHeaders ?? {}).map(
      ([name, header]) => `remembers \`${name}\` from the response header \`${header}\``,
    ),
  ]
  return {
    ...base,
    does: requestSentence(step),
    ...(uses.size > 0 ? { uses: [...uses] } : {}),
    ...(captures.length > 0 ? { captures } : {}),
    expectations: describeApiExpectations(step.expect),
    ...(step.repeat != null && step.repeat > 1 ? { repeat: step.repeat } : {}),
  }
}

/**
 * A committed scenario as its story. Anything that does not parse as a known
 * driver yields `null` — the caller falls back to the raw source, never to a
 * half-rendered guess (the same rule {@link describeGuardScenarioSteps} follows).
 */
export function describeGuardScenario(scenario: unknown): GuardScenarioStory | null {
  const parsed = GuardScenarioSchema.safeParse(scenario)
  if (!parsed.success) return null
  const s: GuardScenario = parsed.data
  return {
    id: s.id,
    title: s.title,
    driver: s.driver,
    ...(s.promise ? { promise: s.promise } : {}),
    ...(s.driver === 'api' && s.server ? { server: s.server } : {}),
    world: describeWorld(s.setup),
    steps:
      s.driver === 'api'
        ? s.steps.map((step, i) => apiStoryStep(step, i + 1))
        : s.steps.map((step, i) => cliStoryStep(step, i + 1)),
    normalizers: s.normalize.map((n) => NORMALIZER_SENTENCE[n] ?? n),
    binds: s.binds.map((b) => ({ doc: b.doc, section: b.section })),
  }
}
