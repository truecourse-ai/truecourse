/**
 * Turn a model's raw scenario into a committed, engine-owned `.tc` scenario:
 * assign a collision-safe `<flow-id>.<surface>.<n>` id, OVERWRITE the flow,
 * journey, and section references from the engine's own state (never trust what
 * the model wrote), validate against the strict schema, and serialize to YAML.
 * Ownership is tracked by scenario id so regenerating a flow replaces only ITS
 * prior generated files and never a hand-written one.
 */

import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import yaml from 'js-yaml'
import {
  GuardScenarioSchema,
  GUARD_FORMAT_VERSION,
  isRunnableDriver,
  journeyFingerprint,
  type GuardDriverId,
  type GuardFlow,
  type GuardScenario,
  type Journey,
} from '@truecourse/shared'
import {
  slugifyHeading,
  scenariosDir,
  loadScenarios,
  scenarioSeedSidecarPath,
  type ScenarioArtifact,
} from '@truecourse/guard-runner'
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
 * flow's id+fingerprint, the journey path it grounds on (ids + fingerprints), and
 * the flow's section bindings DENORMALIZED into `binds` so the runner resolves
 * staleness with no flow lookup. The model's behavioral fields (title, setup,
 * steps with their `milestone` annotations, normalize) are kept as authored.
 * Throws if the result fails the strict schema.
 */
export function buildFlowScenario(opts: {
  flow: GuardFlow
  journeys: readonly Journey[]
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
  const { flow, journeys, raw, id, server, defaultServer } = opts
  // A scenario carries its own driver (a runnable one — you can only author + run
  // for a driver that ships). Validated against the registry, not a hardcoded 'cli'.
  if (!isRunnableDriver(raw.driver)) {
    throw new Error(`scenario driver "${raw.driver}" is not a runnable guard driver`)
  }
  if (journeys.length === 0) {
    throw new Error(`scenario "${id}" has no grounding journey — every generated scenario realizes a journey path`)
  }
  const candidate: unknown = {
    guard: GUARD_FORMAT_VERSION,
    id,
    title: raw.title,
    // The promise in plain words, denormalized off the flow: a reader of the file
    // alone (a story renderer, a reviewer in a diff) knows what it is FOR without
    // resolving `flow.id` against a `flows.json` that re-synthesis may have moved.
    promise: flow.goal,
    flow: { id: flow.id, fingerprint: flow.fingerprint },
    journey: {
      path: journeys.map((j) => j.id),
      fingerprints: journeys.map((j) => j.fingerprint || journeyFingerprint(j)),
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

interface ScenarioPairSnapshot {
  yaml: Buffer | null
  sidecar: Buffer | null
}

function snapshotScenarioPair(yamlFile: string, sidecarFile: string): ScenarioPairSnapshot {
  return {
    yaml: fs.existsSync(yamlFile) ? fs.readFileSync(yamlFile) : null,
    sidecar: fs.existsSync(sidecarFile) ? fs.readFileSync(sidecarFile) : null,
  }
}

function restoreFile(file: string, prior: Buffer | null): void {
  if (prior === null) {
    if (fs.existsSync(file)) fs.rmSync(file)
    return
  }
  fs.writeFileSync(file, prior)
}

/** Restore both members to their exact prior bytes when a pair mutation fails. */
function updateScenarioPair<T>(yamlFile: string, sidecarFile: string, mutate: () => T): T {
  const prior = snapshotScenarioPair(yamlFile, sidecarFile)
  try {
    return mutate()
  } catch (error) {
    restoreFile(yamlFile, prior.yaml)
    restoreFile(sidecarFile, prior.sidecar)
    throw error
  }
}

/** Write a scenario to `<scenarios>/<slug>/<id>.yaml`, returning its repo-relative path. */
export function writeScenarioFile(repoRoot: string, slug: string, scenario: GuardScenario): string {
  const dir = path.join(scenariosDir(repoRoot), slug)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${scenario.id}.yaml`)
  const sidecar = scenarioSeedSidecarPath(file)
  const staged = `${file}.${randomUUID()}.tmp`
  try {
    updateScenarioPair(file, sidecar, () => {
      fs.writeFileSync(staged, serializeScenarioYaml(scenario))
      fs.renameSync(staged, file)
      if (fs.existsSync(sidecar)) fs.rmSync(sidecar)
    })
  } finally {
    if (fs.existsSync(staged)) fs.rmSync(staged)
  }
  return path.relative(repoRoot, file)
}

/**
 * Commit one generated YAML/sidecar pair as a unit. Both new files are fully
 * staged in the destination directory before either target moves. If a rename
 * fails, the exact prior bytes are restored so callers never observe a mixed
 * old/new pair after this operation returns an error.
 */
export function writeScenarioArtifact(repoRoot: string, artifact: ScenarioArtifact): string {
  const yamlFile = path.resolve(repoRoot, artifact.source.path)
  const expectedRoot = path.resolve(scenariosDir(repoRoot))
  if (yamlFile !== expectedRoot && !yamlFile.startsWith(`${expectedRoot}${path.sep}`)) {
    throw new Error(`generated scenario path escapes the scenario tree: ${artifact.source.path}`)
  }
  const seedRel = scenarioSeedSidecarPath(artifact.source.path)
  const sidecarFile = path.resolve(repoRoot, seedRel)
  const companions = Object.entries(artifact.companions)
  if (companions.length !== 1 || companions[0][0] !== seedRel) {
    throw new Error(`generated seed companion must be exactly ${seedRel}`)
  }

  fs.mkdirSync(path.dirname(yamlFile), { recursive: true })
  const token = randomUUID()
  const stagedYaml = `${yamlFile}.${token}.tmp`
  const stagedSidecar = `${sidecarFile}.${token}.tmp`
  try {
    updateScenarioPair(yamlFile, sidecarFile, () => {
      fs.writeFileSync(stagedYaml, artifact.source.content)
      fs.writeFileSync(stagedSidecar, companions[0][1])
      fs.renameSync(stagedSidecar, sidecarFile)
      fs.renameSync(stagedYaml, yamlFile)
    })
  } finally {
    if (fs.existsSync(stagedYaml)) fs.rmSync(stagedYaml)
    if (fs.existsSync(stagedSidecar)) fs.rmSync(stagedSidecar)
  }
  return path.relative(repoRoot, yamlFile)
}

/** Delete the given ids' committed files (used to replace a section's OWN prior scenarios). */
export function deleteScenarioFiles(repoRoot: string, ids: Iterable<string>): void {
  const index = scenarioFileIndex(repoRoot)
  for (const id of ids) {
    const file = index.get(id)
    if (file && fs.existsSync(file)) {
      const sidecar = scenarioSeedSidecarPath(file)
      updateScenarioPair(file, sidecar, () => {
        if (fs.existsSync(sidecar)) fs.rmSync(sidecar)
        fs.rmSync(file)
      })
    }
  }
}
