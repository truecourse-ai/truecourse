/**
 * EXTERNAL API ACCOUNTS — the read/write surface every UI drives.
 *
 * The engine half lives in `@truecourse/guard-runner`
 * (`externals.ts`: the recipe declaration ∪ the gitignored local overlay →
 * provided / incomplete / unprovided). THIS module is the adapter the dashboard
 * page and the interactive CLI both call:
 *
 *   {@link readGuardExternalsView}  — the joined view: what the analyzer DETECTED
 *      (`guard/setup.json`'s detection snapshot — setup runs BEFORE the
 *      first generate, so this page works from the start; `guard/result.json` is
 *      generate's own artifact and is only the fallback for a repo that generated
 *      before setup existed), what the recipe DECLARES, how each one resolves on this
 *      machine (with per-requirement reasons), and how many flows the last generate
 *      left blocked on each service.
 *   {@link writeGuardExternals}     — the declaration write, split across the two
 *      files by SECRECY: declarations to the committed `recipe.json`, values to
 *      the gitignored `externals.local.json`. Both writes are atomic and
 *      byte-stable — the recipe is parsed, patched, and re-serialized in its own
 *      2-space format, and a write that changes nothing touches no file.
 *
 * Working-tree only, by design: it writes files inside the repo. A hosted store
 * has no working tree, so the routes gate on `guardsMaterializeInPlace()`.
 */

import fs from 'node:fs';
import {
  RecipeSchema,
  ExternalsLocalFileSchema,
  loadExternalsLocal,
  mergeExternals,
  resolveExternal,
  recipePath,
  externalsLocalPath,
  computeRecipeFingerprint,
  readGuardResult,
  readGuardSetup,
  readGuardDecisions,
  resolveDependencies,
  loadDependencyCatalog,
  loadDependenciesLocal,
  dependenciesPath,
  dependenciesLocalPath,
  ExternalsError,
  type ExternalRequirement,
  type ExternalState,
  type ExternalsLocalFile,
  type RecipeApiExternal,
  type ResolvedDependency,
} from '@truecourse/guard-runner';
import {
  parseBlockedOnCapabilities,
  isSecretHeaderName,
  MISSING_DATA_NOUN,
  GuardDependenciesFileSchema,
  GuardDependenciesLocalSchema,
  type BaseUrlEnv,
  type GuardDependenciesFile,
  type GuardDependenciesLocal,
  type GuardDependencyEntry,
  type GuardDependencyEnvVar,
  type GuardExternalSetupState,
  type GuardExternalSetupIndex,
  type DetectedExternalService,
  type ExternalServiceCategory,
  type ExternalServiceSource,
} from '@truecourse/shared';
import { atomicWriteText } from '../lib/atomic-write.js';

// ---------------------------------------------------------------------------
// The read view.
// ---------------------------------------------------------------------------

/**
 * One registered request header, as every surface shows it. A header whose NAME
 * reads as a credential ({@link isSecretHeaderName}) travels without its value —
 * the same rule the env half follows, so no surface can echo a stored secret back
 * even by accident.
 */
export interface GuardExternalHeaderView {
  name: string
  /** The stored value; absent when the name reads as a secret. */
  value?: string
  secret: boolean
}

/** The registered headers as view rows: name-sorted, secret values withheld. */
function headerViews(headers: Record<string, string> | undefined): GuardExternalHeaderView[] {
  return Object.entries(headers ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => {
      const secret = isSecretHeaderName(name);
      return { name, secret, ...(secret ? {} : { value }) };
    });
}

/** One service as every UI shows it: detection ∪ declaration ∪ resolution. */
export interface GuardExternalServiceView {
  /** Canonical service name — the recipe key and the detector's identity. */
  service: string;
  /** Whether the last detection pass (`guard setup`) saw this service in the tree. */
  detected: boolean;
  /** Whether `recipe.json` declares it under `api.externals`. */
  declared: boolean;
  /** Undeclared services are always `unprovided` — they configure nothing. */
  state: ExternalState;
  /** The detector's category, when it was detected (`payment`, `ai`, …). */
  category?: ExternalServiceCategory;
  /** How detection identified it: an SDK import, or a plain HTTP call. */
  detectedVia?: ExternalServiceSource;
  /** The env var the app reads the base URL from — declared, else detected. */
  baseUrlEnv: string | null;
  /** Where `baseUrlEnv` came from: the recipe's declaration or the detector's guess. */
  baseUrlEnvSource: 'recipe' | 'detected' | null;
  /**
   * EVERY base-URL override variable detection saw for this service, best-confidence
   * first — a repo can reach one vendor through several hosts, each with its own
   * variable. `baseUrlEnv` is only the first of these, so a form that
   * offers just that one silently drops the rest. Empty when nothing was detected.
   */
  baseUrlEnvs: BaseUrlEnv[];
  /** The provided origin (recipe or overlay); null when none is configured. */
  baseUrl: string | null;
  /**
   * EXTRA base-URL variables this service is declared with, env var →
   * origin, overlay applied. The primary (`baseUrlEnv` → `baseUrl`) is not repeated
   * here. A form edits these as URL rows, never as secret-shaped env rows: the
   * runner proxies an origin and forwards a key, and only the declaration can say
   * which a variable is. Empty for an undeclared service.
   */
  endpoints: Record<string, string>;
  mode?: 'sandbox' | 'real';
  description?: string;
  /**
   * True when an authorization token is registered for this service on this
   * machine. The token itself never travels — this is the whole of what a surface
   * may know about it.
   */
  tokenSet: boolean;
  /** The extra request headers registered locally; a secret-named one has no value. */
  headers: GuardExternalHeaderView[];
  /** Per-requirement resolution + reasons; empty for an undeclared service. */
  requirements: ExternalRequirement[];
  /**
   * Present when this service is a SUPPLIED entry of the dependency catalog — the
   * umbrella every class of user-registered dependency now lives under. It carries
   * what the catalog knows and the recipe cannot: the rolled-up requirement an
   * instance must satisfy, and which flow contributed each part of it, so a reader
   * sees why every expectation exists (and a dismissed flow's expectation is gone).
   */
  catalog?: {
    /** The catalog entry name (usually the service name). */
    dependency: string;
    /** The rolled-up requirement, one line. */
    requirement: string;
    /** The surviving per-flow needs behind that line. */
    needs: { flowId: string; need: string }[];
    /** The human sentence saying when this dependency applies; absent ⇒ always. */
    when?: string;
  };
  /** Flows the last generate settled `blocked-on` naming THIS service (0 if none). */
  blockedFlows: number;
  /**
   * First few files that name it (detection evidence), capped by the detector:
   * the import specifier for an SDK hit, the URL literal for an HTTP one.
   */
  evidence: { filePath: string; importSource?: string; url?: string }[];
  /** Overlay env keys under this service the recipe never declared — ignored, surfaced. */
  undeclaredLocalEnv: string[];
}

