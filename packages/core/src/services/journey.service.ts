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
import {
  analyzeFile,
  collectDatastoreUrls,
  collectOutboundRequests,
  detectDatabases,
  detectExternalServices,
  deriveOwnHosts,
  detectServices,
  discoverFiles,
  initParsers,
  DATABASE_IMPORT_MAP,
} from '@truecourse/analyzer';
import {
  atomicWriteJson,
  computeRecipeFingerprint,
  corpusKeptDocs,
  guardJourneysPath,
  loadRecipe,
  nodeRefContext,
  recipeControlledEnvVars,
  recipePath,
  resolveEntry,
} from '@truecourse/guard-runner';
import {
  collectApiRequestContracts,
  createSandboxProbeExec,
  deriveApiJourneysFromTree,
  deriveCliJourneys,
  type ApiSpecOperation,
  type CliProbeExec,
} from '@truecourse/journey-mapper';
import { deriveOpenApiSections, isOpenApiDoc } from '@truecourse/shared/openapi';
import type { SeedDraftDatabase } from '@truecourse/guard-generator';
import type {
  ApiRequestContract,
  DatastoreUrlRef,
  DetectedExternalService,
  OutboundRequest,
  FileAnalysis,
  Journey,
  JourneyCatalogSource,
  JourneysFile,
} from '@truecourse/shared';
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
  /**
   * The third parties the analyzed tree imports, read off the SAME
   * `FileAnalysis[]` the journeys were derived from — a pure registry match, no
   * second pass. Deliberately NOT part of the snapshot: it is a fact about the
   * working tree, re-derived every mapping, never a stale committed claim.
   */
  externalServices: DetectedExternalService[];
  /**
   * The repo's datastore + its PARSED schema, read off the SAME
   * `FileAnalysis[]` — the grounding the seed-drafting stage needs. `null` when
   * nothing was detected, or when detection threw: a seed is never drafted against
   * a schema nobody read.
   */
  database: SeedDraftDatabase | null;
  /**
   * The datastore connection URLs the tree WRITES DOWN, off the same
   * `FileAnalysis[]`. The recipe proposer generates a compose file from them for a
   * repo that needs a database and ships none; like the two fields above it is a
   * fact about the working tree, never snapshotted.
   */
  datastoreUrls: DatastoreUrlRef[];
  /**
   * What each api operation's handler reads off the request, off the same
   * `FileAnalysis[]` — the grounding scenario authoring needs to send a body the app
   * will accept. Like the fields above it is a fact about the working tree, never
   * snapshotted.
   */
  requestContracts: ApiRequestContract[];
  /**
   * How the app CONSTRUCTS its outbound requests and which response fields it reads
   * back — the grounding a `setup.http` stub needs to be accepted by the
   * app it is stubbing for. Same pass, same non-snapshot rule.
   */
  outboundRequests: OutboundRequest[];
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

  return {
    catalog,
    fingerprints: journeyTypeFingerprints(catalog.journeys),
    snapshotPath,
    externalServices: journeys.externalServices,
    database: journeys.database,
    datastoreUrls: journeys.datastoreUrls,
    requestContracts: journeys.requestContracts,
    outboundRequests: journeys.outboundRequests,
  };
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
  externalServices: DetectedExternalService[];
  database: SeedDraftDatabase | null;
  datastoreUrls: DatastoreUrlRef[];
  requestContracts: ApiRequestContract[];
  outboundRequests: OutboundRequest[];
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
    return {
      journeys: [],
      source: {},
      externalServices: [],
      database: null,
      datastoreUrls: [],
      requestContracts: [],
      outboundRequests: [],
    };
  }

  // Per-surface degradation: one surface's derivation failing empties THAT
  // catalog only — its flows settle as honest `no-journey` gaps while the other
  // surfaces keep grounding.
  const journeys: Journey[] = [];
  const source: Record<string, JourneyCatalogSource> = {};

  try {
    const cli = await deriveCliJourneys({
      fileAnalyses,
      ...(cliProbeOptions(repoPath, opts) ?? {}),
    });
    journeys.push(...cli.journeys);
    source.cli = cli.source;
  } catch (error) {
    log.warn(`journey mapping: cli derivation failed, cli catalog is empty (${errorText(error)})`);
  }

  try {
    journeys.push(...deriveApiJourneysFromTree(fileAnalyses, readOpenApiOperations(repoPath)));
    source.api = 'tree';
  } catch (error) {
    log.warn(`journey mapping: api derivation failed, api catalog is empty (${errorText(error)})`);
  }

  return {
    journeys,
    source,
    externalServices: detectExternalServices(fileAnalyses, {
      ownHosts: repoOwnHosts(repoPath, fileAnalyses),
    }),
    database: detectDatabaseContext(repoPath, fileAnalyses),
    datastoreUrls: collectDatastoreUrls(fileAnalyses),
    // The two authoring-grounding products. Degrade like every other derivation here:
    // a collector that throws costs authoring its grounding, never the run.
    requestContracts: safely('request contracts', () => collectApiRequestContracts(fileAnalyses)),
    outboundRequests: safely('outbound requests', () => collectOutboundRequests(fileAnalyses)),
  };
}

