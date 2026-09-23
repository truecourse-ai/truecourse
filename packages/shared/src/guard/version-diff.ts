/**
 * The diff between two versions of a scenario set, read off their manifests:
 * which flows were added, retired and amended, which scenarios came and went,
 * and which sections gained or lost coverage. Pure — the store hands it two
 * manifests and the answer is what a version view shows.
 */

import { movedNamedInputs, type GuardManifest, type GuardManifestFlow } from './manifest.js'
import type { ScenarioSetDiff, VersionSectionRef } from '../types/versions.js'

/** The flows a version still derives from the specs, by id. */
function liveFlows(manifest: GuardManifest | null): Map<string, GuardManifestFlow> {
  const live = new Map<string, GuardManifestFlow>()
  for (const flow of manifest?.flows ?? []) {
    if (!flow.orphaned) live.set(flow.flowId, flow)
  }
  return live
}

/** Every scenario id a version holds, live and orphaned alike: an orphaned test is still coverage. */
function scenarioIds(manifest: GuardManifest | null): Set<string> {
  const ids = new Set<string>()
  for (const flow of manifest?.flows ?? []) {
    for (const scenario of flow.scenarios) ids.add(scenario.id)
  }
  return ids
}

/** The sections a version COVERS: bound by a live flow that has a scenario. */
function coveredSections(live: Map<string, GuardManifestFlow>): Map<string, VersionSectionRef> {
  const sections = new Map<string, VersionSectionRef>()
  for (const flow of live.values()) {
    if (flow.scenarios.length === 0) continue
    for (const binding of flow.bindings) {
      sections.set(`${binding.doc}\0${binding.anchor}`, { doc: binding.doc, anchor: binding.anchor })
    }
  }
  return sections
}

function onlyIn<T>(a: Map<string, T>, b: Map<string, T>): string[] {
  return [...a.keys()].filter((key) => !b.has(key)).sort()
}

/** Whether a flow's realization changed between two versions of its entry. */
function flowMoved(prior: GuardManifestFlow, next: GuardManifestFlow): boolean {
  return (
    prior.flowFingerprint !== next.flowFingerprint ||
    prior.generationInputsHash !== next.generationInputsHash
  )
}

export function diffScenarioSets(
  prior: GuardManifest | null,
  next: GuardManifest | null,
): ScenarioSetDiff {
  const before = liveFlows(prior)
  const after = liveFlows(next)

  const amended: ScenarioSetDiff['flows']['amended'] = []
  const kept: string[] = []
  for (const [flowId, flow] of after) {
    const was = before.get(flowId)
    if (!was) continue
    if (flowMoved(was, flow)) {
      amended.push({
        flowId,
        movedInputs: movedNamedInputs(was.generationInputs, flow.generationInputs ?? {}),
      })
    } else {
      kept.push(flowId)
    }
  }

  const scenariosBefore = scenarioIds(prior)
  const scenariosAfter = scenarioIds(next)
  const sectionsBefore = coveredSections(before)
  const sectionsAfter = coveredSections(after)

  return {
    flows: {
      added: onlyIn(after, before),
      retired: onlyIn(before, after),
      amended: amended.sort((a, b) => a.flowId.localeCompare(b.flowId)),
      kept: kept.sort(),
    },
    scenarios: {
      added: [...scenariosAfter].filter((id) => !scenariosBefore.has(id)).sort(),
      removed: [...scenariosBefore].filter((id) => !scenariosAfter.has(id)).sort(),
    },
    sections: {
      gained: onlyIn(sectionsAfter, sectionsBefore).map((key) => sectionsAfter.get(key)!),
      lost: onlyIn(sectionsBefore, sectionsAfter).map((key) => sectionsBefore.get(key)!),
    },
  }
}
