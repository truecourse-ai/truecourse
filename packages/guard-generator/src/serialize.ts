/**
 * Turn a model's raw scenario into a committed, engine-owned scenario: assign the
 * flow's id as the scenario id (one scenario per flow), OVERWRITE the flow,
 * interface, and section references from the engine's own state (never trust what
 * the model wrote), validate against the strict schema, and serialize to YAML. The
 * file carries no scenario-level driver — the driver is the step's.
 * Ownership is tracked by scenario id so regenerating a flow replaces only ITS
 * prior generated files and never a hand-written one.
 */

import fs from 'node:fs'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  GuardScenarioSchema,
  isRunnableDriver,
  interfaceFingerprint,
  type GuardDriverId,
  type GuardFlow,
  type GuardScenario,
  type Interface,
} from '@truecourse/shared'
import { slugifyHeading, scenariosDir, loadScenarios } from '@truecourse/guard-runner'
import { RawGeneratedScenarioSchema, type RawGeneratedScenario } from './schemas.js'
import { flattenZodError } from './validate.js'
import type { SectionInput } from './section-plan.js'

/** The leaf heading segment of an anchor — the id stem (`a/b/rate-limit` → `rate-limit`). */
export function anchorLeaf(anchor: string): string {
  const segs = anchor.split('/').filter(Boolean)
  return slugifyHeading(segs[segs.length - 1] ?? anchor) || 'section'
}

/** The scenario id IS the flow id — one scenario per flow. The numeric fallback
 *  only guards a collision with an id already taken (a hand-written file holding
 *  the name); it is unreachable in ordinary authoring. */
export function assignScenarioId(flowId: string, _surface: GuardDriverId, used: Set<string>): string {
  for (let n = 1; ; n++) {
    const id = n === 1 ? flowId : `${flowId}.${n}`
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
   * The SURFACE this (flow, surface) authoring call was made for — the engine's
   * own, never the model's. It no longer lands in the file (the driver is the
   * step's), but it still gates authoring: you can only author for a driver that
   * ships, and it decides whether the `server` binding below applies.
   */
  surface: GuardDriverId
  /**
   * The recipe server this scenario runs against. ENGINE-ASSIGNED from the
   * app that serves the flow's operations — the model never authors it — and stamped
   * only when it differs from `defaultServer`, since a scenario naming no server
   * already means the default. A single-server repo's YAML is therefore unchanged.
   */
  server?: string
  defaultServer?: string
}): GuardScenario {
  const { flow, interfaces, raw, id, surface, server, defaultServer } = opts
  if (!isRunnableDriver(surface)) {
    throw new Error(`scenario surface "${surface}" is not a runnable guard driver`)
  }
  if (interfaces.length === 0) {
    throw new Error(`scenario "${id}" has no grounding interface — every generated scenario realizes an interface path`)
  }
  const candidate: unknown = {
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
    ...(surface === 'api' && server && server !== defaultServer ? { server } : {}),
    ...(raw.setup ? { setup: raw.setup } : {}),
    steps: raw.steps,
    normalize: raw.normalize ?? [],
  }
  return GuardScenarioSchema.parse(candidate)
}

/**
 * Parse a flow worker's submitted scenario YAML into the RAW authored shape (the
 * same fields the one-shot author returns as JSON: title, setup?, steps,
 * normalize?). Engine-owned fields (`id`, `flow`, `interface`, `binds`, `promise`,
 * `server`) are NEVER read from the model — {@link buildFlowScenario} stamps
 * them — so a worker yaml carrying any is refused with the reason, not silently
 * stripped. Returns a model-facing error line on any defect (the tool result's
 * isError seed).
 */
export function parseRawScenarioYaml(text: string): { raw: RawGeneratedScenario } | { error: string } {
  let loaded: unknown
  try {
    loaded = yaml.load(text)
  } catch (e) {
    return { error: `the yaml does not parse: ${(e as Error).message}` }
  }
  if (loaded === null || typeof loaded !== 'object' || Array.isArray(loaded)) {
    return { error: 'the yaml must be one mapping with the scenario fields (title, setup?, steps, normalize?)' }
  }
  const engineOwned = ['id', 'flow', 'interface', 'binds', 'promise', 'server'].filter((k) => k in (loaded as object))
  if (engineOwned.length > 0) {
    return {
      error:
        `the yaml carries engine-owned field(s) ${engineOwned.join(', ')} — the engine assigns those itself. ` +
        'Author ONLY title, setup?, steps, normalize?.',
    }
  }
  const parsed = RawGeneratedScenarioSchema.safeParse(loaded)
  if (!parsed.success) return { error: `invalid scenario: ${flattenZodError(parsed.error)}` }
  return { raw: parsed.data }
}

/**
 * Parse a COMMITTED-shape scenario yaml (the exact bytes {@link serializeScenarioYaml}
 * produced — the worker cache stores these) back into a {@link GuardScenario}.
 * Null on any defect: a rotten cache entry is a MISS, never a throw.
 */
export function parseScenarioYaml(text: string): GuardScenario | null {
  try {
    const loaded = yaml.load(text)
    const parsed = GuardScenarioSchema.safeParse(loaded)
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
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
