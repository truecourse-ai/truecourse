/**
 * Shared helpers for the guard-generator's validate-then-correct discipline. The
 * runners return the model's raw parsed JSON (unknown); each stage Zod-validates
 * it, and on a schema failure re-asks ONCE with the invalid output quoted back
 * (see the per-stage prompts). These render the two pieces that re-ask needs: a
 * safe-to-embed quote of the offending output and a one-line reason.
 *
 * Beyond schema shape, an authored scenario must obey COMPOSITION rules the
 * schema accepts but the engine cannot execute. One is shared by both drivers —
 * a CAPTURED value is assigned once and readable only by LATER steps
 * (`captureDefects`, the same rule the loader enforces on committed scenarios) —
 * and the rest are PER DRIVER, because the two surfaces compose differently:
 *
 *  - cli — a step's `run` is argv APPENDED to the recipe entrypoint, so `run[0]`
 *    must be an ARGUMENT: never the program's own name again, never a foreign
 *    build/package/runtime binary (`npm test …`, `cargo run …`).
 *  - api — a journey is a CHAIN. A `${var}` only exists if an EARLIER step
 *    captured it, and a `${HTTP_STUB:<name>}` only resolves if this scenario
 *    declares that stub: either miss dies as a run-level infrastructure error
 *    after a sandbox, a build and a boot have been paid for.
 *
 * Every defect here returns a one-line, model-facing reason that seeds the SAME
 * corrective re-ask a schema failure gets — never a silent drop, never a wasted
 * birth run.
 */

import path from 'node:path'
import type { ZodError } from 'zod'
import {
  captureDefects,
  isApiRequestStep,
  type GuardApiStep,
  type GuardStep,
  type GuardSetup,
} from '@truecourse/shared'
import { programNamesOf } from './ground.js'

/** Max chars of an invalid model output quoted back in a corrective re-ask. */
const QUOTE_CAP = 600

/** A safe-to-embed rendering of an invalid model output for a corrective re-ask. */
export function quoteInvalidOutput(raw: unknown): string {
  let text: string
  try {
    text = typeof raw === 'string' ? raw : (JSON.stringify(raw) ?? String(raw))
  } catch {
    text = String(raw)
  }
  return text.length > QUOTE_CAP ? `${text.slice(0, QUOTE_CAP)}…(truncated)` : text
}

/** Flatten a ZodError to a single-line `path: message; …` summary. */
export function flattenZodError(error: ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
}

// --- Composition rules (per driver) ------------------------------------------

/**
 * Well-known build tools, package managers, and language runtimes that are NEVER a
 * legitimate first argument to a CLI under test — a step starting with one of
 * these is the model composing a whole foreign command (`cargo run …`,
 * `npm test …`) instead of the entrypoint's argv. Compared by basename +
 * extensionless stem, so `/usr/bin/python3` and `python3.exe` both land.
 */
const FOREIGN_BINARIES: ReadonlySet<string> = new Set([
  'cargo', 'rustc', 'go', 'gradle', 'mvn', 'maven', 'make', 'cmake', 'bazel', 'ninja',
  'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno', 'node', 'nodejs', 'ts-node', 'tsx',
  'pip', 'pip3', 'pipx', 'poetry', 'python', 'python3', 'py', 'ruby', 'gem', 'bundle',
  'dotnet', 'msbuild', 'java', 'javac', 'gcc', 'g++', 'clang', 'sh', 'bash', 'zsh',
  'docker', 'kubectl', 'terraform',
])

/** The basename and extensionless stem of a token — how `run[0]` is matched. */
function tokenNames(token: string): { base: string; stem: string } {
  const base = path.basename(token)
  return { base, stem: base.replace(/\.[^.]+$/, '') }
}

/**
 * The cli rule: `run` is argv appended to the entrypoint, so its head must be an
 * argument. Returns a model-facing reason naming the offending step and the rule,
 * or null when every step composes.
 */
export function cliCompositionDefect(
  steps: readonly GuardStep[],
  entry: readonly string[],
): string | null {
  const programNames = programNamesOf(entry)
  for (let i = 0; i < steps.length; i++) {
    const head = steps[i].run[0]
    // An omittable pair leads with a FLAG, which is never a program name — the rule
    // has nothing to say about it.
    if (head === undefined || typeof head !== 'string') continue
    const { base, stem } = tokenNames(head)
    const isEntry = programNames.has(head) || programNames.has(base) || programNames.has(stem)
    const isForeign = FOREIGN_BINARIES.has(head) || FOREIGN_BINARIES.has(base) || FOREIGN_BINARIES.has(stem)
    if (!isEntry && !isForeign) continue
    const which = isEntry
      ? `repeats the entrypoint (${JSON.stringify([...entry])})`
      : `is the foreign binary "${head}"`
    return (
      `step ${i + 1}: run[0] "${head}" ${which}. A step's "run" is the argv APPENDED to the ` +
      `entrypoint — it must contain ONLY the arguments (a subcommand and/or flags), never the ` +
      `program name and never another binary. E.g. with entry ${JSON.stringify([...entry])}, to run ` +
      `\`${[...entry, 'check', '--strict'].join(' ')}\` set run: ["check","--strict"].`
    )
  }
  return null
}

