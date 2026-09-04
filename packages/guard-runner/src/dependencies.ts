/**
 * THE DEPENDENCY CATALOG, run side — the declaration (`scenarios/dependencies.json`)
 * joined with the local instance overlay (`scenarios/dependencies.local.json`), and
 * the materialization of a registered instance into a scenario's sandbox.
 *
 * The shapes and the committed-vs-local rationale live in
 * `@truecourse/shared` (`guard/dependencies.ts`). This module is the engine half,
 * and it answers exactly two questions:
 *
 *   1. Is a SUPPLIED dependency provided on this machine? The runner gates on it:
 *      a scenario binding an unprovided one settles `blocked` naming the dependency
 *      and its rolled-up requirement, before any sandbox, any child process, and
 *      any network call — and therefore a literal `${supplied:…}` token can never
 *      reach an argv, an env value, or a seeded file.
 *   2. Where does the instance live INSIDE the sandbox? Never in place: a path is
 *      copied under the scenario cwd, a config dir is copied into the sandbox HOME.
 *      Copy-in, never a symlink or a passthrough, so a run can never mutate the
 *      user's real project, corpus, or login state.
 *
 * The `externals.ts` module is the same pattern one class narrower (external
 * services are one kind of supplied dependency); it is left in place until the
 * setup rebuild folds `api.externals` into the catalog.
 */

import fs from 'node:fs'
import path from 'node:path'
import {
  EMPTY_GUARD_DEPENDENCIES,
  GuardDependenciesFileSchema,
  GuardDependenciesLocalSchema,
  rollUpRequirement,
  suppliedNamesIn,
  suppliedTokenRefs,
  type GuardDependenciesFile,
  type GuardDependenciesLocal,
  type GuardDependencyEntry,
  type GuardDependencyNeed,
  type GuardExpect,
  type GuardFileExpect,
  type GuardScenario,
} from '@truecourse/shared'
import { RecipeError, secretBullets } from './recipe.js'
import { mapExpectStrings } from './sandbox-token.js'
import { dependenciesLocalPath, dependenciesPath } from './store.js'

/** A catalog or overlay file that exists but cannot be trusted. */
export class DependencyCatalogError extends RecipeError {}

/**
 * ONE registered secret as a reader may see it: bullets to its length (capped), and
 * the words for what it is — a value this machine holds, not a value being shown.
 *
 * The instance-overlay twin of {@link maskRecipeSecret}, and the same rule: a
 * surface that wants to say "this is registered" says it with a mask rather than
 * with the characters, so the raw value never leaves the process that read it.
 */
export function maskStoredSecret(value: string): string {
  return `${secretBullets(value)} (stored locally, masked)`
}

/** Whether a supplied dependency can actually be bound on this machine, right now. */
export type DependencyState = 'provided' | 'incomplete' | 'unprovided'

/** One thing an instance registration must supply, and whether it did. */
export interface DependencyRequirement {
  /** `path` for the path/config-dir shapes; the env var name for the env shape. */
  field: string
  resolved: boolean
  /** Why it is unresolved — rendered verbatim by every surface. */
  reason?: string
  /** True when the value must never be echoed (an env value is a key by construction). */
  secret: boolean
  /**
   * True when the declaration calls this variable optional: it is listed, and it
   * resolves when registered, but it never votes on the entry's state and never
   * appears in the reason a scenario blocked. Absent ⇒ required.
   */
  optional?: boolean
}

/** One catalog entry joined with the overlay and checked against this machine. */
export interface ResolvedDependency {
  name: string
  entry: GuardDependencyEntry
  /**
   * Only a SUPPLIED entry has a state: the other two classes are obtained by the
   * scenario itself (public steps) or by the runner's seeding, so there is nothing
   * for a user to register and nothing to be missing.
   */
  state: DependencyState | null
  requirements: DependencyRequirement[]
  /** The rolled-up requirement (dismissed flows dropped) — always a sentence. */
  requirement: string
  needs: GuardDependencyNeed[]
  /** The host path the overlay registered, when it registered one. */
  hostPath?: string
  /** Declared env values from the overlay, by name (provided/incomplete only). */
  env: Record<string, string>
  /**
   * The overlay holds an instance in a shape this registration no longer uses — a
   * path where the entry now takes variables, or the reverse. One quiet sentence,
   * never an error: a catalog entry may legitimately change how it is registered
   * (an authenticated config directory becoming a token), and the honest reading of
   * yesterday's instance is that the dependency is UNREGISTERED, plus a line saying
   * why the value already on disk is being ignored. Absent when the shapes agree.
   */
  staleInstance?: string
}

