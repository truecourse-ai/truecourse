/**
 * Load committed scenarios from `.truecourse/scenarios/**\/*.yaml`, Zod-validate
 * each against the scenario schema (plus the regex-compile check the schema cannot
 * express), and collect malformed files as load errors rather than crashing the
 * run — one bad file must never take the whole suite down. `recipe.json` is not a
 * scenario and is skipped.
 *
 * Only the CURRENT format version parses. A file carrying an older `guard:` version
 * gets one actionable line naming the cutover instead of a schema dump, because
 * every field a re-generation would change (plural `binds`, the `flow`/`journey`
 * refs) would otherwise report as an unrelated validation error.
 */

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  GUARD_FORMAT_VERSION,
  GuardScenarioSchema,
  firstInvalidMatchPattern,
  type GuardScenario,
} from '@truecourse/shared'
import { readGuardClaimsCorpus, readGuardFlowsCorpus, scenariosDir } from './store.js'
import { crossCheckClaimRefs } from './claim-refs.js'
import { crossCheckCaptureRefs } from './capture-refs.js'

export interface ScenarioLoadError {
  /** Repo-relative path of the offending file. */
  file: string
  message: string
}

export interface LoadedScenarios {
  scenarios: GuardScenario[]
  errors: ScenarioLoadError[]
}

/** Recursively collect `*.yaml` / `*.yml` files under the scenarios dir. */
function collectScenarioFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectScenarioFiles(full))
    else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) out.push(full)
  }
  return out.sort()
}

/**
 * Posix-relative paths of every committable scenario-tree file under `root`
 * (an on-disk `.truecourse/scenarios/` dir), sorted: every `*.yaml` / `*.yml`
 * at any depth plus the top-level `recipe.json` / `manifest.json` / `flows.json` /
 * `claims.json` / `dependencies.json`.
 * The user-authored `decisions.json` is NOT a scenario body — it routes to the
 * decisions store — so it is excluded, and so is the gitignored
 * `dependencies.local.json`, which is this machine's instances and must never be
 * snapshotted anywhere. This is the corpus-membership rule the file and Pg guard
 * stores share.
 *
 * `flows.json`, `claims.json` and `dependencies.json` belong here because they are
 * read back through the same store seam: a store that snapshots by this walk
 * without them would silently lose the flow corpus (degrading every flow to a
 * manifest-derived, id-titled row), the claim corpus every milestone reference
 * resolves against, and the dependency catalog every supplied binding gates on —
 * which would silently turn a `blocked` scenario into one that runs against
 * nothing.
 */
const SCENARIO_ROOT_FILES = [
  'recipe.json',
  'manifest.json',
  'flows.json',
  'claims.json',
  'dependencies.json',
]

export function walkScenarioRelFiles(root: string): string[] {
  const out: string[] = []
  const walk = (rel: string): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) walk(childRel)
      else if (e.isFile()) {
        if (/\.ya?ml$/i.test(e.name)) out.push(childRel)
        else if (rel === '' && SCENARIO_ROOT_FILES.includes(e.name)) out.push(childRel)
      }
    }
  }
  walk('')
  return out.sort()
}

/**
 * The `guard:` version a document declares, when it declares one at all — the
 * discriminator that tells an outdated scenario apart from a malformed one.
 */
function declaredFormatVersion(doc: unknown): number | null {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return null
  const value = (doc as Record<string, unknown>).guard
  return typeof value === 'number' ? value : null
}

/** The one-line, actionable message an out-of-date scenario file reports. */
export function outdatedFormatMessage(version: number): string {
  return `scenario format v${version} is no longer supported (this build reads guard: ${GUARD_FORMAT_VERSION}) — re-run \`truecourse guard generate\` to re-author the corpus in the current format`
}

export function loadScenarios(repoRoot: string): LoadedScenarios {
  const root = scenariosDir(repoRoot)
  const scenarios: GuardScenario[] = []
  const errors: ScenarioLoadError[] = []
  /** Which file each parsed scenario came from — the attribution a claim-ref error needs. */
  const fileOf = new Map<GuardScenario, string>()

  for (const file of collectScenarioFiles(root)) {
    const rel = path.relative(repoRoot, file)
    let doc: unknown
    try {
      doc = yaml.load(fs.readFileSync(file, 'utf-8'))
    } catch (e) {
      errors.push({ file: rel, message: `YAML parse error: ${e instanceof Error ? e.message : e}` })
      continue
    }
    const declared = declaredFormatVersion(doc)
    if (declared !== null && declared !== GUARD_FORMAT_VERSION) {
      errors.push({ file: rel, message: outdatedFormatMessage(declared) })
      continue
    }
    const parsed = GuardScenarioSchema.safeParse(doc)
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        .join('; ')
      errors.push({ file: rel, message: detail })
      continue
    }
    // A `matches` source the schema accepts but `new RegExp` rejects would throw
    // (log matcher) or silently never match (stream/body/json) mid-run, after a
    // sandbox execution has already been paid for. Fail loud at load instead.
    const badRe = firstInvalidMatchPattern(parsed.data.steps)
    if (badRe) {
      errors.push({
        file: rel,
        message: `step ${badRe.step} ${badRe.where} /${badRe.pattern}/ is not a valid regular expression: ${badRe.error}`,
      })
      continue
    }
    fileOf.set(parsed.data, rel)
    scenarios.push(parsed.data)
  }

  // Detect duplicate ids — they would collide in the section rollup and evidence dirs.
  const seen = new Map<string, string>()
  const deduped: GuardScenario[] = []
  const files: Array<{ scenario: GuardScenario; file: string }> = []
  for (const s of scenarios) {
    const prior = seen.get(s.id)
    if (prior) {
      errors.push({ file: prior, message: `duplicate scenario id "${s.id}"` })
      continue
    }
    seen.set(s.id, s.id)
    deduped.push(s)
    files.push({ scenario: s, file: fileOf.get(s) ?? s.id })
  }

  // Every claim reference this corpus makes, resolved against the claims store —
  // a dangling one is a corpus defect, and it belongs in the same load-error feed
  // as a malformed file rather than vanishing into a silently smaller denominator.
  errors.push(
    ...crossCheckClaimRefs({
      claims: readGuardClaimsCorpus(repoRoot),
      flows: readGuardFlowsCorpus(repoRoot),
      scenarios: files,
    }),
  )

  // Every CAPTURED-value rule that spans steps — single assignment, and no forward
  // or self reference. Same feed, same reason: a scenario whose chain does not
  // compose is a corpus defect, not something to discover halfway through a run.
  errors.push(...crossCheckCaptureRefs(files))

  return { scenarios: deduped, errors }
}
