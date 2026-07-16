/**
 * The behavior-hash identity for per-finding dismissals: ONE derivation for every
 * site that computes a `scenarioHash` — the read-time stamping wrapper, generate's
 * pre-birth filter, and tests all call `scenarioHashFromYaml` on the SERIALIZED
 * scenario yaml. There is no built-object hashing path: byte-identical keys by
 * construction, with no second derivation to skew.
 *
 * The hash covers ONLY the behavioral surface `{driver, setup, steps, normalize}`
 * — the complete set (per-step `expect` lives inside `steps`, `env`/`files`/`git`
 * inside `setup`). `id`/`binds`/`guard` are engine bookkeeping that churns for
 * reasons unrelated to what the test does, and `title` is display-only free text
 * with no stability guarantee — identical behavior IS the same test.
 */

import { createHash } from 'node:crypto'
import yaml from 'js-yaml'
import { z } from 'zod'
import { GuardSetupSchema, GuardStepSchema, GuardNormalizerSchema } from './scenario.js'

/**
 * The lenient derivation gate. `GuardScenarioSchema` is `.strict()` with
 * `guard: z.literal(GUARD_FORMAT_VERSION)`, so it would reject every pre-bump
 * yaml after a format-version bump — it cannot gate the hash. This schema
 * requires ONLY the behavioral fields, each validated by the SAME sub-schemas
 * `GuardScenarioSchema` composes, tolerating any `guard` value, any/missing
 * `id`/`title`/`binds`, and unknown top-level keys.
 *
 * Cross-bump contract, stated openly: identity survives a format-version bump as
 * long as the behavioral SUB-schemas still accept the old yaml. If a future bump
 * changes a behavioral sub-schema incompatibly (a step verb renamed, a normalizer
 * removed), derivation on old yaml fails → no key → those findings are not
 * dismissible until the next generate rewrites them. Accepted graceful
 * degradation. Any change to the behavioral sub-schemas must be reviewed against
 * BOTH this schema and `GuardScenarioSchema` (see the note there).
 */
export const ScenarioBehaviorSchema = z.object({
  driver: z.literal('cli'),
  setup: GuardSetupSchema.optional(),
  steps: z.array(GuardStepSchema).min(1),
  normalize: z.array(GuardNormalizerSchema).default([]),
})
export type ScenarioBehavior = z.infer<typeof ScenarioBehaviorSchema>

/** JSON.stringify with recursively sorted object keys — the canonical form the
 *  hash is computed over, so js-yaml key-order/quoting/style churn can't move it. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Derive the behavior hash from a serialized scenario yaml, or `undefined` when
 * the yaml does not parse or fails behavioral validation (the cross-bump
 * degradation case) — a finding with no hash is simply not dismissible.
 *
 * Forward-compat pick rule (pinned): when a future optional behavioral field is
 * added (e.g. `timeout`), the canonical pick must OMIT it when absent or at its
 * schema default — never "include with default", which would silently orphan
 * every existing dismissal in every committed `decisions.json`. (`setup ?? null`
 * and `normalize`-default-`[]` are the two grandfathered canonicalizations; they
 * predate any persisted hash so they are safe.)
 */
export function scenarioHashFromYaml(yamlString: string): string | undefined {
  let loaded: unknown
  try {
    loaded = yaml.load(yamlString)
  } catch {
    return undefined
  }
  const parsed = ScenarioBehaviorSchema.safeParse(loaded)
  if (!parsed.success) return undefined
  const { driver, setup, steps, normalize } = parsed.data
  const picked = { driver, setup: setup ?? null, steps, normalize }
  return createHash('sha256').update(canonicalJson(picked)).digest('hex').slice(0, 16)
}