/** The whole catalog, resolved. */
export interface ResolvedDependencies {
  dependencies: ResolvedDependency[]
  /** Overlay keys naming an entry the catalog never declares — ignored, surfaced. */
  unknownLocalNames: string[]
  /** Absolute paths, shown whether or not the files exist. */
  catalogPath: string
  localPath: string
  /** False when the catalog file is absent (an empty catalog is still a catalog). */
  catalogExists: boolean
}

/**
 * Read + validate the committed catalog, or an EMPTY catalog when the file is
 * absent (a repo that has never run setup legitimately has none). A file that
 * exists but does not parse is a LOUD error, never an empty catalog: silently
 * ignoring it would run scenarios against dependencies nobody checked and blame the
 * program for the failures — the `externals.local.json` rule, for the same reason.
 */
export function loadDependencyCatalog(repoRoot: string): GuardDependenciesFile {
  const file = dependenciesPath(repoRoot)
  if (!fs.existsSync(file)) return EMPTY_GUARD_DEPENDENCIES
  return parseOrThrow(file, 'dependencies.json', GuardDependenciesFileSchema)
}

/** Read + validate the gitignored instance overlay, or `{}` when it is absent. */
export function loadDependenciesLocal(repoRoot: string): GuardDependenciesLocal {
  const file = dependenciesLocalPath(repoRoot)
  if (!fs.existsSync(file)) return {}
  return parseOrThrow(file, 'dependencies.local.json', GuardDependenciesLocalSchema)
}

function parseOrThrow<T>(
  file: string,
  label: string,
  schema: { safeParse(v: unknown): { success: true; data: T } | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } } },
): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (e) {
    throw new DependencyCatalogError(
      `${label} is not valid JSON: ${e instanceof Error ? e.message : e}`,
    )
  }
  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new DependencyCatalogError(
      `${label} is invalid: ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`.trim()).join('; ')}`,
    )
  }
  return result.data
}

/**
 * Join the catalog with the overlay and decide each supplied entry's state.
 *
 * The state follows what the USER registered, exactly as an external's does:
 * nothing registered ⇒ `unprovided` (the honest starting point — the catalog exists
 * so a surface can offer to fill it in); everything registered and present on disk
 * ⇒ `provided`; anything in between ⇒ `incomplete`, which blocks just as loudly.
 * A half-registered dependency is the dangerous state — a path that no longer
 * exists, three env vars of four — so it never runs. Only the REQUIRED variables
 * are counted: a declared-optional one is listed and resolved like any other, but
 * leaving it blank is a legitimate answer and never holds the entry back.
 *
 * `dismissedFlows` drops the needs of flows the user dismissed out of the rolled-up
 * requirement: a dismissed flow's expectation dies with it.
 */
export function resolveDependencies(
  repoRoot: string,
  opts: { dismissedFlows?: ReadonlySet<string> } = {},
): ResolvedDependencies {
  const catalog = loadDependencyCatalog(repoRoot)
  const local = loadDependenciesLocal(repoRoot)
  const declared = new Set(catalog.dependencies.map((d) => d.name))
  return {
    dependencies: catalog.dependencies.map((entry) =>
      resolveDependency(entry, local[entry.name], repoRoot, opts.dismissedFlows),
    ),
    unknownLocalNames: Object.keys(local)
      .filter((name) => !declared.has(name))
      .sort(),
    catalogPath: dependenciesPath(repoRoot),
    localPath: dependenciesLocalPath(repoRoot),
    catalogExists: fs.existsSync(dependenciesPath(repoRoot)),
  }
}

/** One entry joined with its overlay row. Exported for the surfaces that hold both. */
export function resolveDependency(
  entry: GuardDependencyEntry,
  overlay: GuardDependenciesLocal[string] | undefined,
  repoRoot: string,
  dismissedFlows: ReadonlySet<string> = new Set(),
): ResolvedDependency {
  const rolled = rollUpRequirement(entry, dismissedFlows)
  const common = {
    name: entry.name,
    entry,
    requirement: rolled.sentence,
    needs: rolled.needs,
  }
  if (entry.class !== 'supplied' || !entry.registration) {
    return { ...common, state: null, requirements: [], env: {} }
  }

  const requirements: DependencyRequirement[] = []
  const env: Record<string, string> = {}
  let hostPath: string | undefined

  if (entry.registration.kind === 'env') {
    for (const declaredVar of entry.registration.vars) {
      const optional = declaredVar.optional === true ? { optional: true } : {}
      const value = overlay?.env?.[declaredVar.name]
      if (value === undefined || value === '') {
        requirements.push({
          field: declaredVar.name,
          resolved: false,
          // An OPTIONAL variable left blank is not a fault, so it carries no reason:
          // a surface that prints one would tell a reader to fix a thing that is fine.
          ...(declaredVar.optional === true
            ? {}
            : { reason: `no value registered for \`${declaredVar.name}\`` }),
          secret: declaredVar.secret,
          ...optional,
        })
        continue
      }
      requirements.push({
        field: declaredVar.name,
        resolved: true,
        secret: declaredVar.secret,
        ...optional,
      })
      env[declaredVar.name] = value
    }
  } else {
    const raw = overlay?.path
    if (raw === undefined || raw === '') {
      requirements.push({
        field: 'path',
        resolved: false,
        reason: 'no path registered',
        secret: false,
      })
    } else {
      const abs = path.isAbsolute(raw) ? raw : path.resolve(repoRoot, raw)
      if (!fs.existsSync(abs)) {
        requirements.push({
          field: 'path',
          resolved: false,
          reason: `the registered path does not exist on this machine: ${abs}`,
          secret: false,
        })
      } else {
        requirements.push({ field: 'path', resolved: true, secret: false })
        hostPath = abs
      }
    }
  }

  // Only the REQUIRED half votes — an optional variable is listed and resolved like
  // any other, but leaving it blank is a legitimate answer, so it can never hold an
  // otherwise-complete registration in `incomplete` (or an empty one in
  // `unprovided`). Same rule an external's DERIVED requirement follows.
  const voting = requirements.filter((r) => !r.optional)
  const satisfied = voting.filter((r) => r.resolved).length
  const state: DependencyState =
    satisfied === voting.length ? 'provided' : satisfied === 0 ? 'unprovided' : 'incomplete'

  const staleInstance = staleInstanceNote(entry, overlay)
  return {
    ...common,
    state,
    requirements,
    env,
    ...(hostPath ? { hostPath } : {}),
    ...(staleInstance ? { staleInstance } : {}),
  }
}