/** Every `${name}` a string references, minus the engine's own `${unique}` token. */
const VAR_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

function referencedVars(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    for (const m of value.matchAll(VAR_RE)) if (m[1] !== 'unique') into.add(m[1])
    return
  }
  if (Array.isArray(value)) {
    for (const v of value) referencedVars(v, into)
    return
  }
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) referencedVars(v, into)
  }
}

/** `${HTTP_STUB:<name>}` references in a string — the stub-origin placeholder. */
const STUB_RE = /\$\{HTTP_STUB:([A-Za-z0-9_-]+)\}/g

/**
 * The api rules — a journey has to compose with itself:
 *
 *  1. every `${var}` a step interpolates was captured by an EARLIER step (the
 *     runner throws `UnknownVariableError` mid-run otherwise, which reports as an
 *     infrastructure error rather than as the drift it is not);
 *  2. every `${HTTP_STUB:<name>}` in `setup.env` names a stub this scenario
 *     DECLARES — pointing the app at an undeclared stub leaves that dependency's
 *     base URL aimed at the live, unreachable host.
 *
 * Both are checked before birth, so the correction costs one re-ask instead of a
 * sandbox, a build, a boot and a run.
 */
export function apiCompositionDefect(
  steps: readonly GuardApiStep[],
  setup: GuardSetup | undefined,
): string | null {
  const captured = new Set<string>()
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (!isApiRequestStep(step)) continue
    const used = new Set<string>()
    referencedVars(step.request.path, used)
    referencedVars(step.request.headers, used)
    referencedVars(step.request.body, used)
    referencedVars(step.request.json, used)
    for (const name of used) {
      if (captured.has(name)) continue
      const known = [...captured]
      return (
        `step ${i + 1}: the request interpolates \${${name}}, but no EARLIER step captures a variable ` +
        `by that name. A \${var} comes from a previous step's "capture" (a JSON path into its response ` +
        `body) or "captureHeaders" (a response header) — ${
          known.length > 0
            ? `the variables available at this point are ${known.map((n) => `\${${n}}`).join(', ')}`
            : 'no step before this one captures anything'
        }. Capture it first, or use a literal value.`
      )
    }
    for (const name of Object.keys(step.capture ?? {})) captured.add(name)
    for (const name of Object.keys(step.captureHeaders ?? {})) captured.add(name)
  }

  const declared = new Set(Object.keys(setup?.http ?? {}))
  for (const [key, value] of Object.entries(setup?.env ?? {})) {
    for (const m of value.matchAll(STUB_RE)) {
      if (declared.has(m[1])) continue
      return (
        `setup.env.${key} points at \${HTTP_STUB:${m[1]}}, but this scenario declares no stub named ` +
        `"${m[1]}" under setup.http. ${
          declared.size > 0
            ? `The stubs it declares are: ${[...declared].join(', ')}.`
            : 'It declares no stubs at all.'
        } Either declare that stub (with the routes the app calls) or drop the override — an env var ` +
        `pointed at an undeclared stub leaves the app aimed at the real, unreachable host.`
      )
    }
  }
  return null
}

/**
 * The composition defect of ONE authored scenario, by driver — the single entry
 * point authoring calls before it accepts a scenario. Returns a model-facing
 * one-liner (the corrective re-ask's seed) or null when the scenario composes.
 */
export function scenarioCompositionDefect(
  scenario:
    | { driver: 'cli'; steps: readonly GuardStep[]; setup?: GuardSetup }
    | { driver: 'api'; steps: readonly GuardApiStep[]; setup?: GuardSetup },
  entry: readonly string[] | undefined,
): string | null {
  // The CAPTURED-value rules first, and for both drivers: they are the same
  // sentences the loader reports, so a scenario that would be a permanent load
  // error is corrected by a re-ask instead of being written to disk.
  const capture = captureDefects(scenario.steps, scenario.setup)[0]
  if (capture) return capture.message
  if (scenario.driver === 'cli') {
    // No entry means no cli recipe — authoring never reaches here, and inventing a
    // program name to compare against would fabricate the very rule it enforces.
    return entry && entry.length > 0 ? cliCompositionDefect(scenario.steps, entry) : null
  }
  return apiCompositionDefect(scenario.steps, scenario.setup)
}
