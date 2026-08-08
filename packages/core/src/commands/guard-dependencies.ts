/**
 * THE DEPENDENCIES surface — every class of starting state the program under test
 * needs, joined with what THIS machine provides for it.
 *
 * One catalog, one list. `scenarios/dependencies.json` declares WHAT is needed
 * (the entry, its class, when it applies, the shape an instance is registered in,
 * and the requirement contributed flow by flow); `scenarios/dependencies.local.json`
 * holds the INSTANCES (a path, a config dir, an API key) and never reaches git.
 * External services are one class of dependency, not a surface of their own, so a
 * service the recipe declares lists here beside a supplied project or an
 * authenticated config dir — {@link readGuardExternalsView} supplies that half
 * rather than a second reader deriving it again.
 *
 * A DETECTED service is not a row by itself. It folds into the catalog entry that
 * names it (an entry may name several — one provider-API credential entry stands for
 * every provider the program can reach the model through) and contributes its
 * evidence there. A detection no entry names, that nothing declares and that holds
 * nothing back, is machine data with no question for a reader: it stays in
 * `guard/setup.json` and lists nowhere.
 *
 * What every row answers, in the order a reader asks it:
 *   - the ROLLED-UP REQUIREMENT and the flow that contributed each part of it, so
 *     an expectation is never anonymous (and a dismissed flow's is gone);
 *   - WHEN the dependency applies — the condition sentence, absent ⇒ always;
 *   - which flows it BLOCKS right now: the committed tests that bind it and cannot
 *     run, plus the flows the last generate could not even author for want of it;
 *   - what registering an instance must supply, per field, with the reason each
 *     unresolved one is unresolved.
 *
 * A registered VALUE never comes back out: the view carries `resolved` and
 * `secret` per field and a host path (which is not a secret), never a stored key.
 *
 * Working-tree only, by design: it reads and writes files inside the repo, so the
 * routes gate on `guardsMaterializeInPlace()` exactly as the externals ones do.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  dependenciesLocalPath,
  dependenciesPath,
  loadDependenciesLocal,
  loadScenarios,
  readGuardDecisions,
  readGuardFlowsCorpus,
  readGuardResult,
  recipePath,
  resolveDependencies,
  scenarioDependencyNames,
  type DependencyState,
  type ResolvedDependency,
} from '@truecourse/guard-runner';
import {
  parseBlockedOnCapabilities,
  type GuardDependenciesLocal,
  type GuardDependencyClass,
  type GuardDependencyNeed,
  type GuardDependencyRegistration,
} from '@truecourse/shared';
import { atomicWriteText } from '../lib/atomic-write.js';
import {
  readGuardExternalsView,
  writeGuardExternals,
  GuardExternalsWriteError,
  type GuardExternalHeaderView,
  type GuardExternalServiceView,
} from './guard-externals.js';

// ---------------------------------------------------------------------------
// The read view.
// ---------------------------------------------------------------------------

/** One field an instance registration must supply, and whether it did. */
export interface GuardDependencyFieldView {
  /** `path` for the path / config-dir shapes; the env var name for the env shape. */
  field: string;
  resolved: boolean;
  /** Why it is unresolved — rendered verbatim, and never an instruction. */
  reason?: string;
  /** True when the value must never be echoed back. */
  secret: boolean;
  /** What this field must hold, in the declaration's own words. */
  description?: string;
}

/** One flow's contribution to the requirement, with the flow it belongs to. */
export interface GuardDependencyNeedView {
  flowId: string;
  /** The flow's title, when the corpus still names it. */
  title?: string;
  need: string;
}

/** One thing this dependency holds back — a flow, or the section a gap pivots on. */
export interface GuardDependencyBlockedFlow {
  /** Absent for a claim-level generate gap, which belongs to no flow. */
  flowId?: string;
  title: string;
  /** How it is held back: a committed test that cannot run, or a test never written. */
  kind: 'test-blocked' | 'not-authored';
}

