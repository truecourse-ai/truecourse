/**
 * Interface mapping — the free, deterministic half of guard: analyze the working
 * tree, derive the interface catalog from it, and snapshot the result to
 * `.truecourse/guard/interfaces.json`. No LLM, no analyze store, no prior
 * `truecourse analyze` run: the analyzer is invoked directly on the tree.
 *
 * Degradation is defined, never inherited. A mapper or analyzer failure yields an
 * EMPTY catalog for that surface (whose flows then settle as honest `no-interface`
 * gaps) and never fails the caller — the spec half of the pipeline has to keep
 * working on a repo the mapper chokes on. That includes C# without the Roslyn
 * host: interface mapping is tree-sitter-only, so analyze's hard-fail policy does
 * not extend here.
 *
 * The snapshot is HALF the catalog, and this half is the only one that is
 * derived. `cli` and `api` are read off the tree whole — their places AND their
 * interactions. The `web` surface is derived by HALVES: its PLACES are read off
 * the routing tree (`deriveWebPlacesFromTree`), its TASKS are not derived at all.
 * A web task is an ordered navigate/activate sequence with a start and an end
 * state — intent, which no tree states — so it stays hand-authored, lives in the
 * committed `guard/interfaces.authored.json`, is never written here, and is
 * merged over this file by every reader (`readMergedInterfaceCatalog`). The one
 * place that rule is enforced rather than assumed is
 * {@link assertDerivedSnapshot}, which stops the mapping dead rather than
 * overwrite authoring that landed in the derived file by mistake.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  analyzeFile,
  collectDatastoreUrls,
  collectOutboundRequests,
  databaseFromManifest,
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
  guardAuthoredInterfacesPath,
  guardInterfacesPath,
  loadRecipe,
  nodeRefContext,
  recipeControlledEnvVars,
  recipePath,
  resolveEntry,
} from '@truecourse/guard-runner';
import {
  collectApiRequestContracts,
  createSandboxProbeExec,
  deriveApiInterfacesFromTree,
  deriveCliInterfaces,
  deriveWebPlacesFromTree,
  formApiResources,
  formCliResources,
  formWebResources,
  type ApiSpecOperation,
  type CliProbeExec,
  type MapperDiagnostic,
  type WebPlace,
} from '@truecourse/interface-mapper';
import { deriveOpenApiSections, isOpenApiDoc } from '@truecourse/shared/openapi';
import type { SeedDraftDatabase } from '@truecourse/guard-generator';
import type {
  ApiRequestContract,
  DatastoreUrlRef,
  DetectedExternalService,
  OutboundRequest,
  FileAnalysis,
  Interface,
  InterfaceCatalogSource,
  InterfaceResource,
  InterfacesFile,
} from '@truecourse/shared';
import { log } from '../lib/logger.js';

export interface MapInterfacesOptions {
  /** Map these analyses instead of re-analyzing the tree (callers that already have them). */
  fileAnalyses?: FileAnalysis[];
  /**
   * Probe executor for the cli fallback. Defaults to a sandboxed subprocess run
   * against the recipe entry; pass `null` to map from the tree only (no spawning).
   */
  probeExec?: CliProbeExec | null;
}

export interface MapInterfacesResult {
  /** The catalog as written to disk. */
  catalog: InterfacesFile;
  /** Per interface TYPE → `sha256:…` over that type's sorted interface fingerprints. */
  fingerprints: Record<string, string>;
  /** Absolute path of the snapshot that was written. */
  snapshotPath: string;
  /**
   * The third parties the analyzed tree imports, read off the SAME
   * `FileAnalysis[]` the interfaces were derived from — a pure registry match, no
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
   * How the app CONSTRUCTS its outbound requests and which response fields it reads
   * back — the grounding a `setup.http` stub needs to be accepted by the
   * app it is stubbing for. Same pass, same non-snapshot rule.
   */
  outboundRequests: OutboundRequest[];
  /**
   * What each api handler reads off the request, off the same pass — the
   * per-operation grounding `guard generate`'s authoring prompts join against.
   * Rides the result rather than the snapshot, like every other field here.
   */
  requestContracts: ApiRequestContract[];
  /**
   * What the surface derivations disagreed about — today the cli union's
   * tree-vs-probe disputes (`deriveCliInterfaces`). Run reporting, exactly like
   * `externalServices`: NEVER part of the snapshot and never fingerprinted — a
   * diagnostic is a fact about this working tree at this moment, and the
   * catalog schema forbids storing doc-vs-code discrepancies in interface
   * data. The `guard-setup.reconcile-interfaces` session consumes these.
   */
  diagnostics: MapperDiagnostic[];
}