/**
 * The one-line diagnostic for an overlay instance written in a shape the current
 * registration does not read. See {@link ResolvedDependency.staleInstance}.
 */
function staleInstanceNote(
  entry: GuardDependencyEntry,
  overlay: GuardDependenciesLocal[string] | undefined,
): string | undefined {
  const registration = entry.registration
  if (!overlay || !registration) return undefined
  if (registration.kind === 'env') {
    if (overlay.path === undefined) return undefined
    return (
      'the registered instance is a path, but this dependency is now registered as ' +
      `${registration.vars.map((v) => `\`${v.name}\``).join(', ')} — the path is ignored`
    )
  }
  // An entry that IS an external service legitimately carries variables beside its
  // path: the externals half writes the service's own transport there, and reading
  // that as a stale instance would nag about a registration that is working.
  if (entry.services?.length) return undefined
  if (overlay.env === undefined || Object.keys(overlay.env).length === 0) return undefined
  return (
    'the registered instance is a set of variables, but this dependency is now registered ' +
    'as a path — the variables are ignored'
  )
}

// ---------------------------------------------------------------------------
// The catalog-first external-service read surface
// ---------------------------------------------------------------------------

/**
 * Per external SERVICE, whether this machine can reach it — the CATALOG's
 * answer first, the recipe's `api.externals` declaration as the fallback.
 *
 * The committed catalog is the curated layer every read surface moves to: a
 * supplied catalog entry that names a service (`entry.services`) carries the
 * registration and the instance overlay decides its state, no `api` block
 * required. The recipe declaration keeps answering for the services only IT
 * declares — the detection-era fallback — and when both name a service the
 * catalog wins, because it is the layer setup now writes.
 *
 * A broken catalog file contributes nothing here (the recipe half is still
 * true); loading it loudly stays `resolveDependencies`' own job.
 */
export function externalServiceStates(
  repoRoot: string,
  declared: Record<string, { baseUrlEnv: string }> | undefined,
  opts: {
    /** The recipe-resolved externals, when the caller already has them (avoids a
     *  second overlay read). Absent ⇒ nothing recipe-side enters the map. */
    recipeStates?: ReadonlyMap<string, DependencyState>
    dismissedFlows?: ReadonlySet<string>
  } = {},
): Map<string, DependencyState> {
  const states = new Map<string, DependencyState>()
  for (const service of Object.keys(declared ?? {})) {
    const recipeState = opts.recipeStates?.get(service)
    if (recipeState) states.set(service, recipeState)
  }
  let resolved: ResolvedDependencies
  try {
    resolved = resolveDependencies(repoRoot, {
      ...(opts.dismissedFlows ? { dismissedFlows: opts.dismissedFlows } : {}),
    })
  } catch {
    return states
  }
  for (const dependency of resolved.dependencies) {
    if (dependency.state === null) continue
    for (const service of dependency.entry.services ?? []) {
      // The catalog wins outright — including over a recipe declaration of the
      // same service: one dependency entry may stand for several services, and
      // its registration is where the user was told to put the account.
      states.set(service, dependency.state)
    }
  }
  return states
}

// ---------------------------------------------------------------------------
// What a scenario binds
// ---------------------------------------------------------------------------

/**
 * The supplied dependencies a scenario BINDS — its declared `needs` plus every name
 * a `${supplied:…}` token references anywhere in it (steps, setup, expectations).
 *
 * Both halves count, and neither is redundant: a token-free binding (an
 * authenticated HOME the program finds by itself) is only visible in `needs`, while
 * a token the author wrote without listing the name is still a real binding and
 * must gate the run rather than land on disk verbatim.
 */
export function scenarioDependencyNames(scenario: GuardScenario): string[] {
  // DECLARED order first, then the token-discovered rest: the author's ordering is
  // the meaningful one when a scenario binds several (it decides which dependency a
  // blocked result names), and only deduplication is imposed on top of it.
  const names = new Set<string>(scenario.needs ?? [])
  const { needs: _needs, ...rest } = scenario as GuardScenario & { needs?: string[] }
  for (const name of suppliedNamesIn(rest)) names.add(name)
  return [...names]
}

/** Why a scenario cannot run: the dependency, and what registering it must satisfy. */
export interface DependencyBlock {
  dependency: string
  requirement: string
  needs: GuardDependencyNeed[]
  /** Absolute path of the overlay file an instance is registered in. */
  registerIn: string
  /** The unresolved requirements' reasons, joined — the "what exactly is missing". */
  detail: string
}

/**
 * The FIRST binding that holds a scenario back, or `null` when every one of them is
 * provided. First rather than all: a scenario blocks on the first thing missing,
 * and naming one actionable dependency beats a list a reader has to triage.
 *
 * A name no catalog entry declares also blocks — an authoring defect
 * (`${supplied:whatever.path}` against an empty catalog) must be as loud as a
 * missing instance, never a token that quietly reaches a child process.
 */
export function dependencyBlockFor(
  scenario: GuardScenario,
  resolved: ResolvedDependencies,
): DependencyBlock | null {
  const byName = new Map(resolved.dependencies.map((d) => [d.name, d]))
  for (const name of scenarioDependencyNames(scenario)) {
    const dep = byName.get(name)
    if (!dep) {
      return {
        dependency: name,
        requirement: `no catalog entry named "${name}"`,
        needs: [],
        registerIn: resolved.catalogPath,
        detail: `the scenario binds "${name}", which \`scenarios/dependencies.json\` does not declare`,
      }
    }
    if (dep.state === null) {
      // A step-creatable / seedable entry is not a binding: the scenario creates or
      // the runner seeds that state. Naming one is harmless, and never a block.
      continue
    }
    if (dep.state === 'provided') continue
    return {
      dependency: dep.name,
      requirement: dep.requirement,
      needs: dep.needs,
      registerIn: resolved.localPath,
      detail: [
        ...dep.requirements
          .filter((r) => !r.resolved && !r.optional)
          .map((r) => r.reason ?? `\`${r.field}\` is not registered`),
        // An instance written in the previous registration shape is why an overlay
        // that LOOKS filled in still reads as unregistered — say so here, where the
        // reader is already asking what is missing.
        ...(dep.staleInstance ? [dep.staleInstance] : []),
      ].join('; '),
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Materialization
// ---------------------------------------------------------------------------

/** Directory (under the scenario cwd) a `path`-shaped instance is copied into. */
export const SUPPLIED_DIR = '.tc-supplied'

/** A name a child process can actually carry as an environment variable. */
const ENV_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** One provided instance, in the shape the sandbox materializes. */
export interface SuppliedInstance {
  name: string
  kind: 'env' | 'path' | 'config-dir'
  /** The host source to copy (path / config-dir shapes). */
  hostPath?: string
  /** HOME-relative destination (config-dir shape). */
  homePath?: string
  /** Declared env values (env shape). */
  env?: Record<string, string>
  /**
   * The variables the registration DECLARES OPTIONAL that this machine left blank
   * (env shape). Not a fault and not a value: it is the one case where a
   * `${supplied:…}` token legitimately has nothing behind it, and the argv pair
   * naming it drops out instead of failing. See {@link SuppliedOmissions}.
   */
  optionalUnset?: string[]
}

/**
 * The instances a scenario's bindings materialize into its sandbox. Called only
 * after {@link dependencyBlockFor} returned `null`, so every entry here is
 * `provided` — an unprovided one never gets this far.
 */
export function suppliedInstancesFor(
  scenario: GuardScenario,
  resolved: ResolvedDependencies,
): SuppliedInstance[] {
  const byName = new Map(resolved.dependencies.map((d) => [d.name, d]))
  const out: SuppliedInstance[] = []
  for (const name of scenarioDependencyNames(scenario)) {
    const dep = byName.get(name)
    if (!dep || dep.state !== 'provided' || !dep.entry.registration) continue
    const registration = dep.entry.registration
    if (registration.kind === 'env') {
      const optionalUnset = dep.requirements
        .filter((r) => r.optional && !r.resolved)
        .map((r) => r.field)
      out.push({
        name,
        kind: 'env',
        env: dep.env,
        ...(optionalUnset.length > 0 ? { optionalUnset } : {}),
      })
    } else if (registration.kind === 'path') {
      out.push({ name, kind: 'path', hostPath: dep.hostPath! })
    } else {
      out.push({
        name,
        kind: 'config-dir',
        hostPath: dep.hostPath!,
        homePath: registration.homePath,
      })
    }
  }
  return out
}

/** What `${supplied:<name>.<field>}` resolves to, per dependency. */
export type SuppliedValues = Record<string, Record<string, string>>

/**
 * The `<name>.<field>` refs a registration DECLARES OPTIONAL and this machine left
 * blank — the only refs that legitimately resolve to NOTHING.
 *
 * They are not values and never become any: `${supplied:…}` still throws on them
 * everywhere a value is required. Their one use is the omittable argv pair (see
 * `GuardOptionalArgSchema`), which drops both of its halves rather than asking the
 * program for an endpoint nobody named.
 */
export type SuppliedOmissions = ReadonlySet<string>

/**
 * True when this pair's value names an unregistered OPTIONAL field, so the flag and
 * the value both drop out of the argv. False for every other token — a registered
 * field resolves, a required one blocked the scenario long before here, and a field
 * no registration declares is still the loud error {@link applySupplied} raises.
 */
export function omitsOptionalPair(value: string, omissions: SuppliedOmissions): boolean {
  return suppliedTokenRefs(value).some((ref) => omissions.has(`${ref.name}.${ref.field}`))
}

/**
 * Copy every provided instance into the sandbox and return both the values
 * `${supplied:…}` resolves to and the env the child must carry.
 *
 * COPY-IN, never a reference: `path` lands under the scenario cwd (so a step's
 * `cwd` can point at it and the sandbox containment rule still holds), `config-dir`
 * lands inside the sandbox HOME at its declared destination. Either way the run
 * works on a copy, so it cannot mutate the user's real project or login state — the
 * property that makes binding a real instance safe in the first place.
 */
export function materializeSupplied(
  instances: readonly SuppliedInstance[],
  sandbox: { cwd: string; home: string },
): { values: SuppliedValues; env: Record<string, string>; omissions: Set<string> } {
  const values: SuppliedValues = {}
  const env: Record<string, string> = {}
  const omissions = new Set<string>()
  for (const instance of instances) {
    if (instance.kind === 'env') {
      values[instance.name] = { ...instance.env }
      for (const field of instance.optionalUnset ?? []) omissions.add(`${instance.name}.${field}`)
      // A registered NAME that is a legal environment identifier is also exported to
      // the child — that is what makes an external-account registration work without
      // the scenario doing anything (the program reads `ANTHROPIC_API_KEY` itself).
      // A name that is not one (`api-key`) is a registration FIELD, reachable only
      // through `${supplied:…}`, so the scenario places it where the program reads
      // it. Nothing the scenario did not ask for ever lands in its env.
      for (const [name, value] of Object.entries(instance.env ?? {})) {
        if (ENV_IDENTIFIER.test(name)) env[name] = value
      }
      continue
    }
    const dest =
      instance.kind === 'config-dir'
        ? resolveInHome(sandbox.home, instance.homePath!, instance.name)
        : path.join(sandbox.cwd, SUPPLIED_DIR, instance.name)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    copySelfContained(instance.hostPath!, dest, path.resolve(instance.hostPath!))
    values[instance.name] = { path: dest }
  }
  return { values, env, omissions }
}

/**
 * The sandbox-HOME containment rule for a `config-dir` destination. The schema
 * already refuses an absolute or `..`-carrying `homePath`, but the catalog is a
 * committed file this process may read from any repo, so the invariant is enforced
 * where the copy actually happens too.
 */
function resolveInHome(home: string, homePath: string, name: string): string {
  const root = path.resolve(home)
  const dest = path.resolve(root, homePath)
  if (dest !== root && !dest.startsWith(root + path.sep)) {
    throw new DependencyCatalogError(
      `the "${name}" config-dir homePath escapes the sandbox HOME: ${homePath}`,
    )
  }
  return dest
}

/**
 * Copy a registered instance into the sandbox as a SELF-CONTAINED tree.
 *
 * A plain `cpSync({dereference: false})` would reproduce the host's symlinks
 * verbatim, and one that points OUTSIDE the instance (an absolute link, a `..`
 * traversal) would keep pointing at the host from inside the sandbox — a
 * `write:`/`patch:` step aimed through it would then mutate the developer's real
 * filesystem, defeating the copy-in guarantee. So: a relative link that resolves
 * INSIDE the instance is kept as a link (it resolves inside the copy the same
 * way — the pnpm `node_modules` layout survives untouched); every other link is
 * MATERIALIZED — its target's content is copied in its place — and a dangling one
 * is skipped. Nothing in the copy references the host.
 */
function copySelfContained(src: string, dest: string, root: string): void {
  const stat = fs.lstatSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true })
    for (const entry of fs.readdirSync(src)) {
      copySelfContained(path.join(src, entry), path.join(dest, entry), root)
    }
    return
  }
  if (stat.isSymbolicLink()) {
    const target = fs.readlinkSync(src)
    const resolved = path.resolve(path.dirname(src), target)
    const inside =
      !path.isAbsolute(target) && (resolved === root || resolved.startsWith(root + path.sep))
    if (inside) {
      fs.symlinkSync(target, dest)
      return
    }
    let targetStat: fs.Stats
    try {
      targetStat = fs.statSync(resolved)
    } catch {
      return
    }
    if (targetStat.isDirectory()) fs.cpSync(resolved, dest, { recursive: true, dereference: true })
    else fs.copyFileSync(resolved, dest)
    return
  }
  fs.copyFileSync(src, dest)
}