/** The external-service half of a row — present only when the row IS one. */
export interface GuardDependencyServiceView {
  /** The row's PRIMARY service identity — the first one it covers. */
  service: string;
  /**
   * EVERY service identity this row covers, in the catalog's own order. One class of
   * starting state routinely absorbs several detected services (one provider-API
   * credential entry stands for every provider the program can reach the model
   * through); each of them folds in HERE rather than listing as a row of its own.
   */
  services: string[];
  /** The last detection pass saw at least one of them in the tree. */
  detected: boolean;
  /** `recipe.json` declares the primary one under `api.externals`. */
  declaredInRecipe: boolean;
  /** Absent when the covered services disagree — never a guess at the majority. */
  category?: string;
  /**
   * How detection identified it — an SDK import, a plain HTTP call, a binary. Absent
   * when the covered services were identified in different ways.
   */
  detectedVia?: string;
  baseUrlEnv: string | null;
  baseUrlEnvSource: 'recipe' | 'detected' | null;
  baseUrl: string | null;
  mode?: 'sandbox' | 'real';
  /** Extra base-URL variables the declaration carries: env var → origin. */
  endpoints: Record<string, string>;
  /** True when an authorization token is registered here. The value never travels. */
  tokenSet: boolean;
  /** Extra request headers registered here; a secret-named one carries no value. */
  headers: GuardExternalHeaderView[];
  /** Detection evidence for every covered service, each hit naming the one it is for. */
  evidence: { service: string; filePath: string; importSource?: string; url?: string }[];
  /** Overlay env keys the declaration never named — ignored, surfaced. */
  undeclaredLocalEnv: string[];
}

/** One dependency as every surface lists it. */
export interface GuardDependencyRowView {
  /** Row identity: the catalog entry's name, else the service's. */
  name: string;
  class: GuardDependencyClass;
  /** What this class of starting state IS, in one line. */
  summary: string;
  /** The human sentence saying WHEN it applies; absent ⇒ unconditional. */
  when?: string;
  /** The rolled-up requirement — always a sentence. */
  requirement: string;
  /** The per-flow needs behind that sentence, dismissed flows dropped. */
  needs: GuardDependencyNeedView[];
  /** How a `step-creatable` entry is created / a `seedable` one materialized. */
  obtain?: string;
  /** `null` for a class with nothing to register (the scenario or the runner gets it). */
  state: DependencyState | null;
  /** The shape an instance is registered in; absent ⇒ nothing to register here. */
  registration?: GuardDependencyRegistration;
  /** Per-field resolution. Never a value — a registered secret is never echoed. */
  fields: GuardDependencyFieldView[];
  /** The registered host path (path / config-dir shapes). Not a secret. */
  hostPath?: string;
  /**
   * The overlay already holds an instance, written in a shape this registration no
   * longer reads — so the row is unregistered and the value on disk is ignored. One
   * quiet sentence explaining that, absent when the shapes agree.
   */
  staleInstance?: string;
  /** What this dependency holds back right now. */
  blocks: GuardDependencyBlockedFlow[];
  /**
   * How many flows RELY on it: the ones that contributed a need, plus the ones whose
   * committed scenarios bind it. A fact about the dependency, not a state — it counts
   * the same whether or not an instance is registered, and a dismissed flow is gone
   * from it like it is gone from the requirement.
   */
  usedBy: number;
  service?: GuardDependencyServiceView;
  /** True when the committed catalog declares this row. */
  inCatalog: boolean;
}

