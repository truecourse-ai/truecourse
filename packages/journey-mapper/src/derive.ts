/**
 * The composition that decides which cli derivation a repo gets. The tree is
 * always derived (the primary source, same as every other surface). When a probe
 * executor and a recipe entry exist the probe ladder ALWAYS runs too: a non-empty
 * tree unions with it (per-command grammars merged, disagreements recorded as
 * diagnostics), an empty tree falls back to the probe catalog alone. No probe
 * executor, or nothing to probe, leaves the tree as the only source.
 */

import type {
  FileAnalysis,
  Journey,
  JourneyCatalogSource,
  JourneyDiagnostic,
} from '@truecourse/shared'
import { buildJourneysFromSurface, cliTreeSurface } from './cli-tree.js'
import {
  deriveCliJourneysFromProbes,
  probeCliSurface,
  programNameOf,
  type CliProbeOptions,
} from './cli-probes.js'
import { unionCliSurfaces } from './cli-union.js'

export interface DeriveCliJourneysOptions {
  /** The analyzed working tree. Its `cliCommands` artifacts are the primary source. */
  fileAnalyses?: readonly FileAnalysis[]
  /** Probe half; omitted → the tree is the only source (an empty tree stays empty). */
  probe?: CliProbeOptions
  /**
   * The program's user-facing name: what roots the `cli/root` journey. Falls
   * back to the probe options' name, then to the probe entry's basename; without
   * any of them a tree-declared program level derives no root journey.
   */
  programName?: string
}

export interface CliJourneyCatalog {
  journeys: Journey[]
  source: JourneyCatalogSource
  /** The union's static-vs-runtime disagreements; empty off the union path. */
  diagnostics: JourneyDiagnostic[]
}

/**
 * Derive the cli catalog. `source` records which composition ran: `tree` (no
 * probing possible), `probes` (empty tree, probe catalog alone), or `union`
 * (both ran, catalogs merged and cross-checked).
 */
export async function deriveCliJourneys(
  opts: DeriveCliJourneysOptions,
): Promise<CliJourneyCatalog> {
  const surface = cliTreeSurface(opts.fileAnalyses ?? [])
  const programName =
    opts.programName ??
    opts.probe?.programName ??
    (opts.probe ? programNameOf(opts.probe.entry) : undefined)

  if (!opts.probe) {
    return { journeys: buildJourneysFromSurface(surface, programName), source: 'tree', diagnostics: [] }
  }
  if (surface.seeds.length === 0 && surface.root === null) {
    return { journeys: await deriveCliJourneysFromProbes(opts.probe), source: 'probes', diagnostics: [] }
  }

  const probed = await probeCliSurface(opts.probe)
  const { surface: merged, diagnostics } = unionCliSurfaces(surface, probed)
  return { journeys: buildJourneysFromSurface(merged, programName), source: 'union', diagnostics }
}