/** The whole externals page in one read. */
export interface GuardExternalsView {
  /** Absolute path to `recipe.json` — shown whether or not it exists. */
  recipePath: string;
  /** Absolute path to the gitignored overlay — shown whether or not it exists. */
  localPath: string;
  /** False when `recipe.json` is absent or does not parse (see `invalidReason`). */
  recipeValid: boolean;
  /** Why the recipe (or the overlay) could not be read; null when both are fine. */
  invalidReason: string | null;
  /** Absolute path of the committed dependency catalog — shown whether or not it exists. */
  catalogPath: string;
  /** Absolute path of the gitignored instance overlay. */
  catalogLocalPath: string;
  /**
   * True when detection has run — `guard setup` recorded a snapshot, or (for a repo
   * that predates setup) a `guard generate` report exists. False means "no detection
   * yet", NOT "no third parties": the view then shows only the declared services, and
   * a UI should say so rather than claim the repo has none.
   */
  detectionAvailable: boolean;
  /** Declared services first (declaration order), then detected-only ones. */
  services: GuardExternalServiceView[];
  /** Overlay entries naming a service the recipe never declares — ignored, surfaced. */
  unknownLocalServices: string[];
}

/**
 * The joined externals view for `repoRoot`. Every input is optional: no recipe, no
 * generate report, and no overlay all read as "nothing configured yet" rather than
 * an error — this is the page a user opens BEFORE any of them exist. Only a file
 * that exists and is broken produces an `invalidReason`.
 */