/** The whole dependencies page in one read. */
export interface GuardDependenciesView {
  /** Absolute path of the committed catalog — shown whether or not it exists. */
  catalogPath: string;
  /** Absolute path of the gitignored instance overlay. */
  localPath: string;
  /** Absolute path of `recipe.json` — where a service's declaration lives. */
  recipePath: string;
  /** Why a file could not be read; null when every one of them is fine. */
  invalidReason: string | null;
  /**
   * True when detection has run. False means "nothing has looked yet", NOT "this
   * repo depends on no third party".
   */
  detectionAvailable: boolean;
  /** Catalog entries in catalog order, then the services no entry declares. */
  dependencies: GuardDependencyRowView[];
  /** Overlay keys naming nothing the catalog declares — ignored, surfaced. */
  unknownLocalNames: string[];
}

/** The joined dependencies view for `repoRoot`. Every input is optional. */
export function readGuardDependenciesView(repoRoot: string): GuardDependenciesView {
  const externals = readGuardExternalsView(repoRoot);
  const flowTitles = readFlowTitles(repoRoot);
  const blocked = blockedIndex(repoRoot, flowTitles);

  let resolved: ReturnType<typeof resolveDependencies> | null = null;
  let invalidReason: string | null = externals.invalidReason;
  try {
    resolved = resolveDependencies(repoRoot, {
      dismissedFlows: new Set(readGuardDecisions(repoRoot).dismissedFlows.map((f) => f.flowId)),
    });
  } catch (e) {
    // A catalog that exists but does not parse blanks the CATALOG half only: the
    // services are declared elsewhere and stay readable, exactly as a broken
    // recipe leaves the catalog rows standing.
    invalidReason = invalidReason ?? (e instanceof Error ? e.message : String(e));
  }

  const services = new Map(externals.services.map((s) => [s.service, s]));
  const rows: GuardDependencyRowView[] = [];
  const claimedServices = new Set<string>();

  for (const dependency of resolved?.dependencies ?? []) {
    // EVERY service the entry names folds into it — a credentials entry standing for
    // four providers absorbs all four, so their evidence reads under the one thing a
    // user actually registers instead of scattering across four look-alike rows.
    const covered = (dependency.entry.services ?? [])
      .map((name) => services.get(name))
      .filter((s): s is GuardExternalServiceView => s !== undefined);
    for (const service of covered) claimedServices.add(service.service);
    rows.push(catalogRow(dependency, covered, flowTitles, blocked));
  }

  for (const service of externals.services) {
    if (claimedServices.has(service.service)) continue;
    // A DETECTION no catalog entry folds, that nothing declares and that holds
    // nothing back, is machine data — not a row. It names a third party the tree
    // mentions and offers a reader neither something to register nor something to
    // clear; it stays in `guard/setup.json`, where detection put it.
    if (!service.declared && blocksFor([service.service], blocked).length === 0) continue;
    rows.push(serviceRow(service, blocked));
  }

  return {
    catalogPath: resolved?.catalogPath ?? dependenciesPath(repoRoot),
    localPath: resolved?.localPath ?? dependenciesLocalPath(repoRoot),
    recipePath: recipePath(repoRoot),
    invalidReason,
    detectionAvailable: externals.detectionAvailable,
    dependencies: rows,
    unknownLocalNames: [
      ...new Set([...(resolved?.unknownLocalNames ?? []), ...externals.unknownLocalServices]),
    ].sort(),
  };
}

