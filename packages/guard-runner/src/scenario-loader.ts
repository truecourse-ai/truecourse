/**
 * Load committed scenarios from `.truecourse/scenarios/**\/*.yaml`, Zod-validate
 * each against the v1 schema, and collect malformed files as load errors rather
 * than crashing the run — one bad file must never take the whole suite down.
 * `recipe.json` is not a scenario and is skipped.
 */

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import { GuardScenarioSchema, type GuardScenario } from '@truecourse/shared'
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