export function readGuardExternalsView(repoRoot: string): GuardExternalsView {
  const recipeFile = recipePath(repoRoot);
  const localFile = externalsLocalPath(repoRoot);
  // The dependency catalog is the UMBRELLA over user-registered dependencies, and
  // external services are one class of them. It is read FIRST and unconditionally,
  // because a catalog-declared service needs no `api` block to exist — which is the
  // whole point of decoupling external services from the api driver.
  const catalog = readCatalogServices(repoRoot);
  const base = {
    recipePath: recipeFile,
    localPath: localFile,
    catalogPath: catalog.catalogPath,
    catalogLocalPath: catalog.localPath,
    unknownLocalServices: [] as string[],
  };

  // DETECTION comes from `guard setup`: it is a deterministic
  // `mapInterfaces` pass setup pays for before the first generate, so the page is
  // populated from the start. A repo whose last setup predates this file — or that
  // only ever ran a generate — falls back to the generate report's own list, which
  // is where detection used to live. BLOCKED FLOWS stay generate's: only authoring
  // knows what it could not write.
  const report = readGuardResult(repoRoot);
  const setup = readGuardSetup(repoRoot);
  const detected = setup?.detection?.externalServices ?? report?.externalServices ?? [];
  const detectionAvailable = setup?.detection !== undefined || report !== null;
  const blockedFlows = tallyBlockedFlows(report);

  const recipe = readRecipeForView(recipeFile);
  if ('reason' in recipe) {
    // A broken recipe blanks the RECIPE half only: catalog-declared services stand
    // on their own file and stay readable, which is what makes them independent.
    const catalogNames = new Set(catalog.services.map((s) => s.service));
    return {
      ...base,
      recipeValid: false,
      invalidReason: recipe.reason,
      detectionAvailable,
      services: [
        ...catalog.services.map((s) => withDetection(s, detected, blockedFlows)),
        ...detectedOnlyViews(detected, blockedFlows, catalogNames),
      ],
    };
  }

  let local: ExternalsLocalFile = {};
  let overlayReason: string | null = null;
  try {
    local = loadExternalsLocal(repoRoot);
  } catch (e) {
    // A broken overlay must not blank the page — the declarations are still true,
    // they just resolve against nothing until the file is fixed.
    overlayReason = e instanceof ExternalsError ? e.message : String(e);
  }

  const declared = recipe.recipe?.api?.externals;
  const merged = mergeExternals(declared, local);
  const detectedByName = new Map(detected.map((d) => [d.service, d]));
  const services: GuardExternalServiceView[] = merged.map((m) => {
    const resolved = resolveExternal(m, process.env);
    const hit = detectedByName.get(m.service);
    return {
      service: m.service,
      detected: hit !== undefined,
      declared: true,
      state: resolved.state,
      ...(hit?.category ? { category: hit.category } : {}),
      ...(hit ? { detectedVia: hit.source ?? 'sdk' } : {}),
      baseUrlEnv: m.baseUrlEnv,
      baseUrlEnvSource: 'recipe',
      // The DECLARATION wins for what the runner injects; detection's list stays
      // visible so an edit form can still offer the variables it did not declare.
      baseUrlEnvs: hit?.baseUrlEnvs?.map((e) => ({ ...e })) ?? [],
      baseUrl: resolved.baseUrl ?? null,
      endpoints: Object.fromEntries(m.endpoints.map((e) => [e.envVar, e.url])),
      ...(resolved.mode ? { mode: resolved.mode } : {}),
      ...(resolved.description ? { description: resolved.description } : {}),
      tokenSet: m.token !== undefined && m.token !== '',
      headers: headerViews(m.headers),
      requirements: resolved.requirements,
      blockedFlows: blockedFlows.get(m.service) ?? 0,
      evidence: hit?.evidence.map((e) => ({ ...e })) ?? [],
      undeclaredLocalEnv: m.undeclaredLocalEnv,
    };
  });
  const declaredNames = new Set(services.map((s) => s.service));
  // A service the recipe declares wins over its catalog twin: the recipe carries the
  // proxy-shaping detail (endpoints, mode) the catalog has no field for. The catalog
  // rows the recipe does NOT declare are the ones the api-block decoupling exists
  // for, and they list exactly like a declared one.
  const catalogOnly = catalog.services.filter((s) => !declaredNames.has(s.service));
  const known = new Set([...declaredNames, ...catalogOnly.map((s) => s.service)]);

  return {
    ...base,
    recipeValid: recipe.recipe !== null,
    invalidReason: overlayReason,
    detectionAvailable,
    services: [
      ...services,
      ...catalogOnly.map((s) => withDetection(s, detected, blockedFlows)),
      ...detectedOnlyViews(detected, blockedFlows, known),
    ],
    unknownLocalServices: Object.keys(local)
      .filter((name) => !known.has(name))
      .sort(),
  };
}

/**
 * The catalog's SUPPLIED entries that name an external service, as view rows — ONE
 * per named service, since an entry may stand for several (a provider-API credential
 * entry stands for every provider it can reach the model through) and this surface
 * is keyed by service identity.
 *
 * They need no `api` block and no recipe at all: the catalog declares WHAT the
 * program depends on and the gitignored overlay holds the instance, which is the
 * same committed/local split `api.externals` uses one class narrower. A broken
 * catalog file degrades to no rows rather than blanking the page — the recipe half
 * is still true.
 */
function readCatalogServices(repoRoot: string): {
  services: GuardExternalServiceView[];
  catalogPath: string;
  localPath: string;
} {
  let resolved;
  // The instance overlay, read for the TRANSPORT half a resolution has no field
  // for: the token and the extra headers this machine reaches the service with.
  let local: GuardDependenciesLocal = {};
  try {
    resolved = resolveDependencies(repoRoot, {
      dismissedFlows: new Set(readGuardDecisions(repoRoot).dismissedFlows.map((f) => f.flowId)),
    });
    local = loadDependenciesLocal(repoRoot);
  } catch {
    return {
      services: [],
      catalogPath: dependenciesPath(repoRoot),
      localPath: dependenciesLocalPath(repoRoot),
    };
  }
  // One view per service identity: the first entry claiming a name owns it, so a
  // catalog that names the same service twice cannot list it twice either.
  const claimed = new Set<string>();
  const named: { dependency: ResolvedDependency; service: string }[] = [];
  for (const dependency of resolved.dependencies) {
    if (dependency.state === null) continue;
    for (const service of dependency.entry.services ?? []) {
      if (claimed.has(service)) continue;
      claimed.add(service);
      named.push({ dependency, service });
    }
  }
  const services = named.map(({ dependency: d, service }) => ({
    service,
    detected: false,
    declared: true,
    state: d.state as ExternalState,
    baseUrlEnv: null,
    baseUrlEnvSource: null,
    baseUrlEnvs: [],
    baseUrl: null,
    endpoints: {},
    tokenSet: (local[d.name]?.token ?? '') !== '',
    headers: headerViews(local[d.name]?.headers),
    ...(d.entry.summary ? { description: d.entry.summary } : {}),
    // The catalog's requirements ARE the env vars the registration declares, so
    // they render in the same rows a recipe-declared service's do.
    requirements: d.requirements.map((r) => ({
      kind: 'env' as const,
      envVar: r.field,
      resolved: r.resolved,
      ...(r.reason ? { reason: r.reason } : {}),
      secret: r.secret,
    })),
    blockedFlows: 0,
    evidence: [],
    undeclaredLocalEnv: [],
    catalog: {
      dependency: d.name,
      requirement: d.requirement,
      needs: d.needs.map((n) => ({ ...n })),
      ...(d.entry.condition ? { when: d.entry.condition.sentence } : {}),
    },
  }));
  return { services, catalogPath: resolved.catalogPath, localPath: resolved.localPath };
}

