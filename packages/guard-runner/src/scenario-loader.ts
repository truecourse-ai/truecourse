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
import { scenariosDir } from './store.js'

export interface ScenarioLoadError {
  /** Repo-relative path of the offending file. */
  file: string
  message: string
}

/** One source file that belongs to a scenario artifact. */
export interface ScenarioArtifactSource {
  /** Repo-relative POSIX path, used as the source identity across local and hosted execution. */
  path: string
  /** Exact source bytes decoded as UTF-8. */
  content: string
}

/**
 * A parsed scenario together with the sources required to execute it. Keeping the
 * source identity beside the parsed value lets generated candidates cross the
 * executor seam without first being written into the committed corpus.
 */
export interface ScenarioArtifact {
  scenario: GuardScenario
  source: ScenarioArtifactSource
  /** Repo-relative path -> exact companion source. Empty for every seedless scenario. */
  companions: Record<string, string>
}

export interface LoadedScenarios {
  /** Source-backed artifacts for execution/storage boundaries. */
  artifacts: ScenarioArtifact[]
  /** Parsed-scenario compatibility view retained for existing inventory callers. */
  scenarios: GuardScenario[]
  errors: ScenarioLoadError[]
}

/** Adjacent sidecar path derived only from the YAML source identity. */
export function scenarioSeedSidecarPath(scenarioFile: string): string {
  return scenarioFile.replace(/\.ya?ml$/i, '.seed.mjs')
}

/** Recursively collect files matching `accept` under the scenarios dir. */
function collectFiles(dir: string, accept: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return []
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...collectFiles(full, accept))
    else if (entry.isFile() && accept(entry.name)) out.push(full)
  }
  return out.sort()
}

/** Recursively collect `*.yaml` / `*.yml` files under the scenarios dir. */
function collectScenarioFiles(dir: string): string[] {
  return collectFiles(dir, (name) => /\.ya?ml$/i.test(name))
}

/** Recursively collect adjacent executable scenario seed sidecars. */
function collectScenarioSeedFiles(dir: string): string[] {
  return collectFiles(dir, (name) => name.endsWith('.seed.mjs'))
}

/**
 * Posix-relative paths of every committable scenario-tree file under `root`
 * (an on-disk `.truecourse/scenarios/` dir), sorted: every `*.yaml` / `*.yml`
 * at any depth plus the top-level `recipe.json` / `manifest.json`. The
 * user-authored `decisions.json` is NOT a scenario body — it routes to the
 * decisions store — so it is excluded. This is the corpus-membership rule the
 * file and Pg guard stores share.
 */
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
        if (/\.ya?ml$/i.test(e.name) || e.name.endsWith('.seed.mjs')) out.push(childRel)
        else if (rel === '' && (e.name === 'recipe.json' || e.name === 'manifest.json')) {
          out.push(childRel)
        }
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
  const artifacts: ScenarioArtifact[] = []
  const errors: ScenarioLoadError[] = []
  const claimedSidecars = new Set<string>()

  for (const file of collectScenarioFiles(root)) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/')
    let content: string
    let doc: unknown
    try {
      content = fs.readFileSync(file, 'utf-8')
      doc = yaml.load(content)
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
    const companions: Record<string, string> = {}
    if (parsed.data.driver === 'api' && parsed.data.setup?.seed) {
      const sidecar = scenarioSeedSidecarPath(file)
      const sidecarRel = path.relative(root, sidecar).split(path.sep).join('/')
      try {
        if (!fs.existsSync(sidecar) || !fs.statSync(sidecar).isFile()) {
          errors.push({
            file: rel,
            message: `scenario declares setup.seed but adjacent sidecar "${sidecarRel}" is missing`,
          })
          continue
        }
        const companionRel = path.relative(repoRoot, sidecar).split(path.sep).join('/')
        companions[companionRel] = fs.readFileSync(sidecar, 'utf-8')
        claimedSidecars.add(path.resolve(sidecar))
      } catch (error) {
        errors.push({
          file: rel,
          message: `could not load adjacent seed sidecar "${sidecarRel}": ${error instanceof Error ? error.message : error}`,
        })
        continue
      }
    }
    artifacts.push({
      scenario: parsed.data,
      source: { path: rel, content },
      companions,
    })
  }

  for (const sidecar of collectScenarioSeedFiles(root)) {
    if (claimedSidecars.has(path.resolve(sidecar))) continue
    errors.push({
      file: path.relative(repoRoot, sidecar).split(path.sep).join('/'),
      message: 'orphan scenario seed sidecar has no adjacent YAML declaring setup.seed',
    })
  }

  // Detect duplicate ids — they would collide in the section rollup and evidence dirs.
  const seen = new Map<string, string>()
  const deduped: ScenarioArtifact[] = []
  for (const artifact of artifacts) {
    const s = artifact.scenario
    const prior = seen.get(s.id)
    if (prior) {
      errors.push({ file: prior, message: `duplicate scenario id "${s.id}"` })
      continue
    }
    seen.set(s.id, s.id)
    deduped.push(artifact)
  }

  return { artifacts: deduped, scenarios: deduped.map((artifact) => artifact.scenario), errors }
}
