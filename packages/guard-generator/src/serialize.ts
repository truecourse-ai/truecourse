/**
 * Turn a model's raw scenario into a committed, engine-owned `.tc` scenario:
 * assign a collision-safe `<flow-id>.<surface>.<n>` id, OVERWRITE the flow,
 * interface, and section references from the engine's own state (never trust what
 * the model wrote), validate against the strict schema, and serialize to YAML.
 * Ownership is tracked by scenario id so regenerating a flow replaces only ITS
 * prior generated files and never a hand-written one.
 */

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  GuardScenarioSchema,
  GUARD_FORMAT_VERSION,
  isRunnableDriver,
  interfaceFingerprint,
  type GuardDriverId,
  type GuardFlow,
  type GuardScenario,
  type Interface,
} from '@truecourse/shared'
import { slugifyHeading, scenariosDir, loadScenarios } from '@truecourse/guard-runner'
import type { RawGeneratedScenario } from './schemas.js'
import type { SectionInput } from './section-plan.js'

/** The leaf heading segment of an anchor — the id stem (`a/b/rate-limit` → `rate-limit`). */
export function anchorLeaf(anchor: string): string {
  const segs = anchor.split('/').filter(Boolean)
  return slugifyHeading(segs[segs.length - 1] ?? anchor) || 'section'
}

/** `<flow-id>.<surface>.<n>`, skipping any id already taken (hand-written or
 *  assigned this run) — the documented id scheme, one scenario per (flow, surface). */
export function assignScenarioId(flowId: string, surface: GuardDriverId, used: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = `${flowId}.${surface}.${n}`
    if (!used.has(id)) {
      used.add(id)
      return id
    }
  }
}

/** The directory a flow's generated scenarios land in: its primary section's area,
 *  else that section's doc. A flow spanning areas files under the FIRST milestone's. */
export function areaOrDocSlug(section: SectionInput): string {
  if (section.areaTags.length > 0) return slugifyHeading(section.areaTags[0]) || 'area'
  const base = path.basename(section.doc).replace(/\.[^.]+$/, '')
  return slugifyHeading(base) || 'doc'
}

/**
 * Build the final scenario for one (flow, surface): engine-assigned `id`, the
 * flow's id+fingerprint, the interface path it grounds on (ids + fingerprints), and
 * the flow's section bindings DENORMALIZED into `binds` so the runner resolves
 * staleness with no flow lookup. The model's behavioral fields (title, setup,
 * steps with their `milestone` annotations, normalize) are kept as authored.
 * Throws if the result fails the strict schema.
 */
export function buildFlowScenario(opts: {
  flow: GuardFlow
  interfaces: readonly Interface[]
  raw: RawGeneratedScenario
  id: string
  /**
   * The recipe server this scenario runs against. ENGINE-ASSIGNED from the
   * app that serves the flow's operations — the model never authors it — and stamped
   * only when it differs from `defaultServer`, since a scenario naming no server
   * already means the default. A single-server repo's YAML is therefore unchanged.
   */
  server?: string
  defaultServer?: string
}): GuardScenario {
  const { flow, interfaces, raw, id, server, defaultServer } = opts
  // A scenario carries its own driver (a runnable one — you can only author + run
  // for a driver that ships). Validated against the registry, not a hardcoded 'cli'.
  if (!isRunnableDriver(raw.driver)) {
    throw new Error(`scenario driver "${raw.driver}" is not a runnable guard driver`)
  }
  if (interfaces.length === 0) {
    throw new Error(`scenario "${id}" has no grounding interface — every generated scenario realizes an interface path`)
  }
  const candidate: unknown = {
    guard: GUARD_FORMAT_VERSION,
    id,
    title: raw.title,
    // The promise in plain words, denormalized off the flow: a reader of the file
    // alone (a reviewer in a diff) knows what it is FOR without
    // resolving `flow.id` against a `flows.json` that re-synthesis may have moved.
    promise: flow.goal,
    flow: { id: flow.id, fingerprint: flow.fingerprint },
    interface: {
      path: interfaces.map((j) => j.id),
      fingerprints: interfaces.map((j) => j.fingerprint || interfaceFingerprint(j)),
    },
    binds: flow.bindings.map((b) => ({ doc: b.doc, section: b.anchor, fingerprint: b.fingerprint })),
    driver: raw.driver,
    ...(raw.driver === 'api' && server && server !== defaultServer ? { server } : {}),
    ...(raw.setup ? { setup: raw.setup } : {}),
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
