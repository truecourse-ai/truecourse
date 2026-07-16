/**
 * Turn a model's raw scenario into a committed, engine-owned `.tc` scenario:
 * assign a collision-safe id, OVERWRITE the binding from the live section index
 * (never trust what the model wrote), validate against the strict schema, and
 * serialize to YAML. Ownership is tracked by scenario id so regenerating a
 * section replaces only ITS prior generated files and never a hand-written one.
 */

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  GuardScenarioSchema,
  GUARD_FORMAT_VERSION,
  isRunnableDriver,
  type GuardScenario,
} from '@truecourse/shared'
import { slugifyHeading, scenariosDir, loadScenarios } from '@truecourse/guard-runner'
import type { RawGeneratedScenario } from './schemas.js'
import type { SectionInput } from './section-plan.js'

/** The leaf heading segment of an anchor — the id stem (`a/b/rate-limit` → `rate-limit`). */
export function anchorLeaf(anchor: string): string {
  const segs = anchor.split('/').filter(Boolean)
  return slugifyHeading(segs[segs.length - 1] ?? anchor) || 'section'
}

/** `<leaf>.<n>`, skipping any id already taken (hand-written or assigned this run). */
export function assignScenarioId(anchor: string, used: Set<string>): string {
  const leaf = anchorLeaf(anchor)
  for (let n = 1; ; n++) {
    const id = `${leaf}.${n}`
    if (!used.has(id)) {
      used.add(id)
      return id
    }
  }
}

/** The directory a section's generated scenarios land in: its area, else its doc. */
export function areaOrDocSlug(section: SectionInput): string {
  if (section.areaTags.length > 0) return slugifyHeading(section.areaTags[0]) || 'area'
  const base = path.basename(section.doc).replace(/\.[^.]+$/, '')
  return slugifyHeading(base) || 'doc'
}

/** The engine-owned input-corpus binding stamped onto an invariant scenario (item
 *  8): the seeded pack id and the stable sandbox path each corpus file stages to. */
export interface ScenarioInputsBinding {
  pack: string
  as: string
}

/**
 * Build the final scenario: engine-assigned `id`, binding pinned to the live
 * section index (doc + anchor + fingerprint), `guard`/`driver` stamped, the
 * extracted `claim` persisted (so a committed scenario reads as doc-vs-code), and
 * the model's behavioral fields kept. For an invariant claim the engine also stamps
 * `inputs` (the pack it seeded + the staged name) — engine-owned like `binds`, never
 * trusted from the model. Throws if the result fails the strict schema.
 */
export function buildScenario(
  section: SectionInput,
  raw: RawGeneratedScenario,
  id: string,
  claim?: string,
  inputs?: ScenarioInputsBinding,
): GuardScenario {
  // A scenario carries its own driver (a runnable one — you can only author + run
  // for a driver that ships). Validated against the registry, not a hardcoded 'cli'.
  if (!isRunnableDriver(raw.driver)) {
    throw new Error(`scenario driver "${raw.driver}" is not a runnable guard driver`)
  }
  const candidate: unknown = {
    guard: GUARD_FORMAT_VERSION,
    id,
    title: raw.title,
    ...(claim ? { claim } : {}),
    binds: { doc: section.doc, section: section.anchor, fingerprint: section.fingerprint },
    driver: raw.driver,
    ...(raw.setup ? { setup: raw.setup } : {}),
    ...(inputs ? { inputs: { pack: inputs.pack, as: inputs.as } } : {}),
    steps: raw.steps,
    normalize: raw.normalize ?? [],
  }
  return GuardScenarioSchema.parse(candidate)
}

/** Scenario id → absolute file path, across every committed scenario file. */
export function scenarioFileIndex(repoRoot: string): Map<string, string> {
  const root = scenariosDir(repoRoot)
  const map = new Map<string, string>()
  const walk = (dir: string): void => {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && /\.ya?ml$/i.test(entry.name)) {
        try {
          const doc = yaml.load(fs.readFileSync(full, 'utf-8')) as { id?: unknown }
          if (doc && typeof doc.id === 'string') map.set(doc.id, full)
        } catch {
          /* unparseable file — the loader reports it; we just can't own it */
        }
      }
    }
  }
  walk(root)
  return map
}

/** Every committed scenario id — seeds the collision-safe id allocator. */
export function existingScenarioIds(repoRoot: string): Set<string> {
  return new Set(loadScenarios(repoRoot).scenarios.map((s) => s.id))
}

/** The committed YAML form of a scenario — the exact bytes {@link writeScenarioFile}
 *  writes. Reused to carry a ready-but-held candidate's source into the report. */
export function serializeScenarioYaml(scenario: GuardScenario): string {
  return yaml.dump(scenario, { lineWidth: -1, noRefs: true })
}

/** Write a scenario to `<scenarios>/<slug>/<id>.yaml`, returning its repo-relative path. */
export function writeScenarioFile(repoRoot: string, slug: string, scenario: GuardScenario): string {
  const dir = path.join(scenariosDir(repoRoot), slug)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${scenario.id}.yaml`)
  fs.writeFileSync(file, serializeScenarioYaml(scenario))
  return path.relative(repoRoot, file)
}

/** Delete the given ids' committed files (used to replace a section's OWN prior scenarios). */
export function deleteScenarioFiles(repoRoot: string, ids: Iterable<string>): void {
  const index = scenarioFileIndex(repoRoot)
  for (const id of ids) {
    const file = index.get(id)
    if (file && fs.existsSync(file)) fs.rmSync(file)
  }
}
