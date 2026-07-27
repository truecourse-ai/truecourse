/**
 * Tree-first, probes-second: the composition that decides which cli derivation a
 * repo gets. The tree is the primary source for every surface; probing is a
 * degradation for CLIs built on a framework no extractor reads yet, and the
 * catalog records which one it got so the gap language downstream stays honest.
 */

import type { FileAnalysis, Journey, JourneyCatalogSource } from '@truecourse/shared'
import { deriveCliJourneysFromTree } from './cli-tree.js'
import { deriveCliJourneysFromProbes, type CliProbeOptions } from './cli-probes.js'

export interface DeriveCliJourneysOptions {
  /** The analyzed working tree. Its `cliCommands` artifacts are the primary source. */
  fileAnalyses?: readonly FileAnalysis[]
  /** Probe fallback; omitted → the tree is the only source (an empty tree stays empty). */
  probe?: CliProbeOptions
}

export interface CliJourneyCatalog {
  journeys: Journey[]
  source: JourneyCatalogSource
}

/**
 * Derive the cli catalog. The probe ladder runs ONLY when the tree yields no
 * commands at all — a partially-read tree is still tree truth, and mixing the two
 * would double-count the commands both sources see.
 */
export async function deriveCliJourneys(
  opts: DeriveCliJourneysOptions,
): Promise<CliJourneyCatalog> {
  const fromTree = deriveCliJourneysFromTree(opts.fileAnalyses ?? [])
  if (fromTree.length > 0 || !opts.probe) return { journeys: fromTree, source: 'tree' }
  return { journeys: await deriveCliJourneysFromProbes(opts.probe), source: 'probes' }
}
