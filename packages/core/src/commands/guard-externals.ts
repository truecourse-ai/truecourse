/**
 * EXTERNAL API ACCOUNTS — the read/write surface every UI drives (item 62).
 *
 * The engine half lives in `@truecourse/guard-runner`
 * (`externals.ts`: the recipe declaration ∪ the gitignored local overlay →
 * provided / incomplete / unprovided). THIS module is the adapter the dashboard
 * page and the interactive CLI both call:
 *
 *   {@link readGuardExternalsView}  — the joined view: what the analyzer DETECTED
 *      (`guard/result.json`'s `externalServices`), what the recipe DECLARES, how
 *      each one resolves on this machine (with per-requirement reasons), and how
 *      many flows the last generate left blocked on each service.
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
  loadExternalsLocal,
  mergeExternals,
  resolveExternal,
  recipePath,
  externalsLocalPath,
  readGuardResult,
  ExternalsError,
  type ExternalRequirement,
  type ExternalState,
  type ExternalsLocalFile,
  type RecipeApiExternal,
} from '@truecourse/guard-runner';
import {
  parseBlockedOnCapabilities,
  type BaseUrlEnv,
  type GuardExternalSetupIndex,
  type DetectedExternalService,
  type ExternalServiceCategory,
  type ExternalServiceSource,
} from '@truecourse/shared';
import { atomicWriteText } from '../lib/atomic-write.js';

// ---------------------------------------------------------------------------
// The read view.
// ---------------------------------------------------------------------------

/** One service as every UI shows it: detection ∪ declaration ∪ resolution. */
export interface GuardExternalServiceView {
  /** Canonical service name — the recipe key and the detector's identity. */
  service: string;
  /** Whether the last `guard generate` DETECTED this service in the working tree. */
  detected: boolean;
  /** Whether `recipe.json` declares it under `api.externals`. */
  declared: boolean;
  /** Undeclared services are always `unprovided` — they configure nothing. */
  state: ExternalState;
  /** The detector's category, when it was detected (`payment`, `ai`, …). */
  category?: ExternalServiceCategory;
  /** How detection identified it: an SDK import, or a plain HTTP call (item 63). */
  detectedVia?: ExternalServiceSource;
  /** The env var the app reads the base URL from — declared, else detected. */
  baseUrlEnv: string | null;
  /** Where `baseUrlEnv` came from: the recipe's declaration or the detector's guess. */
  baseUrlEnvSource: 'recipe' | 'detected' | null;
  /**
   * EVERY base-URL override variable detection saw for this service, best-confidence
   * first — a repo can reach one vendor through several hosts, each with its own
   * variable (item 63). `baseUrlEnv` is only the first of these, so a form that
   * offers just that one silently drops the rest. Empty when nothing was detected.
   */
  baseUrlEnvs: BaseUrlEnv[];
  /** The provided origin (recipe or overlay); null when none is configured. */
  baseUrl: string | null;
  /**
   * EXTRA base-URL variables this service is declared with (item 64), env var →
   * origin, overlay applied. The primary (`baseUrlEnv` → `baseUrl`) is not repeated
   * here. A form edits these as URL rows, never as secret-shaped env rows: the
   * runner proxies an origin and forwards a key, and only the declaration can say
   * which a variable is. Empty for an undeclared service.
   */
  endpoints: Record<string, string>;
  mode?: 'sandbox' | 'real';
  description?: string;
  /** Per-requirement resolution + reasons; empty for an undeclared service. */
  requirements: ExternalRequirement[];
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
  /** True when the recipe exists, parses, and carries an `api` block (writes need one). */
  hasApiBlock: boolean;
  /**
   * True when a `guard generate` report exists — i.e. detection has run. False
   * means "no detection yet", NOT "no third parties": the view then shows only the
   * declared services, and a UI should say so rather than claim the repo has none.
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
  const base = {
    recipePath: recipeFile,
    localPath: localFile,
    unknownLocalServices: [] as string[],
  };

  const report = readGuardResult(repoRoot);
  const detected = report?.externalServices ?? [];
  const blockedFlows = tallyBlockedFlows(report);

  const recipe = readRecipeForView(recipeFile);
  if ('reason' in recipe) {
    return {
      ...base,
      recipeValid: false,
      invalidReason: recipe.reason,
      hasApiBlock: false,
      detectionAvailable: report !== null,
      services: detectedOnlyViews(detected, blockedFlows, new Set()),
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
      requirements: resolved.requirements,
      blockedFlows: blockedFlows.get(m.service) ?? 0,
      evidence: hit?.evidence.map((e) => ({ ...e })) ?? [],
      undeclaredLocalEnv: m.undeclaredLocalEnv,
    };
  });
  const declaredNames = new Set(services.map((s) => s.service));

  return {
    ...base,
    recipeValid: recipe.recipe !== null,
    invalidReason: overlayReason,
    hasApiBlock: recipe.recipe?.api !== undefined,
    detectionAvailable: report !== null,
    services: [...services, ...detectedOnlyViews(detected, blockedFlows, declaredNames)],
    unknownLocalServices: Object.keys(local)
      .filter((name) => !declaredNames.has(name))
      .sort(),
  };
}

// ---------------------------------------------------------------------------
// The needs-setup derivation (item 65) — the read-model join every surface uses.
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

/** {@link externalSetupIndex} straight off the working tree. */
export function readGuardExternalSetupIndex(repoRoot: string): GuardExternalSetupIndex {
  return externalSetupIndex(readGuardExternalsView(repoRoot));
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
   * EXTRA base-URL variables of this service (item 64): env var → origin, or `null`
   * to drop one. Always committed to `recipe.json` — an origin is not a secret, and
   * the declaration is what tells the runner to PROXY that variable rather than
   * forward it as an opaque value. Variables not named here keep what they had.
   */
  endpoints?: Record<string, string | null>;
  mode?: 'sandbox' | 'real';
  description?: string;
  /** Env vars the app needs for this service; a `null` entry drops one. */
  env?: Record<string, GuardExternalEnvPatch>;
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
      'No .truecourse/scenarios/recipe.json — run `truecourse guard recipe --init` before declaring external services.',
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
    throw new GuardExternalsWriteError(
      'recipe.json has no `api` block — external services configure the api driver, so the recipe needs one first.',
    );
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

  writeIfChanged(recipeFile, serializeLike(rawRecipe, doc));
  writeLocalIfChanged(externalsLocalPath(repoRoot), local);
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

  // Extra base-URL variables (item 64). Like `env`, a variable the caller does not
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
  };
  return { declaration, secrets: Object.keys(secrets).length > 0 ? secrets : null };
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