/** A catalog entry, with the service half of every service it names folded in. */
function catalogRow(
  dependency: ResolvedDependency,
  covered: readonly GuardExternalServiceView[],
  flowTitles: ReadonlyMap<string, string>,
  blocked: ReadonlyMap<string, GuardDependencyBlockedFlow[]>,
): GuardDependencyRowView {
  const entry = dependency.entry;
  const descriptions = envDescriptions(entry.registration);
  const keys = [dependency.name, ...covered.map((s) => s.service)];
  return {
    name: dependency.name,
    class: entry.class,
    summary: entry.summary,
    ...(entry.condition ? { when: entry.condition.sentence } : {}),
    requirement: dependency.requirement,
    needs: dependency.needs.map((n) => ({
      flowId: n.flowId,
      need: n.need,
      ...(flowTitles.has(n.flowId) ? { title: flowTitles.get(n.flowId)! } : {}),
    })),
    ...(entry.obtain ? { obtain: entry.obtain } : {}),
    state: dependency.state,
    ...(entry.registration ? { registration: entry.registration } : {}),
    fields: dependency.requirements.map((r) => ({
      field: r.field,
      resolved: r.resolved,
      ...(r.reason ? { reason: r.reason } : {}),
      secret: r.secret,
      ...(descriptions.has(r.field) ? { description: descriptions.get(r.field)! } : {}),
    })),
    ...(dependency.hostPath ? { hostPath: dependency.hostPath } : {}),
    ...(dependency.staleInstance ? { staleInstance: dependency.staleInstance } : {}),
    blocks: dependency.state === 'provided' ? [] : blocksFor(keys, blocked),
    usedBy: usedByFlows(keys, dependency.needs, blocked),
    ...(covered.length > 0 ? { service: serviceHalf(covered) } : {}),
    inCatalog: true,
  };
}

/**
 * A service no catalog entry declares — the recipe's own, or one detection saw
 * and nobody has provided yet. It is `supplied` by construction: an account is a
 * real-world input the engine must never fabricate.
 */
function serviceRow(
  service: GuardExternalServiceView,
  blocked: ReadonlyMap<string, GuardDependencyBlockedFlow[]>,
): GuardDependencyRowView {
  return {
    name: service.service,
    class: 'supplied',
    summary: service.description ?? `an account for the ${service.service} API this repo calls`,
    ...(service.catalog?.when ? { when: service.catalog.when } : {}),
    requirement:
      service.catalog?.requirement ??
      `an account for ${service.service}, and the variables the program reads it through`,
    needs: (service.catalog?.needs ?? []).map((n) => ({ flowId: n.flowId, need: n.need })),
    state: service.state,
    fields: service.requirements.map((r) => ({
      field: r.envVar,
      resolved: r.resolved,
      ...(r.reason ? { reason: r.reason } : {}),
      secret: r.secret,
    })),
    blocks: service.state === 'provided' ? [] : blocksFor([service.service], blocked),
    usedBy: usedByFlows([service.service], service.catalog?.needs ?? [], blocked),
    service: serviceHalf([service]),
    inCatalog: false,
  };
}

/**
 * The service half of a row, merged across every service it covers.
 *
 * The TRANSPORT fields (the base URL, the account kind, the token, the headers) are
 * the primary service's: they are what a write to this row would target, and one row
 * registers one account. Everything DESCRIPTIVE merges — the evidence of all of them,
 * each hit naming the service it belongs to, so a merged row still says which third
 * party each file is about.
 */
function serviceHalf(covered: readonly GuardExternalServiceView[]): GuardDependencyServiceView {
  const primary = covered[0];
  const category = agreedOn(covered.map((s) => s.category));
  const detectedVia = agreedOn(covered.map((s) => s.detectedVia));
  return {
    service: primary.service,
    services: covered.map((s) => s.service),
    detected: covered.some((s) => s.detected),
    declaredInRecipe: primary.declared && primary.baseUrlEnvSource === 'recipe',
    ...(category ? { category } : {}),
    ...(detectedVia ? { detectedVia } : {}),
    baseUrlEnv: primary.baseUrlEnv,
    baseUrlEnvSource: primary.baseUrlEnvSource,
    baseUrl: primary.baseUrl,
    ...(primary.mode ? { mode: primary.mode } : {}),
    endpoints: { ...primary.endpoints },
    tokenSet: covered.some((s) => s.tokenSet),
    headers: primary.headers.map((h) => ({ ...h })),
    evidence: covered.flatMap((s) => s.evidence.map((e) => ({ service: s.service, ...e }))),
    undeclaredLocalEnv: [...new Set(covered.flatMap((s) => s.undeclaredLocalEnv))],
  };
}