/**
 * The hosts this repo OWNS, so its self-referencing URL literals (an env-var
 * fallback pointing at its own production origin) never mint a fake third-party
 * service that blocks flows on "the app itself". Both sources come from the
 * recipe: the explicit `ownHosts` declaration, and the URL fallbacks of env vars
 * the recipe pins (see `deriveOwnHosts`). No recipe, or an invalid one, derives
 * nothing — detection then reports every host, exactly as before.
 */
function repoOwnHosts(repoPath: string, fileAnalyses: readonly FileAnalysis[]): string[] {
  let recipe;
  try {
    recipe = loadRecipe(repoPath, recipePath(repoPath))?.recipe;
  } catch {
    return []; // an invalid recipe is the runner's error to report, not the mapper's
  }
  if (!recipe) return [];
  return deriveOwnHosts(fileAnalyses, {
    ...(recipe.ownHosts ? { declaredHosts: recipe.ownHosts } : {}),
    controlledEnvVars: recipeControlledEnvVars(recipe),
  });
}

/** Run a pure derivation, degrading to an empty list with a logged reason. */
function safely<T>(what: string, derive: () => T[]): T[] {
  try {
    return derive();
  } catch (error) {
    log.warn(`journey mapping: ${what} failed, authoring loses that grounding (${errorText(error)})`);
    return [];
  }
}

/**
 * The datastore the seed-drafting stage grounds on: the detected database with a
 * PARSED schema (the schema-parser registry's output), plus the lines the app's own
 * files import its client with — a draft must import it the same way. Degrades to
 * `null` exactly like every other derivation here: a detector that throws costs the
 * seed stage its grounding, never the run.
 */
function detectDatabaseContext(
  repoPath: string,
  fileAnalyses: readonly FileAnalysis[],
): SeedDraftDatabase | null {
  try {
    const services = detectServices(repoPath, fileAnalyses.map((a) => a.filePath));
    const { databases } = detectDatabases(repoPath, [...fileAnalyses], services);
    // A datastore WITH a parsed schema wins over one detected by driver alone —
    // the schema is the whole grounding, and a repo can carry both (a cache and a
    // relational store) with only one of them parseable.
    const primary = databases.find((d) => d.tables.length > 0) ?? databases[0];
    if (!primary) return null;
    return {
      type: primary.type,
      driver: primary.driver,
      tables: primary.tables.map((t) => ({ name: t.name, columns: t.columns.map((c) => ({ ...c })) })),
      relations: primary.relations.map((r) => ({
        sourceTable: r.sourceTable,
        targetTable: r.targetTable,
        foreignKeyColumn: r.foreignKeyColumn,
      })),
      appImports: collectClientImports(repoPath, fileAnalyses),
    };
  } catch (error) {
    log.warn(`journey mapping: database detection failed, no seed grounding (${errorText(error)})`);
    return null;
  }
}

/** How many import lines the draft prompt is shown — enough to establish the
 *  repo's own idiom, never a dump of every call site. */
const MAX_CLIENT_IMPORTS = 8;

/** The app's OWN import lines for its database client, reconstructed from the
 *  analyzer's parsed import statements (path-tagged, so the draft can follow the
 *  file that already does it). */
function collectClientImports(repoPath: string, fileAnalyses: readonly FileAnalysis[]): string[] {
  const lines: string[] = [];
  for (const analysis of fileAnalyses) {
    for (const imp of analysis.imports) {
      const known =
        DATABASE_IMPORT_MAP[imp.source] ??
        DATABASE_IMPORT_MAP[imp.source.toLowerCase()] ??
        DATABASE_IMPORT_MAP[imp.source.split('/')[0]!.toLowerCase()];
      if (!known) continue;
      const names = imp.specifiers.map((sp) => (sp.alias ? `${sp.name} as ${sp.alias}` : sp.name)).join(', ');
      const rel = path.relative(repoPath, analysis.filePath) || analysis.filePath;
      lines.push(`${rel}: import ${names ? `{ ${names} } from ` : ''}'${imp.source}'`);
      if (lines.length >= MAX_CLIENT_IMPORTS) return lines;
    }
  }
  return lines;
}

/**
 * The OpenAPI operations of the corpus-kept docs — the api surface's declared
 * half. The corpus is the doc source the spec side indexes from (the OpenAPI
 * double-agent rule: an operation is a section AND a journey entry); a repo with
 * no corpus yet maps its api journeys from route registrations alone.
 */
function readOpenApiOperations(repoPath: string): ApiSpecOperation[] {
  const operations: ApiSpecOperation[] = [];
  for (const ref of corpusKeptDocs(repoPath)) {
    try {
      const abs = path.resolve(repoPath, ref);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
      const content = fs.readFileSync(abs, 'utf-8');
      if (!isOpenApiDoc(abs, content)) continue;
      for (const section of deriveOpenApiSections(content, nodeRefContext(repoPath, abs))) {
        operations.push({
          method: section.method,
          routePath: section.routePath,
          ...(section.operationId ? { operationId: section.operationId } : {}),
        });
      }
    } catch {
      // One unreadable doc never costs the api catalog its other operations.
    }
  }
  return operations;
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