/** Fold detection's category/evidence onto a catalog row that names the same service. */
function withDetection(
  row: GuardExternalServiceView,
  detected: readonly DetectedExternalService[],
  blockedFlows: ReadonlyMap<string, number>,
): GuardExternalServiceView {
  const hit = detected.find((d) => d.service === row.service);
  return {
    ...row,
    detected: hit !== undefined,
    ...(hit?.category ? { category: hit.category } : {}),
    ...(hit ? { detectedVia: hit.source ?? 'sdk' } : {}),
    ...(hit ? { evidence: hit.evidence.map((e) => ({ ...e })) } : {}),
    blockedFlows: blockedFlows.get(row.service) ?? 0,
  };
}

// ---------------------------------------------------------------------------
// The needs-setup derivation — the read-model join every surface uses.
// ---------------------------------------------------------------------------

/**
 * Service → provisioning state for every external this repo KNOWS about, the
 * index `deriveNeedsSetup` joins `blocked-on` gaps against. Detected-but-undeclared
 * services are in it (they read `unprovided`) — those are precisely the ones an
 * "provide it" CTA is for.
 *
 * Working-tree only: it reads `recipe.json`, the gitignored overlay, and the host
 * env. A hosted store has no working tree, so callers pass `null` there and every
 * `blocked-on` gap stays plain blocked — the honest degradation, since a hosted
 * view could not offer the form that clears it either.
 */
export function externalSetupIndex(view: GuardExternalsView): GuardExternalSetupIndex {
  return Object.fromEntries(view.services.map((s) => [s.service, s.state]))
}

/**
 * {@link externalSetupIndex} straight off the working tree, plus the ONE synthetic
 * seed-data key added when the recipe declares an `api.seed` — and its state depends
 * on whether the LAST GENERATE already saw this seed:
 *
 *   seed the last generate never saw (edited since, or no generate recorded)
 *     ⇒ `provided` — the gap is that generate's stale answer, and "re-run guard
 *       generate" genuinely converts the flow (the fingerprint moved, so the flow
 *       re-authors);
 *   seed the last generate DID see (recipe fingerprint unchanged since)
 *     ⇒ `incomplete` — a missing-data gap that survived that generate is the
 *       generator's verdict ON THIS SEED: it does not create the rows the flow
 *       needs, and a re-run would only re-derive the same gap from cache. The gap
 *       renders as a to-do ("extend the seed script"), never as "already set up".
 *
 * It is never carried as `unprovided`. That state's CTA is a link to the External
 * APIs page, and there is no row there for a seed — a repo with no seed keeps its
 * plain `blocked-on` gap and is pointed at `truecourse guard setup` instead.
 */
export function readGuardExternalSetupIndex(repoRoot: string): GuardExternalSetupIndex {
  const index: Record<string, GuardExternalSetupState> = {
    ...externalSetupIndex(readGuardExternalsView(repoRoot)),
  };
  if (seedDeclared(repoRoot)) {
    index[MISSING_DATA_NOUN] = seedFedLastGenerate(repoRoot) ? 'incomplete' : 'provided';
  }
  return index;
}

/**
 * Did the CURRENT recipe + seed already feed the last generate? True only when a
 * generate report exists, recorded its fingerprint, and it matches the working
 * tree's. An older report without the field reads `false` — the pre-fix "setup
 * done" reading, never a fabricated "your seed is insufficient".
 */
function seedFedLastGenerate(repoRoot: string): boolean {
  const recorded = readGuardResult(repoRoot)?.recipeFingerprint;
  return recorded !== undefined && recorded === computeRecipeFingerprint(repoRoot);
}

/** Does the recipe declare an `api.seed`? A broken recipe declares nothing. */
function seedDeclared(repoRoot: string): boolean {
  const recipe = readRecipeForView(recipePath(repoRoot));
  return 'recipe' in recipe && recipe.recipe?.api?.seed !== undefined;
}

/** One "needs setup" row: the service, its state, and the flows waiting on it. */
export interface GuardNeedsSetupService {
  service: string;
  /** `unprovided` / `incomplete` = still to do; `provided` = re-generate to convert. */
  state: ExternalState;
  /** Flows the last generate left blocked on it (the externals view's own tally). */
  blockedFlows: number;
}

/**
 * The services with flows waiting on them, worst-first: the ones still to provide
 * (most blocked flows first), then the ones already provided whose flows the next
 * `guard generate` will author. The CLI's status line and the dashboard's CTA rows
 * are the same list — one derivation, two renderers.
 */
export function guardNeedsSetupServices(view: GuardExternalsView): GuardNeedsSetupService[] {
  return view.services
    .filter((s) => s.blockedFlows > 0)
    .map((s) => ({ service: s.service, state: s.state, blockedFlows: s.blockedFlows }))
    .sort(
      (a, b) =>
        Number(a.state === 'provided') - Number(b.state === 'provided') ||
        b.blockedFlows - a.blockedFlows ||
        a.service.localeCompare(b.service),
    );
}