/**
 * The ONE value every covered service agrees on, or `undefined` when they do not.
 * Services that carry nothing abstain rather than veto — a detected binary beside an
 * undetected sibling is still a binary; two different answers are no answer at all.
 */
function agreedOn<T>(values: readonly (T | undefined)[]): T | undefined {
  const distinct = new Set(values.filter((v): v is T => v !== undefined));
  return distinct.size === 1 ? [...distinct][0] : undefined;
}

/** Env var name → what it must hold, from the registration's own declaration. */
function envDescriptions(
  registration: GuardDependencyRegistration | undefined,
): Map<string, string> {
  const out = new Map<string, string>();
  if (!registration) return out;
  if (registration.kind === 'env') {
    for (const v of registration.vars) out.set(v.name, v.description);
  } else {
    out.set('path', registration.description);
  }
  return out;
}

/** What the row's names — its own and every service it covers — hold back, deduped. */
function blocksFor(
  keys: readonly string[],
  blocked: ReadonlyMap<string, GuardDependencyBlockedFlow[]>,
): GuardDependencyBlockedFlow[] {
  const out: GuardDependencyBlockedFlow[] = [];
  const seen = new Set<string>();
  for (const key of new Set(keys)) {
    for (const row of blocked.get(key) ?? []) {
      const id = row.flowId ?? `\0${row.title}`;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(row);
    }
  }
  return out;
}

/**
 * How many flows rely on the row: the flows that CONTRIBUTED a need to it, plus the
 * flows whose committed scenarios BIND it. Both halves are real usage and neither
 * implies the other — a flow can want a dependency before a test exists, and a test
 * can bind one its flow never described.
 *
 * A flow the last generate could not author (`not-authored`) is deliberately out: it
 * is a gap in the coverage, not a flow using the dependency today.
 */
function usedByFlows(
  keys: readonly string[],
  needs: readonly GuardDependencyNeed[],
  blocked: ReadonlyMap<string, GuardDependencyBlockedFlow[]>,
): number {
  const flows = new Set<string>(needs.map((n) => n.flowId));
  for (const key of new Set(keys)) {
    for (const row of blocked.get(key) ?? []) {
      if (row.kind !== 'test-blocked') continue;
      flows.add(row.flowId ?? `\0${row.title}`);
    }
  }
  return flows.size;
}

/** flowId → title, from the committed flow corpus. */
function readFlowTitles(repoRoot: string): Map<string, string> {
  const flows = readGuardFlowsCorpus(repoRoot);
  return new Map((flows?.flows ?? []).map((f) => [f.id, f.title]));
}

/**
 * Dependency name → what it holds back, from BOTH honest sources: the committed
 * scenarios that BIND it (a test that exists and cannot run) and the last
 * generate's `blocked-on` gaps naming it (a test that was never written). Neither
 * alone is the answer — a repo can have both, and a reader clearing the
 * dependency clears both.
 */
