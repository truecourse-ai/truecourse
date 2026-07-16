/**
 * Load committed scenarios from `.truecourse/scenarios/**\/*.yaml`, Zod-validate
 * each against the v1 schema (plus the `expect` `matches` compile check the schema
 * cannot express), and collect malformed files as load errors rather than crashing
 * the run — one bad file must never take the whole suite down. `recipe.json` is not
 * a scenario and is skipped.
 */

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { GuardScenarioSchema, firstInvalidMatchPattern, type GuardScenario } from '@truecourse/shared'
import { scenariosDir } from './store.js'

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
        if (/\.ya?ml$/i.test(e.name)) out.push(childRel)
        else if (rel === '' && (e.name === 'recipe.json' || e.name === 'manifest.json')) {
          out.push(childRel)
        }
      }
    }
  }
  walk('')
  return out.sort()
}

export function loadScenarios(repoRoot: string): LoadedScenarios {
  const root = scenariosDir(repoRoot)
  const scenarios: GuardScenario[] = []
  const errors: ScenarioLoadError[] = []

  for (const file of collectScenarioFiles(root)) {
    const rel = path.relative(repoRoot, file)
    let doc: unknown
    try {
      doc = yaml.load(fs.readFileSync(file, 'utf-8'))
    } catch (e) {
      errors.push({ file: rel, message: `YAML parse error: ${e instanceof Error ? e.message : e}` })
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
    const badRe = firstInvalidMatchPattern(parsed.data.steps)
    if (badRe) {
      errors.push({
        file: rel,
        message: `step ${badRe.step} expect.${badRe.stream} "matches" /${badRe.pattern}/ is not a valid regular expression: ${badRe.error}`,
      })
      continue
    }
    scenarios.push(parsed.data)
  }

  // Detect duplicate ids — they would collide in the section rollup and evidence dirs.
  const seen = new Map<string, string>()
  const deduped: GuardScenario[] = []
  for (const s of scenarios) {
    const prior = seen.get(s.id)
    if (prior) {
      errors.push({ file: prior, message: `duplicate scenario id "${s.id}"` })
      continue
    }
    seen.set(s.id, s.id)
    deduped.push(s)
  }

  return { scenarios: deduped, errors }
}