/** The detected-but-undeclared services, in detection order — pure "you could provide these". */
function detectedOnlyViews(
  detected: readonly DetectedExternalService[],
  blockedFlows: ReadonlyMap<string, number>,
  declaredNames: ReadonlySet<string>,
): GuardExternalServiceView[] {
  return detected
    .filter((d) => !declaredNames.has(d.service))
    .map((d) => ({
      service: d.service,
      detected: true,
      declared: false,
      state: 'unprovided' as const,
      ...(d.category ? { category: d.category } : {}),
      detectedVia: d.source ?? 'sdk',
      // The detector's base-URL env is a SUGGESTION for the declaration form — it
      // is "seen in the source", never a promise that the app honors it.
      baseUrlEnv: d.baseUrlEnv ?? null,
      baseUrlEnvSource: d.baseUrlEnv ? ('detected' as const) : null,
      baseUrlEnvs: d.baseUrlEnvs?.map((e) => ({ ...e })) ?? [],
      baseUrl: null,
      endpoints: {},
      // An undeclared service configures nothing, so there is nothing registered
      // against it either — the form is how that changes.
      tokenSet: false,
      headers: [],
      requirements: [],
      blockedFlows: blockedFlows.get(d.service) ?? 0,
      evidence: d.evidence.map((e) => ({ ...e })),
      undeclaredLocalEnv: [],
    }));
}

/**
 * Flows the last generate left blocked on each named service. A `blocked-on` gap
 * is per (flow, surface) and Phase 3 stamps the SERVICE name into its capability
 * segment, so the tally is over `parseBlockedOnCapabilities` — deduped by flow, so
 * a flow blocked on one service across two surfaces counts once.
 */
function tallyBlockedFlows(
  report: ReturnType<typeof readGuardResult>,
): Map<string, number> {
  const seen = new Map<string, Set<string>>();
  for (const gap of report?.coverageGaps ?? []) {
    if (gap.kind !== 'blocked-on') continue;
    // A claim-level gap carries no flowId — key on the section it pivots on so
    // each distinct blocked unit still counts exactly once.
    const unit = gap.flowId ?? `${gap.doc}\0${gap.anchor}`;
    for (const capability of parseBlockedOnCapabilities(gap.reason)) {
      let flows = seen.get(capability);
      if (!flows) seen.set(capability, (flows = new Set()));
      flows.add(unit);
    }
  }
  return new Map([...seen].map(([capability, flows]) => [capability, flows.size]));
}