function blockedIndex(
  repoRoot: string,
  flowTitles: ReadonlyMap<string, string>,
): Map<string, GuardDependencyBlockedFlow[]> {
  const out = new Map<string, GuardDependencyBlockedFlow[]>();
  const push = (key: string, row: GuardDependencyBlockedFlow): void => {
    const rows = out.get(key) ?? [];
    if (rows.some((r) => (r.flowId ?? r.title) === (row.flowId ?? row.title))) return;
    rows.push(row);
    out.set(key, rows);
  };

  for (const scenario of loadScenarios(repoRoot).scenarios) {
    const flowId = scenario.flow?.id;
    const title = (flowId ? flowTitles.get(flowId) : undefined) ?? scenario.title;
    for (const name of scenarioDependencyNames(scenario)) {
      push(name, { ...(flowId ? { flowId } : {}), title, kind: 'test-blocked' });
    }
  }

  for (const gap of readGuardResult(repoRoot)?.coverageGaps ?? []) {
    if (gap.kind !== 'blocked-on') continue;
    // A flow-level gap is named by its flow (its id when the corpus no longer
    // titles it); a claim-level one belongs to no flow, so it is named by the
    // section it pivots on — never a blank row.
    const title = gap.flowId
      ? flowTitles.get(gap.flowId) ?? gap.flowId
      : `${gap.doc} § ${gap.anchor}`;
    for (const capability of parseBlockedOnCapabilities(gap.reason)) {
      push(capability, { ...(gap.flowId ? { flowId: gap.flowId } : {}), title, kind: 'not-authored' });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The write — registering an instance.
// ---------------------------------------------------------------------------

/** A rejected registration; the message is safe to show verbatim (never a secret). */
export class GuardDependencyWriteError extends Error {}

/**
 * One dependency's registration, as a caller asks for it to be stored. Every
 * field is the INSTANCE half: it lands in the gitignored overlay, never in git —
 * except `baseUrl` / `mode` on a recipe-declared service, which are that
 * declaration's own fields and go where the declaration is.
 */
export interface GuardDependencyPatch {
  /** Values for the declared env vars; `null` (or blank) drops one. */
  env?: Record<string, string | null>;
  /** The host path (path / config-dir shapes); `null` (or blank) clears it. */
  path?: string | null;
  /** Service rows: the variable the app reads the origin from. */
  baseUrlEnv?: string;
  /** Service rows: the provided origin. */
  baseUrl?: string;
  /** Service rows: whether the account is a sandbox or the real thing. */
  mode?: 'sandbox' | 'real';
  /** Service rows: the authorization token; `null` (or blank) clears it. */
  token?: string | null;
  /** Service rows: extra request headers; a `null` (or blank) entry drops one. */
  headers?: Record<string, string | null>;
}

/**
 * Register (or clear) ONE dependency's instance and answer with the fresh view.
 *
 * A catalog entry's instance goes to `scenarios/dependencies.local.json` — the
 * gitignored overlay, keyed by the entry name, merged over the declaration per
 * field at load time. Only the fields the committed registration DECLARES are
 * accepted: an overlay that could introduce a variable teammates cannot see would
 * make the catalog a lie about what the program needs.
 *
 * A service the catalog does not declare is the api-era shape, and it keeps its
 * own writer ({@link writeGuardExternals}) so the committed/secret split of a
 * recipe declaration stays in exactly one place.
 */
export function writeGuardDependency(
  repoRoot: string,
  name: string,
  patch: GuardDependencyPatch,
): GuardDependenciesView {
  const view = readGuardDependenciesView(repoRoot);
  const row = view.dependencies.find((d) => d.name === name);
  if (!row) {
    throw new GuardDependencyWriteError(`No dependency named "${name}" in this repository.`);
  }

  if (!row.registration) {
    if (!row.service) {
      throw new GuardDependencyWriteError(
        `"${name}" is ${row.class}, so there is no instance to register — the scenario creates it, or the runner seeds it.`,
      );
    }
    return writeServiceDependency(repoRoot, row, patch);
  }

  const local: GuardDependenciesLocal = readLocalForWrite(repoRoot);
  const entry = { ...(local[name] ?? {}) };

  if (row.registration.kind === 'env') {
    if (patch.path !== undefined) {
      throw new GuardDependencyWriteError(
        `"${name}" is registered through environment variables, not a path.`,
      );
    }
    const declared = new Set(row.registration.vars.map((v) => v.name));
    const env: Record<string, string> = { ...(entry.env ?? {}) };
    for (const [variable, value] of Object.entries(patch.env ?? {})) {
      if (!declared.has(variable)) {
        throw new GuardDependencyWriteError(
          `"${name}" does not declare an environment variable named ${variable}.`,
        );
      }
      if (value === null || value.trim() === '') delete env[variable];
      else env[variable] = value;
    }
    if (Object.keys(env).length > 0) entry.env = sortedByKey(env);
    else delete entry.env;
  } else {
    if (patch.env !== undefined) {
      throw new GuardDependencyWriteError(`"${name}" is registered through a path, not variables.`);
    }
    const value = patch.path == null ? '' : patch.path.trim();
    if (value === '') delete entry.path;
    else entry.path = value;
  }

  if (Object.keys(entry).length > 0) local[name] = entry;
  else delete local[name];
  writeLocal(dependenciesLocalPath(repoRoot), local);

  // A catalog entry that IS a recipe-declared service still carries the fields only
  // its declaration can hold — the origin and the account kind travel to
  // recipe.json, where the team shares them; the token and the headers are secrets
  // and stop at the overlay. One writer decides which, for both.
  if (
    (patch.baseUrl !== undefined ||
      patch.mode !== undefined ||
      patch.token !== undefined ||
      patch.headers !== undefined) &&
    row.service?.declaredInRecipe
  ) {
    writeServiceFields(repoRoot, row, patch);
  }
  return readGuardDependenciesView(repoRoot);
}

/** The api-shaped write: a service declaration plus its secrets, split by the externals writer. */
function writeServiceDependency(
  repoRoot: string,
  row: GuardDependencyRowView,
  patch: GuardDependencyPatch,
): GuardDependenciesView {
  if (patch.path !== undefined) {
    throw new GuardDependencyWriteError(
      `"${row.name}" is an external service: it is registered through its base URL and variables, not a path.`,
    );
  }
  writeServiceFields(repoRoot, row, patch);
  return readGuardDependenciesView(repoRoot);
}

function writeServiceFields(
  repoRoot: string,
  row: GuardDependencyRowView,
  patch: GuardDependencyPatch,
): void {
  const service = row.service!;
  const baseUrlEnv = (patch.baseUrlEnv ?? service.baseUrlEnv ?? '').trim();
  if (!baseUrlEnv) {
    throw new GuardDependencyWriteError(
      `"${row.name}" needs the environment variable the program reads its base URL from.`,
    );
  }
  const env: Record<string, { value: string } | null> = {};
  for (const [variable, value] of Object.entries(patch.env ?? {})) {
    if (variable === baseUrlEnv) continue;
    env[variable] = value === null || value.trim() === '' ? null : { value };
  }
  try {
    writeGuardExternals(repoRoot, {
      externals: {
        [service.service]: {
          baseUrlEnv,
          ...(patch.baseUrl !== undefined ? { baseUrl: patch.baseUrl.trim() } : {}),
          ...(patch.mode ? { mode: patch.mode } : {}),
          ...(Object.keys(env).length > 0 ? { env } : {}),
          ...(patch.token !== undefined ? { token: patch.token } : {}),
          ...(patch.headers !== undefined ? { headers: patch.headers } : {}),
        },
      },
    });
  } catch (e) {
    if (e instanceof GuardExternalsWriteError) throw new GuardDependencyWriteError(e.message);
    throw e;
  }
}

/** Read the overlay for a write; a broken overlay is refused, never overwritten. */
function readLocalForWrite(repoRoot: string): GuardDependenciesLocal {
  try {
    return { ...loadDependenciesLocal(repoRoot) };
  } catch (e) {
    throw new GuardDependencyWriteError(
      `${e instanceof Error ? e.message : String(e)} — fix or delete the file before saving.`,
    );
  }
}

/** The overlay write: 2-space + newline, sorted, deleted entirely when empty. */
function writeLocal(file: string, local: GuardDependenciesLocal): void {
  if (Object.keys(local).length === 0) {
    if (fs.existsSync(file)) fs.rmSync(file);
    return;
  }
  const text = JSON.stringify(sortedByKey(local), null, 2) + '\n';
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf-8') === text) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWriteText(file, text);
}

function sortedByKey<T>(record: Record<string, T>): Record<string, T> {
  const out: Record<string, T> = {};
  for (const key of Object.keys(record).sort()) out[key] = record[key];
  return out;
}