// ---------------------------------------------------------------------------
// The `${supplied:…}` token
// ---------------------------------------------------------------------------

/** {@link applySupplied} across a cli expectation — matcher values and `files` keys. */
export function applySuppliedExpect<E extends GuardExpect | GuardFileExpect>(
  expect: E,
  values: SuppliedValues,
): E {
  return mapExpectStrings(expect, (text) => applySupplied(text, values))
}

/** {@link applySupplied} across an env overlay's VALUES (the names are literal). */
export function applySuppliedEnv(
  env: Record<string, string>,
  values: SuppliedValues,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).map(([name, value]) => [name, applySupplied(value, values)]),
  )
}

/**
 * Resolve every `${supplied:<name>.<field>}` in a scenario-authored string. Same
 * surgical-replacement rule as `${sandbox}` and `${unique}`: a literal substring
 * swap, never a parser, and never applied to the recipe-owned entrypoint.
 *
 * An unknown name/field THROWS rather than passing the literal token through: by
 * the time this runs the scenario's bindings are all provided, so the only way to
 * get here is a field the registration does not declare — a defect that must be a
 * loud infrastructure error, not a `${supplied:…}` string handed to a program.
 */
export function applySupplied(text: string, values: SuppliedValues): string {
  if (!text.includes('${supplied:')) return text
  let out = text
  for (const ref of suppliedTokenRefs(text)) {
    const value = values[ref.name]?.[ref.field]
    if (value === undefined) {
      throw new DependencyCatalogError(
        `\${supplied:${ref.name}.${ref.field}} has no value — the registration for "${ref.name}" declares no \`${ref.field}\``,
      )
    }
    out = out.split(`\${supplied:${ref.name}.${ref.field}}`).join(value)
  }
  return out
}
