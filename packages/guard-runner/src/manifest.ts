/**
 * Read/write `.truecourse/scenarios/manifest.json` and rebuild it from the
 * committed scenarios. The manifest is the binding record: one entry per FLOW with
 * the sections it binds and the scenarios realizing it per surface. `guard run`
 * reads it informationally; the binding decisions come from the scenarios' own
 * `binds` checked against the live section index, not from this file.
 */

import fs from 'node:fs'
import {
  GuardManifestSchema,
  GUARD_FORMAT_VERSION,
  flowFingerprint,
  type GuardDriverId,
  type GuardFlowBinding,
  type GuardManifest,
  type GuardManifestFlow,
  type GuardManifestScenario,
  type GuardScenario,
} from '@truecourse/shared'
import { loadScenarios } from './scenario-loader.js'
import { manifestPath, atomicWriteJson } from './store.js'

export { manifestPath } from './store.js'

/** Load + validate the manifest, or `null` when absent or unreadable. */
export function readManifest(repoRoot: string): GuardManifest | null {
  const file = manifestPath(repoRoot)
  if (!fs.existsSync(file)) return null
  try {
    const parsed = GuardManifestSchema.safeParse(JSON.parse(fs.readFileSync(file, 'utf-8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

export function writeManifest(repoRoot: string, manifest: GuardManifest): string {
  const target = manifestPath(repoRoot)
  atomicWriteJson(target, manifest)
  return target
}

/**
 * A hand-written scenario's Manual pseudo-flow: one flow per scenario, its single
 * milestone the scenario's own title at its first bound section, so the corpus is
 * total — every committed scenario is reachable through a flow.
 */
function manualFlow(scenario: GuardScenario): { id: string; fingerprint: string } {
  return {
    id: `manual/${scenario.id}`,
    fingerprint: flowFingerprint([
      {
        order: 1,
        doc: scenario.binds[0].doc,
        anchor: scenario.binds[0].section,
        claimTitle: scenario.title,
      },
    ]),
  }
}

/**
 * Derive the manifest from the committed scenarios: group them by the flow they
 * realize (hand-written scenarios each take their Manual pseudo-flow), union the
 * sections their `binds` name, and record one scenario entry per surface. The
 * generation-inputs hash is left unset — the generator stamps it when it authors.
 */
export function rebuildManifestFromScenarios(repoRoot: string): GuardManifest {
  const { scenarios } = loadScenarios(repoRoot)
  const byFlow = new Map<
    string,
    {
      flowFingerprint: string
      bindings: Map<string, GuardFlowBinding>
      scenarios: GuardManifestScenario[]
      /** Surface → the journeys its scenarios ground on, first-seen order. */
      journeys: Map<GuardDriverId, string[]>
    }
  >()

  for (const s of scenarios) {
    const flow = s.flow ?? manualFlow(s)
    let entry = byFlow.get(flow.id)
    if (!entry) {
      entry = { flowFingerprint: flow.fingerprint, bindings: new Map(), scenarios: [], journeys: new Map() }
      byFlow.set(flow.id, entry)
    }
    for (const b of s.binds) {
      entry.bindings.set(`${b.doc}\x00${b.section}`, {
        doc: b.doc,
        anchor: b.section,
        fingerprint: b.fingerprint,
      })
    }
    // Rebuilding from the committed YAML alone cannot know a test's birth status
    // (the manifest is where that lives), so a recovered entry reads as passing —
    // the next run states the truth.
    entry.scenarios.push({ id: s.id, surface: s.driver, status: 'passing' })
    // Rebuilding from the COMMITTED scenarios can only recover the journeys they
    // actually ground on — a plan the generator made for a surface that authored
    // nothing left no file to read it back from.
    const path = s.journey?.path ?? []
    if (path.length > 0) {
      const ids = entry.journeys.get(s.driver) ?? []
      for (const id of path) if (!ids.includes(id)) ids.push(id)
      entry.journeys.set(s.driver, ids)
    }
  }

  const flows: GuardManifestFlow[] = [...byFlow.entries()]
    .map(([flowId, e]) => ({
      flowId,
      flowFingerprint: e.flowFingerprint,
      bindings: [...e.bindings.values()].sort(
        (a, b) => a.doc.localeCompare(b.doc) || a.anchor.localeCompare(b.anchor),
      ),
      scenarios: e.scenarios.slice().sort((a, b) => a.id.localeCompare(b.id)),
      journeys: [...e.journeys.entries()]
        .map(([surface, journeyIds]) => ({ surface, journeyIds }))
        .sort((a, b) => a.surface.localeCompare(b.surface)),
      generationInputsHash: null,
      gaps: [],
    }))
    .sort((a, b) => a.flowId.localeCompare(b.flowId))

  return { version: GUARD_FORMAT_VERSION, flows }
}
