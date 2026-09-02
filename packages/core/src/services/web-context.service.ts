/**
 * THE AUTHORING CONTEXT PASS — one analyzer run per authoring run, turned into
 * the per-place context pack the sessions read.
 *
 * The rules of the pack live in the mapper (`deriveWebPlaceContexts`), pure and
 * testable. THIS module is the adapter: it analyzes the working tree, re-derives
 * the places so the ids agree with the catalog's, resolves the import edges with
 * the analyzer's own module resolution, and joins the api effects against the
 * catalog ON DISK — the ids a session is allowed to name are the ids the catalog
 * carries, so they are read from it rather than re-derived into a second opinion.
 *
 * It is deliberately NOT part of `mapInterfaces`. The mapping runs inside
 * `guard generate` and `guard setup`, where a dependency-graph build over a large
 * monorepo would be a cost nobody asked for; the pack is only ever needed by the
 * command that authors. The place ids still agree, because both sides mint them
 * with the same pure function over the same tree.
 *
 * Degradation is the same everywhere in this pipeline: a pass that throws costs
 * the sessions their grounding, never the run. An empty pack authors exactly as
 * the stage did before the pack existed.
 */

import { buildDependencyGraph } from '@truecourse/analyzer';
import {
  deriveWebPlaceContexts,
  deriveWebPlacesFromTree,
  formWebResources,
  type WebPlaceContext,
} from '@truecourse/interface-mapper';
import type { FileAnalysis, InterfacesFile } from '@truecourse/shared';
import { log } from '../lib/logger.js';
import { analyzeWorkingTree } from './interface.service.js';

export interface DeriveWebAuthoringContextOptions {
  /** Reuse analyses instead of re-reading the tree (a caller that already has them). */
  fileAnalyses?: FileAnalysis[];
  /** The derived catalog whose api ids the effects join to. */
  catalog?: InterfacesFile | null;
}

export interface WebAuthoringContext {
  /** Place id → what the tree says about it. Empty when the pass could not run. */
  contexts: Map<string, WebPlaceContext>;
  /** How many source files the pass analyzed — the size of the fact, for the log. */
  files: number;
  /** Wall-clock seconds the pass took, so a slow repo is visible rather than felt. */
  seconds: number;
}

/**
 * Derive the context pack for every web place of a repository. Amortised over
 * the run: one tree analysis and one graph build for every place authored.
 */
export async function deriveWebAuthoringContext(
  repoRoot: string,
  opts: DeriveWebAuthoringContextOptions = {},
): Promise<WebAuthoringContext> {
  const started = Date.now();
  const empty = (files: number): WebAuthoringContext => ({
    contexts: new Map(),
    files,
    seconds: Math.round((Date.now() - started) / 1000),
  });

  let fileAnalyses: FileAnalysis[];
  try {
    fileAnalyses = opts.fileAnalyses ?? (await analyzeWorkingTree(repoRoot));
  } catch (error) {
    log.warn(`interface authoring: analysis failed, sessions author without context (${errorText(error)})`);
    return empty(0);
  }

  try {
    const { seeds } = formWebResources(deriveWebPlacesFromTree(fileAnalyses));
    if (seeds.size === 0) return empty(fileAnalyses.length);
    const contexts = deriveWebPlaceContexts({
      repoRoot,
      seeds,
      fileAnalyses,
      dependencies: buildDependencyGraph(fileAnalyses, repoRoot),
      apiInterfaces: opts.catalog?.interfaces ?? [],
    });
    return { contexts, files: fileAnalyses.length, seconds: Math.round((Date.now() - started) / 1000) };
  } catch (error) {
    log.warn(`interface authoring: context derivation failed, sessions author without it (${errorText(error)})`);
    return empty(fileAnalyses.length);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