/** Read + parse recipe.json for the view: the recipe, `null` when absent, or a reason. */
function readRecipeForView(
  recipeFile: string,
): { recipe: import('@truecourse/guard-runner').Recipe | null } | { reason: string } {
  if (!fs.existsSync(recipeFile)) return { recipe: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(recipeFile, 'utf-8'));
  } catch (e) {
    return { reason: `recipe.json is not valid JSON: ${e instanceof Error ? e.message : e}` };
  }
  const result = RecipeSchema.safeParse(parsed);
  if (!result.success) {
    return {
      reason: `recipe.json is invalid: ${result.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
    };
  }
  return { recipe: result.data };
}

// ---------------------------------------------------------------------------
// The write.
// ---------------------------------------------------------------------------

/** A rejected write — the message is safe to show a user verbatim (never a secret). */
export class GuardExternalsWriteError extends Error {}

/** One env var of an external, as a caller asks for it to be stored. */
export type GuardExternalEnvPatch =
  /** A SECRET value. Lands in the gitignored overlay; the recipe only declares the name. */
  | { value: string }
  /** A host env-var name. Lands in the committed recipe — it names a variable, not a secret. */
  | { valueFromEnv: string }
  /** An explicit INLINE recipe value. Only for a non-secret; it is committed as written. */
  | { value: string; inline: true }
  /** Drop this variable from the declaration (and its overlay value). */
  | null;

/** One service's desired declaration; `null` removes the service entirely. */
export interface GuardExternalPatch {
  /** The env var the APP reads this service's base URL from. Required. */
  baseUrlEnv: string;
  /** The provided origin. Omit to leave it unset (the service stays unprovided). */
  baseUrl?: string;
  /** Where the base URL is stored — the committed recipe (default) or the overlay. */
  baseUrlTarget?: 'recipe' | 'local';
  /**
   * EXTRA base-URL variables of this service: env var → origin, or `null`
   * to drop one. Always committed to `recipe.json` — an origin is not a secret, and
   * the declaration is what tells the runner to PROXY that variable rather than
   * forward it as an opaque value. Variables not named here keep what they had.
   */
  endpoints?: Record<string, string | null>;
  mode?: 'sandbox' | 'real';
  description?: string;
  /** Env vars the app needs for this service; a `null` entry drops one. */
  env?: Record<string, GuardExternalEnvPatch>;
  /**
   * The authorization token this machine reaches the service with; `null` (or
   * blank) clears it. Always stored in the gitignored overlay — a token is a
   * secret, and the caller does not get to choose otherwise.
   */
  token?: string | null;
  /**
   * Extra request headers this machine reaches the service with; a `null` entry
   * drops one, and a header the caller does not name keeps what it had. Stored in
   * the overlay beside the token: a tenant id or a second key is one developer's
   * account detail, not a declaration teammates inherit.
   */
  headers?: Record<string, string | null>;
}

/**
 * The write's input: service → its declaration, or `null` to remove it. Only the
 * named services are touched — every other external, and every other key in
 * recipe.json, is preserved byte-for-byte.
 */
export interface GuardExternalsWrite {
  externals: Record<string, GuardExternalPatch | null>;
}

/**
 * Apply `patch` to `api.externals` and answer with the fresh view.
 *
 * The SPLIT is the point: a declaration (service, `baseUrlEnv`, which variables it
 * needs, `mode`, `description`) is committed so the team shares it — and so the
 * recipe fingerprint re-authors the sections the service used to block. A VALUE is
 * a secret unless the caller says otherwise, so it goes to the gitignored overlay;
 * `valueFromEnv` is the exception (a variable NAME is not a secret) and `inline`
 * is the deliberate escape hatch for a value that genuinely is not one.
 *
 * Both files are written atomically and only when their bytes actually change.
 */
export function writeGuardExternals(
  repoRoot: string,
  patch: GuardExternalsWrite,
): GuardExternalsView {
  const recipeFile = recipePath(repoRoot);
  if (!fs.existsSync(recipeFile)) {
    throw new GuardExternalsWriteError(
      'No .truecourse/scenarios/recipe.json — run `truecourse guard setup` before declaring external services.',
    );
  }
  const rawRecipe = fs.readFileSync(recipeFile, 'utf-8');
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(rawRecipe) as Record<string, unknown>;
  } catch (e) {
    throw new GuardExternalsWriteError(
      `recipe.json is not valid JSON: ${e instanceof Error ? e.message : e}`,
    );
  }
  const api = doc.api as Record<string, unknown> | undefined;
  if (!api || typeof api !== 'object') {
    // No `api` block, and that is FINE: an external service is a dependency of the
    // program under test, not a feature of the api driver, so it is declared in the
    // dependency catalog and configured from the gitignored instance overlay. The
    // recipe is not touched at all on this path — a cli-only repo has no api block
    // to grow one, and requiring it was the coupling that made external services
    // unconfigurable for every repo without an HTTP server.
    return writeCatalogExternals(repoRoot, patch);
  }

  const externals = { ...((api.externals as Record<string, RecipeApiExternal>) ?? {}) };
  const local: ExternalsLocalFile = readLocalForWrite(repoRoot);

  for (const [service, entry] of Object.entries(patch.externals)) {
    if (entry === null) {
      delete externals[service];
      delete local[service];
      continue;
    }
    const { declaration, secrets } = splitPatch(service, entry, externals[service], local[service]);
    externals[service] = declaration;
    if (secrets === null) delete local[service];
    else local[service] = secrets;
  }

  if (Object.keys(externals).length > 0) api.externals = sortedByKey(externals);
  else delete api.externals;

  // Validate the WHOLE recipe, not just the patch: an externals edit that would
  // make the recipe unloadable (a duplicated env var across two services) must be
  // refused here, never discovered by the next run.
  const validated = RecipeSchema.safeParse(doc);
  if (!validated.success) {
    throw new GuardExternalsWriteError(
      `the resulting recipe.json would be invalid: ${validated.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
    );
  }

  // The overlay is validated for the same reason the recipe is: a write that would
  // make a file unloadable (a header name that is not an HTTP token) must be
  // refused HERE, never discovered by the next read as a broken-file banner.
  assertValidOverlay(ExternalsLocalFileSchema.safeParse(local), 'externals.local.json');

  writeIfChanged(recipeFile, serializeLike(rawRecipe, doc));
  writeLocalIfChanged(externalsLocalPath(repoRoot), local);
  return readGuardExternalsView(repoRoot);
}

/**
 * The api-block-free write: an external service becomes a SUPPLIED entry of the
 * dependency catalog, and its values go to the catalog's gitignored instance
 * overlay. Same split, same reasons — the declaration is committed so the team
 * shares it and it enters the recipe fingerprint; the base URL and the keys never
 * reach git.
 *
 * The registration is `env`-shaped because that is what an external account IS on
 * this path: the variables the program reads the origin and the credentials from.
 * The base-URL variable is declared non-secret (an origin is not a secret and every
 * surface shows it); every other variable is a secret by default, exactly as the
 * recipe path treats them.
 */