/**
 * Map the repo's surfaces to interfaces and write the snapshot. Returns the catalog
 * plus a per-type fingerprint — the value that tells a caller whether a surface
 * moved without diffing interface lists.
 */
export async function mapInterfaces(
  repoPath: string,
  opts: MapInterfacesOptions = {},
): Promise<MapInterfacesResult> {
  // Before a single file is read: refuse to stand on top of a catalog a human
  // wrote. Checked first so the refusal costs nothing and touches nothing.
  assertDerivedSnapshot(repoPath);
  const interfaces = await deriveInterfaces(repoPath, opts);
  const placed = placeInterfaces(interfaces.interfaces, programName(repoPath), interfaces.webPlaces);

  const catalog: InterfacesFile = {
    version: 2,
    generatedAt: new Date().toISOString(),
    recipeFingerprint: readRecipeFingerprint(repoPath),
    interfaces: placed.interfaces,
    ...(Object.keys(placed.resources).length > 0 ? { resources: placed.resources } : {}),
    source: interfaces.source,
  };

  const snapshotPath = guardInterfacesPath(repoPath);
  atomicWriteJson(snapshotPath, catalog);

  return {
    catalog,
    fingerprints: interfaceTypeFingerprints(catalog.interfaces),
    snapshotPath,
    externalServices: interfaces.externalServices,
    database: interfaces.database,
    datastoreUrls: interfaces.datastoreUrls,
    outboundRequests: interfaces.outboundRequests,
    requestContracts: interfaces.requestContracts,
    diagnostics: interfaces.diagnostics,
  };
}

/**
 * The surfaces whose INTERFACES a derivation produces. Any other type in the
 * snapshot's interface list was typed by a human.
 *
 * The web surface is deliberately NOT in this set although the mapper now
 * derives web RESOURCES (the places, `formWebResources`). The two halves of a
 * surface are not equally replaceable: a place is read off the routing tree and
 * costs one command to re-derive, while a TASK — the ordered navigate/activate
 * sequence with its start and end states — encodes intent no tree states, and is
 * exactly the work the refusal below exists to protect. Widening the set to
 * `web` because half of that surface became derivable would retire the guard for
 * the half that still cannot be. It narrows when web tasks derive, not before.
 */
const DERIVED_INTERFACE_SURFACES = new Set(['cli', 'api']);

/**
 * REFUSE TO OVERWRITE HAND-AUTHORED WORK. The mapper derives the `cli` and `api`
 * interfaces and nothing else, so a snapshot carrying any other surface's
 * interfaces — or the pre-SOM v1 shape — is somebody's authoring, and rewriting
 * it destroys hours no derivation can reproduce. It has already happened: a
 * 618KB curated catalog, gone in one command, with the run afterwards perfectly
 * green.
 *
 * It throws rather than warning, and that is the point. Warning and proceeding
 * means the rest of the pipeline runs without that surface and settles its flows
 * as honest-looking `no-interface` gaps — the silent degradation this whole file
 * split exists to remove. A copy is written first, so the loud path still loses
 * nothing, and the error says exactly which two steps put the work back.
 */
