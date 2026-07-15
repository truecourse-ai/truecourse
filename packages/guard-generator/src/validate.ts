/**
 * Shared helpers for the guard-generator's validate-then-correct discipline. The
 * runners return the model's raw parsed JSON (unknown); each stage Zod-validates
 * it, and on a schema failure re-asks ONCE with the invalid output quoted back
 * (see the per-stage prompts). These render the two pieces that re-ask needs: a
 * safe-to-embed quote of the offending output and a one-line reason.
 *
 * Beyond schema shape, authored scenarios must obey a COMPOSITION rule the schema
 * cannot express: a step's `run` is argv APPENDED to the recipe entrypoint, so its
 * first token must be an argument — never the program name again, never a foreign
 * binary. That defect is caught here and routed through the same corrective re-ask.
 */

import path from 'node:path'
import type { ZodError } from 'zod'
import { programNamesOf } from './ground.js'
import type { AuthoredClaim } from './schemas.js'

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

/**
 * Well-known build tools, package managers, and language runtimes that are NEVER a
 * legitimate first argument to a CLI under test — a step starting with one of these
 * is the model composing a whole foreign command (`cargo run …`, `npm test …`)
 * instead of the entrypoint's argv. Compared by basename + extensionless stem.
 */
const FOREIGN_BINARIES: ReadonlySet<string> = new Set([
  'cargo', 'rustc', 'go', 'gradle', 'mvn', 'maven', 'make', 'cmake', 'bazel', 'ninja',
  'npm', 'npx', 'pnpm', 'yarn', 'bun', 'deno', 'node', 'nodejs', 'ts-node', 'tsx',
  'pip', 'pip3', 'pipx', 'poetry', 'python', 'python3', 'py', 'ruby', 'gem', 'bundle',
  'dotnet', 'msbuild', 'java', 'javac', 'gcc', 'g++', 'clang', 'sh', 'bash', 'zsh',
  'docker', 'kubectl', 'terraform', 'sqlfluff',
])

/** The basename and extensionless stem of a token — how run[0] is matched. */
function tokenNames(token: string): { base: string; stem: string } {
  const base = path.basename(token)
  return { base, stem: base.replace(/\.[^.]+$/, '') }
}

/**
 * Find the first authored step whose `run[0]` is a COMPOSITION defect: it repeats the
 * entrypoint's program name, or names a foreign build/package/runtime binary. `run`
 * is argv appended to the entry, so its head must be a subcommand or flag. Returns a
 * one-line, model-facing reason (naming the offending scenario, step, token, and the
 * rule) that seeds the corrective re-ask — or null when every step is argv-only.
 */
export function scenarioCompositionDefect(
  authored: readonly AuthoredClaim[],
  entry: readonly string[],
): string | null {
  const programNames = programNamesOf(entry)
  for (const a of authored) {
    for (const sc of a.scenarios) {
      for (let i = 0; i < sc.steps.length; i++) {
        const head = sc.steps[i].run[0]
        if (head === undefined) continue
        const { base, stem } = tokenNames(head)
        const isEntry = programNames.has(head) || programNames.has(base) || programNames.has(stem)
        const isForeign = FOREIGN_BINARIES.has(head) || FOREIGN_BINARIES.has(base) || FOREIGN_BINARIES.has(stem)
        if (!isEntry && !isForeign) continue
        const which = isEntry
          ? `repeats the entrypoint (${JSON.stringify([...entry])})`
          : `is the foreign binary "${head}"`
        return (
          `scenario "${sc.title}" step ${i + 1}: run[0] "${head}" ${which}. ` +
          `A step's "run" is the argv APPENDED to the entrypoint — it must contain ONLY the arguments ` +
          `(a subcommand and/or flags), never the program name and never another binary. ` +
          `E.g. with entry ${JSON.stringify([...entry])}, to run \`${[...entry, 'check', '--strict'].join(' ')}\` ` +
          `set run: ["check","--strict"]. Re-author with argv-only "run" arrays.`
        )
      }
    }
  }
  return null
}