function writeCatalogExternals(
  repoRoot: string,
  patch: GuardExternalsWrite,
): GuardExternalsView {
  const catalogFile = dependenciesPath(repoRoot);
  let catalog: GuardDependenciesFile;
  let local: GuardDependenciesLocal;
  try {
    catalog = { dependencies: [...loadDependencyCatalog(repoRoot).dependencies] };
    local = { ...loadDependenciesLocal(repoRoot) };
  } catch (e) {
    throw new GuardExternalsWriteError(
      `${e instanceof Error ? e.message : String(e)} — fix or delete the file before saving.`,
    );
  }

  for (const [service, entry] of Object.entries(patch.externals)) {
    const index = catalog.dependencies.findIndex((d) => d.services?.includes(service));
    // An UMBRELLA entry — one class of starting state standing for several services —
    // is not a declaration this writer owns: rewriting it into a single-service
    // external would rename the entry and throw away the registration every other
    // service it covers is registered through. It is edited where it lives.
    const prior = index === -1 ? undefined : catalog.dependencies[index];
    if (prior && (prior.services?.length ?? 0) > 1) {
      throw new GuardExternalsWriteError(
        `"${service}" is one of the services the "${prior.name}" dependency stands for — register it there, not as an external of its own.`,
      );
    }
    // A MATCHED entry keeps its identity: its name (which scenarios' `needs` and the
    // overlay's row key both reference) and every var it already declares. The patch
    // only ever layers over it — replacing the entry wholesale would rename it,
    // orphan its registered secrets, and drop declared vars the patch never named.
    const entryName = prior?.name ?? service;
    if (entry === null) {
      if (index !== -1) catalog.dependencies.splice(index, 1);
      delete local[entryName];
      continue;
    }
    const priorVars: GuardDependencyEnvVar[] =
      prior?.registration?.kind === 'env' ? prior.registration.vars : [];
    const removed = new Set(
      Object.entries(entry.env ?? {})
        .filter(([, source]) => source === null)
        .map(([name]) => name),
    );
    const vars: GuardDependencyEnvVar[] = priorVars.filter((v) => !removed.has(v.name));
    if (!vars.some((v) => v.name === entry.baseUrlEnv)) {
      vars.unshift({
        name: entry.baseUrlEnv,
        description: `the base URL the program reads ${service} from`,
        secret: false,
      });
    }
    const values: Record<string, string> = { ...(local[entryName]?.env ?? {}) };
    if (entry.baseUrl !== undefined) values[entry.baseUrlEnv] = entry.baseUrl;
    for (const [name, source] of Object.entries(entry.env ?? {})) {
      if (source === null) {
        delete values[name];
        continue;
      }
      if (!vars.some((v) => v.name === name)) {
        vars.push({ name, description: `the ${service} credential the program reads`, secret: true });
      }
      // `valueFromEnv` has no catalog analogue on purpose: the overlay IS the value
      // store (it is gitignored), so a value is stored, not pointed at.
      values[name] = 'value' in source ? source.value : (process.env[source.valueFromEnv] ?? '');
    }
    const declaration: GuardDependencyEntry = {
      name: entryName,
      class: 'supplied',
      services: prior?.services ?? [service],
      summary: entry.description ?? prior?.summary ?? `an account for the ${service} API this repo calls`,
      // A path/config-dir registration stays what it is — the overlay row carries
      // the transport values either way, and rewriting the shape would orphan the
      // registered instance.
      registration:
        prior?.registration && prior.registration.kind !== 'env'
          ? prior.registration
          : { kind: 'env', vars },
      needs: prior?.needs ?? [],
      ...(prior?.condition ? { condition: prior.condition } : {}),
    };
    if (index === -1) catalog.dependencies.push(declaration);
    else catalog.dependencies[index] = declaration;

    // The transport half rides in the same overlay row, merged per field — the
    // recipe path's rule, one file over.
    const headers: Record<string, string> = { ...(local[entryName]?.headers ?? {}) };
    for (const [name, value] of Object.entries(entry.headers ?? {})) {
      if (value === null || value.trim() === '') delete headers[name];
      else headers[name] = value;
    }
    const token =
      entry.token === undefined
        ? local[entryName]?.token
        : entry.token === null || entry.token.trim() === ''
          ? undefined
          : entry.token;

    const row = {
      ...(Object.keys(values).length > 0 ? { env: values } : {}),
      ...(token !== undefined ? { token } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
    };
    if (Object.keys(row).length > 0) local[entryName] = row;
    else delete local[entryName];
  }

  catalog.dependencies.sort((a, b) => a.name.localeCompare(b.name));
  const validated = GuardDependenciesFileSchema.safeParse(catalog);
  if (!validated.success) {
    throw new GuardExternalsWriteError(
      `the resulting dependencies.json would be invalid: ${validated.error.issues
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
    );
  }
  assertValidOverlay(GuardDependenciesLocalSchema.safeParse(local), 'dependencies.local.json');
  if (catalog.dependencies.length > 0) {
    writeIfChanged(catalogFile, JSON.stringify(catalog, null, 2) + '\n');
  } else if (fs.existsSync(catalogFile)) {
    fs.rmSync(catalogFile);
  }
  const localFile = dependenciesLocalPath(repoRoot);
  if (Object.keys(local).length > 0) {
    writeIfChanged(localFile, JSON.stringify(sortedByKey(local), null, 2) + '\n');
  } else if (fs.existsSync(localFile)) {
    fs.rmSync(localFile);
  }
  return readGuardExternalsView(repoRoot);
}

/** Split one patch entry into its committed declaration and its overlay values. */
function splitPatch(
  service: string,
  entry: GuardExternalPatch,
  priorDeclaration: RecipeApiExternal | undefined,
  priorLocal: ExternalsLocalFile[string] | undefined,
): { declaration: RecipeApiExternal; secrets: ExternalsLocalFile[string] | null } {
  const localEnv: Record<string, string> = { ...(priorLocal?.env ?? {}) };
  const declaredEnv: Record<string, { value?: string; valueFromEnv?: string }> = {};

  // Env vars the caller did not mention keep whatever they had — a patch that only
  // sets a base URL must never silently drop the keys already declared.
  const untouched = Object.entries(priorDeclaration?.env ?? {}).filter(
    ([name]) => !(entry.env && name in entry.env),
  );
  for (const [name, source] of untouched) declaredEnv[name] = source;

  for (const [name, source] of Object.entries(entry.env ?? {})) {
    if (source === null) {
      delete localEnv[name];
      continue;
    }
    if ('valueFromEnv' in source) {
      declaredEnv[name] = { valueFromEnv: source.valueFromEnv };
      delete localEnv[name];
      continue;
    }
    if ('inline' in source && source.inline) {
      declaredEnv[name] = { value: source.value };
      delete localEnv[name];
      continue;
    }
    if (source.value.trim() === '') {
      throw new GuardExternalsWriteError(
        `external "${service}": env var ${name} was given an empty value — omit it, or pass null to remove it.`,
      );
    }
    // The default: DECLARE the variable in the recipe, store the secret locally.
    declaredEnv[name] = {};
    localEnv[name] = source.value;
  }

  // Extra base-URL variables. Like `env`, a variable the caller does not
  // mention keeps what it had; unlike `env`, the VALUE is always committed — it is an
  // origin, and the declaration is what makes the runner proxy it.
  const declaredEndpoints: Record<string, string> = { ...(priorDeclaration?.endpoints ?? {}) };
  const localEndpoints: Record<string, string> = { ...(priorLocal?.endpoints ?? {}) };
  for (const [name, url] of Object.entries(entry.endpoints ?? {})) {
    if (url === null) {
      delete declaredEndpoints[name];
      // A dropped variable's per-developer override goes with it — leaving it behind
      // would surface forever as an "undeclared overlay key".
      delete localEndpoints[name];
      continue;
    }
    if (url.trim() === '') {
      throw new GuardExternalsWriteError(
        `external "${service}": endpoint ${name} was given an empty URL — omit it, or pass null to remove it.`,
      );
    }
    declaredEndpoints[name] = url.trim();
  }

  // The transport half: overlay-only, and merged per FIELD like everything else
  // here — a patch that says nothing about a header leaves it exactly as it was.
  const localHeaders: Record<string, string> = { ...(priorLocal?.headers ?? {}) };
  for (const [name, value] of Object.entries(entry.headers ?? {})) {
    if (value === null || value.trim() === '') delete localHeaders[name];
    else localHeaders[name] = value;
  }
  const token =
    entry.token === undefined
      ? priorLocal?.token
      : entry.token === null || entry.token.trim() === ''
        ? undefined
        : entry.token;

  const toLocalBaseUrl = entry.baseUrl !== undefined && entry.baseUrlTarget === 'local';
  const declaration: RecipeApiExternal = {
    baseUrlEnv: entry.baseUrlEnv,
    ...(entry.baseUrl !== undefined && !toLocalBaseUrl ? { baseUrl: entry.baseUrl } : {}),
    ...(Object.keys(declaredEndpoints).length > 0
      ? { endpoints: sortedByKey(declaredEndpoints) }
      : {}),
    ...(entry.mode ? { mode: entry.mode } : {}),
    ...(Object.keys(declaredEnv).length > 0 ? { env: sortedByKey(declaredEnv) } : {}),
    ...(entry.description ? { description: entry.description } : {}),
  };

  const secrets: ExternalsLocalFile[string] = {
    ...(toLocalBaseUrl ? { baseUrl: entry.baseUrl } : priorLocal?.baseUrl !== undefined && entry.baseUrl === undefined ? { baseUrl: priorLocal.baseUrl } : {}),
    // Per-developer endpoint overrides are the user's, not the patch's — a write that
    // says nothing about them must leave them exactly as they were.
    ...(Object.keys(localEndpoints).length > 0 ? { endpoints: sortedByKey(localEndpoints) } : {}),
    ...(Object.keys(localEnv).length > 0 ? { env: sortedByKey(localEnv) } : {}),
    ...(token !== undefined ? { token } : {}),
    ...(Object.keys(localHeaders).length > 0 ? { headers: sortedByKey(localHeaders) } : {}),
  };
  return { declaration, secrets: Object.keys(secrets).length > 0 ? secrets : null };
}

/** Refuse a write whose result would not load back. `label` names the file. */
function assertValidOverlay(
  result: { success: true } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } },
  label: string,
): void {
  if (result.success) return;
  throw new GuardExternalsWriteError(
    `the resulting ${label} would be invalid: ${result.error.issues
      .map((i) => `${i.path.join('.')} ${i.message}`.trim())
      .join('; ')}`,
  );
}

/** Read the overlay for a write; a broken overlay is refused, never overwritten. */
function readLocalForWrite(repoRoot: string): ExternalsLocalFile {
  try {
    return { ...loadExternalsLocal(repoRoot) };
  } catch (e) {
    throw new GuardExternalsWriteError(
      `${e instanceof Error ? e.message : String(e)} — fix or delete the file before saving.`,
    );
  }
}

/** Object with keys sorted, so a rewritten map has a stable, reviewable order. */
function sortedByKey<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(record).sort()) out[key] = record[key];
  return out;
}

/**
 * Re-serialize `doc` the way `original` was written: 2-space indentation (the
 * format every writer of this file uses) and the original's trailing-newline
 * presence, so the diff of an externals edit is the externals edit.
 */
function serializeLike(original: string, doc: unknown): string {
  return JSON.stringify(doc, null, 2) + (original.endsWith('\n') ? '\n' : '');
}

/** Write only when the bytes differ — a no-op patch must not touch the file's mtime. */
function writeIfChanged(file: string, text: string): void {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf-8') === text) return;
  atomicWriteText(file, text);
}

/** The overlay write: 2-space + newline, deleted entirely when nothing is left. */
function writeLocalIfChanged(file: string, local: ExternalsLocalFile): void {
  if (Object.keys(local).length === 0) {
    if (fs.existsSync(file)) fs.rmSync(file);
    return;
  }
  writeIfChanged(file, JSON.stringify(sortedByKey(local), null, 2) + '\n');
}