function assertDerivedSnapshot(repoPath: string): void {
  const file = guardInterfacesPath(repoPath);
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    // Absent, or bytes no reader could take for a catalog: the mapping owns the file.
    return;
  }
  const evidence = handAuthoredEvidence(raw);
  if (!evidence) return;

  const backup = path.join(
    path.dirname(file),
    `interfaces.legacy-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
  );
  fs.copyFileSync(file, backup);
  const rel = (p: string) => path.relative(repoPath, p).split(path.sep).join('/');
  throw new Error(
    `${rel(file)} was written by hand, not derived: ${evidence}. Mapping would overwrite it, ` +
      `and nothing can re-derive it — the mapper reads cli and api off the tree and no other surface. ` +
      `A copy of what was found is at ${rel(backup)}. Migrate it with scripts/migrate-interfaces-v2.mts, ` +
      `save the result as ${rel(guardAuthoredInterfacesPath(repoPath))} (committed — every mapping merges ` +
      `it over the derived catalog instead of replacing it), then re-run the map.`,
  );
}

/** What makes a snapshot recognizably somebody's authoring, in one clause — or
 *  `null` for a file the mapper could have written itself. */
function handAuthoredEvidence(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const file = raw as { version?: unknown; interfaces?: unknown };
  if (file.version !== 2) {
    return `it is a version ${String(file.version)} catalog, and no derivation has written that shape since the SOM restructure`;
  }
  if (!Array.isArray(file.interfaces)) return null;
  const authored = new Set<string>();
  for (const entry of file.interfaces) {
    const type = (entry as { type?: unknown } | null)?.type;
    if (typeof type === 'string' && !DERIVED_INTERFACE_SURFACES.has(type)) authored.add(type);
  }
  if (authored.size === 0) return null;
  const surfaces = [...authored].sort();
  return `it carries ${surfaces.map((s) => `\`${s}\``).join(' and ')} interfaces, ${
    surfaces.length === 1 ? 'a surface' : 'surfaces'
  } no derivation produces`;
}

/**
 * THE PLACES, and each interface's owner — the SOM envelope
 * formed over the interfaces the surface derivations just produced. Pure and
 * deterministic; the formation rules themselves live in the mapper
 * (`formCliResources` / `formApiResources`) so the reference-catalog migration
 * uses the identical ones.
 *
 * Degrades like every other derivation here: a formation that throws costs the
 * catalog its registry and its `resource` refs, never the catalog. An interface
 * the formation could not place keeps none — omitted, never guessed.
 */
function placeInterfaces(
  interfaces: readonly Interface[],
  programName: string | undefined,
  webPlaces: readonly WebPlace[],
): { interfaces: Interface[]; resources: Record<string, InterfaceResource[]> } {
  try {
    const cli = formCliResources(interfaces, { ...(programName ? { programName } : {}) });
    const api = formApiResources(interfaces);
    // The web registry is places WITHOUT interfaces — the one surface where the
    // places exist first (see `formWebResources`), so it contributes no owners.
    const web = formWebResources(webPlaces);
    const owners = new Map([...cli.owners, ...api.owners]);
    return {
      interfaces: interfaces.map((iface) => {
        const owner = owners.get(iface.id);
        return owner ? { ...iface, resource: owner } : iface;
      }),
      resources: {
        ...(cli.resources.length > 0 ? { cli: cli.resources } : {}),
        ...(api.resources.length > 0 ? { api: api.resources } : {}),
        ...(web.resources.length > 0 ? { web: web.resources } : {}),
      },
    };
  } catch (error) {
    log.warn(`interface mapping: resource formation failed, the catalog names no places (${errorText(error)})`);
    return { interfaces: [...interfaces], resources: {} };
  }
}

/**
 * `sha256:…` per interface type over that type's interface fingerprints, sorted so the
 * value depends on the SET of surfaces, not on the order they were derived in.
 */
export function interfaceTypeFingerprints(interfaces: readonly Interface[]): Record<string, string> {
  const byType = new Map<string, string[]>();
  for (const iface of interfaces) {
    const list = byType.get(iface.type) ?? [];
    list.push(iface.fingerprint);
    byType.set(iface.type, list);
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
  interfaces: Interface[];
  /**
   * The web surface's PLACES — the only half of it a derivation produces. Kept
   * apart from `interfaces` because that is what they are: a screen exists
   * whether or not a task visits it, and web tasks are not derived at all.
   */
  webPlaces: WebPlace[];
  source: Record<string, InterfaceCatalogSource>;
  externalServices: DetectedExternalService[];
  database: SeedDraftDatabase | null;
  datastoreUrls: DatastoreUrlRef[];
  outboundRequests: OutboundRequest[];
  requestContracts: ApiRequestContract[];
  /** Tree-vs-probe disputes off the cli union — run reporting, never snapshotted. */
  diagnostics: MapperDiagnostic[];
}

async function deriveInterfaces(
  repoPath: string,
  opts: MapInterfacesOptions,
): Promise<DerivedCatalog> {
  let fileAnalyses: readonly FileAnalysis[];
  try {
    fileAnalyses = opts.fileAnalyses ?? (await analyzeWorkingTree(repoPath));
  } catch (error) {
    log.warn(`interface mapping: analysis failed, catalog is empty (${errorText(error)})`);
    return {
      interfaces: [],
      webPlaces: [],
      source: {},
      externalServices: [],
      database: null,
      datastoreUrls: [],
      outboundRequests: [],
      requestContracts: [],
      diagnostics: [],
    };
  }

  // Per-surface degradation: one surface's derivation failing empties THAT
  // catalog only — its flows settle as honest `no-interface` gaps while the other
  // surfaces keep grounding.
  const interfaces: Interface[] = [];
  const webPlaces: WebPlace[] = [];
  const source: Record<string, InterfaceCatalogSource> = {};
  const diagnostics: MapperDiagnostic[] = [];

  try {
    const cli = await deriveCliInterfaces({
      fileAnalyses,
      ...(cliProbeOptions(repoPath, opts) ?? {}),
    });
    interfaces.push(...cli.interfaces);
    source.cli = cli.source;
    diagnostics.push(...cli.diagnostics);
  } catch (error) {
    log.warn(`interface mapping: cli derivation failed, cli catalog is empty (${errorText(error)})`);
  }

  // The two authoring-grounding products, derived before the api catalog is
  // assembled: the request contract is no longer a product BESIDE the catalog,
  // it is the api contract's `request` region, so it has to exist
  // by the time the api interfaces are built.
  const requestContracts = safely('request contracts', () => collectApiRequestContracts(fileAnalyses));

  try {
    const api = deriveApiInterfacesFromTree(fileAnalyses, readOpenApiOperations(repoPath));
    interfaces.push(...withApiContracts(api, requestContracts));
    source.api = 'tree';
  } catch (error) {
    log.warn(`interface mapping: api derivation failed, api catalog is empty (${errorText(error)})`);
  }

  // The web surface, structural half: the PLACES the routing tree declares. It
  // derives no interfaces — a web task is intent, not structure — so a repo with
  // screens and no tasks is the normal state of this surface, not a failure.
  // `source.web` means what it means everywhere else: which ladder read the area.
  try {
    const appRoot = servedWebAppRoot(repoPath);
    webPlaces.push(...deriveWebPlacesFromTree(fileAnalyses, appRoot ? { appRoot } : {}));
    source.web = 'tree';
  } catch (error) {
    log.warn(`interface mapping: web derivation failed, web catalog is empty (${errorText(error)})`);
  }

  return {
    interfaces,
    webPlaces,
    source,
    externalServices: detectExternalServices(fileAnalyses, {
      ownHosts: repoOwnHosts(repoPath, fileAnalyses),
    }),
    database: detectDatabaseContext(repoPath, fileAnalyses),
    datastoreUrls: collectDatastoreUrls(fileAnalyses),
    // Degrades like every other derivation here: a collector that throws costs
    // authoring its grounding, never the run.
    outboundRequests: safely('outbound requests', () => collectOutboundRequests(fileAnalyses)),
    requestContracts,
    diagnostics,
  };
}

/**
 * THE ONE HOME for the api contract: what each handler reads off
 * the request — and, since the 2f extension, what it statically PRODUCES back —
 * written ONTO the operation it belongs to instead of travelling beside the
 * catalog as a second product joined at prompt time.
 *
 * Only what the derivation established goes in. `params` are not written: the
 * path template already names them on the entry, and nothing in the extraction
 * says more about them than the path does — omitted is the honest answer, and
 * inventing them here would be the derivation claiming a fact it never made.
 * An operation whose handler reads nothing statically visible gets no contract
 * at all, for the same reason — and a contract writes only the REGIONS it
 * established (a produces-only contract carries no empty `request`).
 *
 * The response side maps onto the catalog's own fact kinds: each status becomes
 * an {@link InterfaceApiStatusFact} (stringified, no invented `when`), and each
 * top-level body key becomes an {@link InterfaceApiBodyFact} whose marker is the
 * key AS THE SERIALIZED RESPONSE CARRIES IT — `"key"`, quotes included, because
 * the marker contract is "a stable substring of what the operation writes back".
 *
 * None of this moves an interface: `contract` sits outside
 * {@link interfaceFingerprint} (type + entry + steps only), so gaining or
 * growing a contract re-authors nothing.
 */
function withApiContracts(
  interfaces: readonly Interface[],
  contracts: readonly ApiRequestContract[],
): Interface[] {
  if (contracts.length === 0) return [...interfaces];
  const byOperation = new Map(contracts.map((c) => [`${c.method.toUpperCase()} ${c.path}`, c]));
  return interfaces.map((iface) => {
    const entry = iface.entry as { method?: string; path?: string };
    if (iface.type !== 'api' || !entry.method || !entry.path) return iface;
    const contract = byOperation.get(`${entry.method.toUpperCase()} ${entry.path}`);
    if (!contract) return iface;
    const request = {
      ...(contract.queryFields ? { query: contract.queryFields.map((f) => ({ ...f })) } : {}),
      ...(contract.bodyFields ? { body: contract.bodyFields.map((f) => ({ ...f })) } : {}),
    };
    const produces = {
      ...(contract.produces?.statuses?.length
        ? { statuses: contract.produces.statuses.map((status) => ({ status: String(status) })) }
        : {}),
      ...(contract.produces?.bodyKeys?.length
        ? { body: contract.produces.bodyKeys.map((key) => ({ marker: `"${key}"` })) }
        : {}),
    };
    const operation = {
      ...(Object.keys(request).length > 0 ? { request } : {}),
      ...(Object.keys(produces).length > 0 ? { produces } : {}),
    };
    if (Object.keys(operation).length === 0) return iface;
    return {
      ...iface,
      contract: { surface: 'api' as const, operation },
    };
  });
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

/**
 * The absolute directory of the app the recipe's web surface serves, or
 * `undefined` when the recipe declares none (`recipe.web.app`). A monorepo holds
 * several routable apps and only one is driven; without the declaration every
 * app's addresses are places, which is how cal.com's bundled platform demo put
 * seven screens the product never serves into the catalog. An unreadable recipe
 * is the runner's error to report, not the mapper's — it claims nothing here.
 */
function servedWebAppRoot(repoPath: string): string | undefined {
  let recipe;
  try {
    recipe = loadRecipe(repoPath, recipePath(repoPath))?.recipe;
  } catch {
    return undefined;
  }
  const app = recipe?.web?.app;
  return app ? path.resolve(repoPath, app) : undefined;
}

/** Run a pure derivation, degrading to an empty list with a logged reason. */
function safely<T>(what: string, derive: () => T[]): T[] {
  try {
    return derive();
  } catch (error) {
    log.warn(`interface mapping: ${what} failed, authoring loses that grounding (${errorText(error)})`);
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
    if (!primary) {
      // The recipe-app fallback: when no detected service surfaced a driver, the
      // dirs the recipe itself declares as the app under test get a manifest
      // scan. strapi's `examples/getstarted` declares `better-sqlite3` while its
      // code only names the driver in a knex config string — invisible to both
      // the import scan and the service manifest scan (`examples/` is not a
      // service dir). Type and driver only; there is no schema to parse.
      const fromRecipe = recipeAppDatabase(repoPath);
      if (!fromRecipe) return null;
      return { ...fromRecipe, tables: [], relations: [], appImports: [] };
    }
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
    log.warn(`interface mapping: database detection failed, no seed grounding (${errorText(error)})`);
    return null;
  }
}

/** The database the recipe's own app dirs declare in their manifests — the
 *  fallback grounding when nothing else detected one. An unreadable recipe
 *  claims nothing, exactly like `repoOwnHosts`. */
function recipeAppDatabase(repoPath: string): { type: string; driver: string } | null {
  let recipe;
  try {
    recipe = loadRecipe(repoPath, recipePath(repoPath))?.recipe;
  } catch {
    return null;
  }
  if (!recipe) return null;
  const dirs = [
    recipe.api?.app,
    ...Object.values(recipe.api?.servers ?? {}).map((s) => s.app),
    recipe.web?.app,
  ].filter((d): d is string => typeof d === 'string' && d.length > 0);
  for (const dir of [...new Set(dirs)]) {
    const found = databaseFromManifest(path.resolve(repoPath, dir));
    if (found) return found;
  }
  return null;
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
 * double-agent rule: an operation is a section AND an interface entry); a repo with
 * no corpus yet maps its api interfaces from route registrations alone.
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
  opts: MapInterfacesOptions,
): { probe: Parameters<typeof deriveCliInterfaces>[0]['probe'] } | null {
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
 * without its scope. Only used to root the probe fallback's root interface.
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
export async function analyzeWorkingTree(repoPath: string): Promise<FileAnalysis[]> {
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
