/**
 * Translate a guard scenario's mechanics — the declarative YAML the engine runs —
 * into the plain sentences a human reads: each `expect` matcher to one line ("exit
 * code is 1", "stdout contains …", "file test.sql exists"), `setup` to a seeded-file
 * list, and each step's `run` to its full argv. One source both the dashboard and the
 * CLI render from, so the story a reviewer sees never drifts from what runs.
 *
 * Pure and runner-free: it reads only the shared scenario shape (`./scenario.js`),
 * so `packages/shared`'s consumers (client + CLI) import it without pulling the
 * guard-runner in.
 */

import type { GuardScenario, GuardExpect, GuardSetup, GuardStreamMatcher, GuardFileMatcher } from './scenario.js'

/** One step of a scenario, rendered to words. */
export interface ScenarioStepStory {
  /** The argv appended to the recipe entrypoint (the step's `run`). */
  run: string[]
  /** `run` rendered as a single command string (empty → the bare entrypoint). */
  command: string
  /** Data piped to stdin, when the step declares it. */
  stdin?: string
  /** Repeat count when the step runs more than once. */
  repeat?: number
  /** Each `expect` matcher as a plain sentence, in evaluation order. */
  expectations: string[]
}

/** A whole scenario, rendered to the words a reviewer reads. */
export interface ScenarioStory {
  /** The doc's promise this scenario defends — absent on a pre-claim scenario. */
  claim?: string
  /** Sandbox-relative paths `setup.files` seeds before the run. */
  setupFiles: string[]
  /** The steps, each rendered to its argv + expectations. */
  steps: ScenarioStepStory[]
}

/** Longer values collapse to one line and truncate — a story line stays scannable. */
function short(value: string, max = 80): string {
  const collapsed = value.replace(/\s+/g, ' ').trim()
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed
}

/** Wrap a short-ened value in quotes for embedding in a sentence. */
function quoted(value: string): string {
  return `"${short(value)}"`
}

/** One stream matcher (stdout/stderr) as a sentence — `equals`, `contains`, or `matches`. */
function describeStream(subject: 'stdout' | 'stderr', matcher: GuardStreamMatcher): string {
  if (matcher.equals !== undefined) return `${subject} is exactly ${quoted(matcher.equals)}`
  if (matcher.contains !== undefined) return `${subject} contains ${quoted(matcher.contains)}`
  return `${subject} matches /${short(matcher.matches ?? '')}/`
}

/** One file matcher as a sentence — presence (`exists`/`absent`) or content (`equals`/`contains`). */
function describeFile(rel: string, matcher: GuardFileMatcher): string {
  if (matcher.exists === true || matcher.absent === false) return `file ${rel} exists`
  if (matcher.absent === true || matcher.exists === false) return `file ${rel} is absent`
  if (matcher.equals !== undefined) return `file ${rel} is exactly ${quoted(matcher.equals)}`
  if (matcher.contains !== undefined) return `file ${rel} contains ${quoted(matcher.contains)}`
  return `file ${rel} is checked`
}

/**
 * Every `expect` matcher of one step as a plain sentence, in the same fixed order
 * the runner evaluates them (exit → stdout → stderr → files). An empty `expect`
 * (nothing asserted) yields no lines.
 */
export function describeExpect(expect: GuardExpect): string[] {
  const lines: string[] = []
  if (expect.exit !== undefined) lines.push(`exit code is ${expect.exit}`)
  if (expect.stdout) lines.push(describeStream('stdout', expect.stdout))
  if (expect.stderr) lines.push(describeStream('stderr', expect.stderr))
  if (expect.files) {
    for (const [rel, matcher] of Object.entries(expect.files)) lines.push(describeFile(rel, matcher))
  }
  return lines
}

/** The seeded-file list a `setup` block declares (empty when it seeds none). */
export function describeSetupFiles(setup: GuardSetup | undefined): string[] {
  return setup?.files ? Object.keys(setup.files) : []
}

/** A step's `run` argv as a single command string (empty argv runs the bare entrypoint). */
export function describeRun(run: string[]): string {
  if (run.length === 0) return '(no arguments — runs the entrypoint as-is)'
  return run.map((arg) => (/\s/.test(arg) ? quoted(arg) : arg)).join(' ')
}

/** The whole scenario as a {@link ScenarioStory} — claim + seeded files + per-step words. */
export function describeScenario(scenario: GuardScenario): ScenarioStory {
  return {
    ...(scenario.claim ? { claim: scenario.claim } : {}),
    setupFiles: describeSetupFiles(scenario.setup),
    steps: scenario.steps.map((step) => ({
      run: step.run,
      command: describeRun(step.run),
      ...(step.stdin !== undefined ? { stdin: step.stdin } : {}),
      ...(step.repeat !== undefined && step.repeat > 1 ? { repeat: step.repeat } : {}),
      expectations: describeExpect(step.expect),
    })),
  }
}
