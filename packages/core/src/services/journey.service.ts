/**
 * Journey mapping — the free, deterministic half of guard: analyze the working
 * tree, derive the journey catalog from it, and snapshot the result to
 * `.truecourse/guard/journeys.json`. No LLM, no analyze store, no prior
 * `truecourse analyze` run: the analyzer is invoked directly on the tree.
 *
 * Degradation is defined, never inherited. A mapper or analyzer failure yields an
 * EMPTY catalog for that surface (whose flows then settle as honest `no-journey`
 * gaps) and never fails the caller — the spec half of the pipeline has to keep
 * working on a repo the mapper chokes on. That includes C# without the Roslyn
 * host: journey mapping is tree-sitter-only, so analyze's hard-fail policy does
 * not extend here.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { analyzeFile, discoverFiles, initParsers } from '@truecourse/analyzer';
import {
  atomicWriteJson,
  computeRecipeFingerprint,
  guardJourneysPath,
  loadRecipe,
  recipePath,
  resolveEntry,
} from '@truecourse/guard-runner';
import {
  createSandboxProbeExec,
  deriveCliJourneys,
  type CliProbeExec,
} from '@truecourse/journey-mapper';
import type { FileAnalysis, Journey, JourneyCatalogSource, JourneysFile } from '@truecourse/shared';
import { log } from '../lib/logger.js';

export interface MapJourneysOptions {
  /** Map these analyses instead of re-analyzing the tree (callers that already have them). */
  fileAnalyses?: FileAnalysis[];
  /**
   * Probe executor for the cli fallback. Defaults to a sandboxed subprocess run
   * against the recipe entry; pass `null` to map from the tree only (no spawning).
   */
  probeExec?: CliProbeExec | null;
}

export interface MapJourneysResult {
  /** The catalog as written to disk. */
  catalog: JourneysFile;
  /** Per journey TYPE → `sha256:…` over that type's sorted journey fingerprints. */
  fingerprints: Record<string, string>;
  /** Absolute path of the snapshot that was written. */
  snapshotPath: string;
}

/**
 * Map the repo's surfaces to journeys and write the snapshot. Returns the catalog
 * plus a per-type fingerprint — the value that tells a caller whether a surface
 * moved without diffing journey lists.
 */
export async function mapJourneys(
  repoPath: string,
  opts: MapJourneysOptions = {},
): Promise<MapJourneysResult> {
  const journeys = await deriveJourneys(repoPath, opts);

  const catalog: JourneysFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    recipeFingerprint: readRecipeFingerprint(repoPath),
    journeys: journeys.journeys,
    source: journeys.source,
  };

  const snapshotPath = guardJourneysPath(repoPath);
  atomicWriteJson(snapshotPath, catalog);

  return { catalog, fingerprints: journeyTypeFingerprints(catalog.journeys), snapshotPath };
}

/**
 * `sha256:…` per journey type over that type's journey fingerprints, sorted so the
 * value depends on the SET of surfaces, not on the order they were derived in.
 */
export function journeyTypeFingerprints(journeys: readonly Journey[]): Record<string, string> {
  const byType = new Map<string, string[]>();
  for (const journey of journeys) {
    const list = byType.get(journey.type) ?? [];
    list.push(journey.fingerprint);
    byType.set(journey.type, list);
  }
  const out: Record<string, string> = {};
  for (const [type, fingerprints] of [...byType.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const body = [...fingerprints].sort().join('\n');
    out[type] = `sha256:${crypto.createHash('sha256').update(body, 'utf-8').digest('hex')}`;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Derivation
// ---------------------------------------------------------------------------

interface DerivedCatalog {
  journeys: Journey[];
  source: Record<string, JourneyCatalogSource>;
}

async function deriveJourneys(
  repoPath: string,
  opts: MapJourneysOptions,
): Promise<DerivedCatalog> {
  let fileAnalyses: readonly FileAnalysis[];
  try {
    fileAnalyses = opts.fileAnalyses ?? (await analyzeWorkingTree(repoPath));
  } catch (error) {
    log.warn(`journey mapping: analysis failed, catalog is empty (${errorText(error)})`);
    return { journeys: [], source: {} };
  }

  try {
    const cli = await deriveCliJourneys({
      fileAnalyses,
      ...(cliProbeOptions(repoPath, opts) ?? {}),
    });
    return { journeys: cli.journeys, source: { cli: cli.source } };
  } catch (error) {
    log.warn(`journey mapping: cli derivation failed, catalog is empty (${errorText(error)})`);
    return { journeys: [], source: {} };
  }
}

/** The probe-fallback config, when this repo has an entrypoint to probe at all. */
function cliProbeOptions(
  repoPath: string,
  opts: MapJourneysOptions,
): { probe: Parameters<typeof deriveCliJourneys>[0]['probe'] } | null {
  if (opts.probeExec === null) return null;
  const entry = recipeEntry(repoPath);
  if (!entry) return null;
  return {
    probe: {
      entry,
      exec: opts.probeExec ?? createSandboxProbeExec(),
      programName: programName(repoPath),
    },
  };
}

/** The recipe's cli entrypoint, resolved to what a sandbox can actually spawn. */
function recipeEntry(repoPath: string): string[] | null {
  let loaded;
  try {
    loaded = loadRecipe(repoPath, recipePath(repoPath));
  } catch {
    return null; // an invalid recipe is the runner's error to report, not the mapper's
  }
  const entry = loaded?.recipe.entry;
  return entry && entry.length > 0 ? resolveEntry(repoPath, entry) : null;
}

function readRecipeFingerprint(repoPath: string): string {
  try {
    return computeRecipeFingerprint(repoPath);
  } catch {
    return '';
  }
}

/**
 * The program's user-facing name: its first `bin` key, else the package name
 * without its scope. Only used to root the probe fallback's root journey.
 */
function programName(repoPath: string): string | undefined {
  let pkg: unknown;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf-8'));
  } catch {
    return undefined;
  }
  if (!pkg || typeof pkg !== 'object') return undefined;
  const bin = (pkg as { bin?: unknown }).bin;
  if (typeof bin === 'string') {
    const name = (pkg as { name?: unknown }).name;
    if (typeof name === 'string' && name) return stripScope(name);
  }
  if (bin && typeof bin === 'object') {
    const first = Object.keys(bin)[0];
    if (first) return first;
  }
  const name = (pkg as { name?: unknown }).name;
  return typeof name === 'string' && name ? stripScope(name) : undefined;
}

function stripScope(name: string): string {
  const scoped = /^@[^/]+\/(.+)$/.exec(name);
  return scoped ? scoped[1] : name;
}

/** Analyze every discovered source file; a file that fails to parse is skipped. */
async function analyzeWorkingTree(repoPath: string): Promise<FileAnalysis[]> {
  await initParsers();
  const analyses: FileAnalysis[] = [];
  for (const file of discoverFiles(repoPath)) {
    try {
      const analysis = await analyzeFile(file);
      if (analysis) analyses.push(analysis);
    } catch {
      // A single unparseable file never costs the whole catalog.
    }
  }
  return analyses;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
