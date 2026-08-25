/**
 * The DEPENDENCIES wire types — the shape
 * `GET/PUT /api/repos/:id/guard/dependencies` speaks.
 *
 * They mirror `packages/core/src/commands/guard-dependencies.ts` rather than
 * importing it: the client depends on `@truecourse/shared` only —
 * `@truecourse/core` is a Node package (fs, atomic writes) that must never enter
 * the browser bundle. Keep this file in sync when the engine's view grows a field.
 *
 * One rule the shapes enforce: a registered value travels back only as much as a
 * reader may see. Everything registered in the open (a base URL, a provider name, a
 * host path) comes back as itself, so a form shows what this machine is pointed at;
 * a SECRET comes back MASKED by the server and never as its characters — which is
 * why a mask is a reading, never something a patch may carry.
 */

/** How a scenario may obtain a class of starting state. */
export type GuardDependencyClass = 'step-creatable' | 'seedable' | 'supplied';

/** Whether a supplied dependency can be bound on this machine, right now. */
export type GuardDependencyState = 'provided' | 'incomplete' | 'unprovided';

/** One env var an instance is registered through. */
export interface GuardDependencyEnvVar {
  name: string;
  /** What this variable must hold — shown next to the field a user fills in. */
  description: string;
  /** True when the value is a secret, so no surface ever echoes it. */
  secret: boolean;
  /**
   * True when leaving it unregistered is a legitimate answer — the program has a
   * default. It is listed like any other variable and never gates `provided`.
   */
  optional?: boolean;
}

/** The SHAPE a user registers an instance in — what the form must render. */
export type GuardDependencyRegistration =
  | { kind: 'env'; vars: GuardDependencyEnvVar[] }
  | { kind: 'path'; description: string }
  | { kind: 'config-dir'; homePath: string; description: string };

/** One field a registration must supply, and whether it did. */
export interface GuardDependencyField {
  /** `path` for the path / config-dir shapes; the env var name for the env shape. */
  field: string;
  resolved: boolean;
  /** Why it is unresolved — rendered verbatim. */
  reason?: string;
  secret: boolean;
  description?: string;
  /**
   * The registered value as a reader may see it; absent when nothing is registered.
   * A secret arrives MASKED — a marker to render, never a value to send back.
   */
  value?: string;
}

/** One flow's contribution to the rolled-up requirement. */
export interface GuardDependencyNeed {
  flowId: string;
  /** The flow's title, when the corpus still names it. */
  title?: string;
  need: string;
}

/** One thing the dependency holds back. */
export interface GuardDependencyBlockedFlow {
  /** Absent for a claim-level generate gap, which belongs to no flow. */
  flowId?: string;
  title: string;
  kind: 'test-blocked' | 'not-authored';
}

/**
 * One request header registered for a service. A header whose NAME reads as a
 * credential travels without its value — the server decides that, so the form
 * masks exactly what the server withheld.
 */
export interface GuardDependencyHeader {
  name: string;
  /** The stored value; absent when the name reads as a secret. */
  value?: string;
  secret: boolean;
}

/** The external-service half of a row — present only when the row IS one. */
export interface GuardDependencyService {
  /** The row's PRIMARY service identity — the first one it covers. */
  service: string;
  /**
   * EVERY service identity this row covers. One entry may stand for several (one
   * credential entry for four model providers); each folds in here rather than
   * listing as a row of its own.
   */
  services: string[];
  detected: boolean;
  /** `recipe.json` declares the primary one under `api.externals`. */
  declaredInRecipe: boolean;
  /** Absent when the covered services disagree. */
  category?: string;
  /** Absent when the covered services were identified in different ways. */
  detectedVia?: string;
  baseUrlEnv: string | null;
  baseUrlEnvSource: 'recipe' | 'detected' | null;
  baseUrl: string | null;
  mode?: 'sandbox' | 'real';
  endpoints: Record<string, string>;
  /** True when an authorization token is registered on this machine. */
  tokenSet: boolean;
  /** The registered request headers; a secret-named one carries no value. */
  headers: GuardDependencyHeader[];
  /** Detection evidence for every covered service, each hit naming the one it is for. */
  evidence: { service: string; filePath: string; importSource?: string; url?: string }[];
  undeclaredLocalEnv: string[];
}

/** One dependency as the page lists it. */
export interface GuardDependencyRow {
  name: string;
  class: GuardDependencyClass;
  summary: string;
  /** WHEN it applies; absent ⇒ unconditional. */
  when?: string;
  requirement: string;
  needs: GuardDependencyNeed[];
  obtain?: string;
  /** `null` ⇒ nothing to register (the scenario creates it, or the runner seeds it). */
  state: GuardDependencyState | null;
  registration?: GuardDependencyRegistration;
  fields: GuardDependencyField[];
  hostPath?: string;
  /**
   * An instance IS registered, in a shape this registration no longer reads — so the
   * row is unregistered and the stored value is ignored. One quiet sentence saying so.
   */
  staleInstance?: string;
  blocks: GuardDependencyBlockedFlow[];
  /**
   * How many flows rely on it — needs contributed plus committed scenarios binding
   * it. A fact, not a state: it does not change when an instance is registered.
   */
  usedBy: number;
  service?: GuardDependencyService;
  inCatalog: boolean;
}

/** The whole dependencies page in one read. */
export interface GuardDependenciesView {
  catalogPath: string;
  localPath: string;
  recipePath: string;
  invalidReason: string | null;
  /** False means "nothing has looked yet", NOT "this repo depends on nothing". */
  detectionAvailable: boolean;
  dependencies: GuardDependencyRow[];
  unknownLocalNames: string[];
}

/**
 * One dependency's registration, as the page asks for it to be stored. Every
 * field is the INSTANCE half and lands in the gitignored overlay — except
 * `baseUrl` on a recipe-declared service, which is that declaration's own field.
 */
export interface GuardDependencyPatch {
  /** Values for the declared env vars; `null` (or blank) drops one. */
  env?: Record<string, string | null>;
  /** The host path (path / config-dir shapes); `null` (or blank) clears it. */
  path?: string | null;
  baseUrlEnv?: string;
  baseUrl?: string;
  /** The authorization token; `null` (or blank) clears it. A secret — overlay only. */
  token?: string | null;
  /** Extra request headers; a `null` (or blank) entry drops one. Overlay only. */
  headers?: Record<string, string | null>;
}
