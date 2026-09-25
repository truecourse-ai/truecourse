/**
 * THE RUN — authoring sessions over places, folded into the authored catalog.
 *
 * This is the agentic pipeline's shape at the command level: a run over
 * work items, each item one session through `runAgentLoop`, each session's
 * outcome validated and persisted as it lands. Three properties follow from
 * folding after every place rather than at the end:
 *
 * - a session SEES the places already folded — its `list_interfaces`, its state
 *   registry and its uniqueness checks run against the catalog as it stands;
 * - an interrupted run keeps what it finished, because each place's write is
 *   atomic and complete;
 * - a session that fails costs exactly its own place. Failures are DATA here,
 *   the way `runAgentLoop` hands them back — the run reports them and continues.
 *
 * Sessions run concurrently. The outcome validator checks and writes each
 * fragment synchronously before the session completes. Conflicts return to
 * that same session for correction under its existing budget. The pool's fold
 * then records the final result and spend.
 *
 * WHAT THE POOL CONSUMES IS CLUSTERS, NOT PLACES. A cluster is the
 * places whose sessions read the same modules ({@link clusterPlaces}), and its
 * members run SERIALLY — the pool's serial groups: each one is briefed with its
 * peers' work already folded in. That is where the agreement actually matters —
 * every duplicate-id collision the pilot produced was between two places of one
 * cluster, two sessions naming one settings dialog twice because neither could
 * see the other. Running a cluster serially costs nothing in wall clock (the
 * clusters run in parallel with each other, and there are as many of them as
 * the pool has workers) and buys back the collisions that were worth having.
 *
 * What concurrency still costs is BRIEFING FRESHNESS ACROSS clusters. A session
 * is briefed with the catalog as it stands when the session starts, so the peers
 * in flight in OTHER clusters are invisible to it: they cannot be in its state
 * registry, and their tasks cannot be in its `list_interfaces`. Two consequences,
 * and both are handled rather than hoped away — a state named twice under two
 * ids is what the closing reconciliation settles; and a task id or
 * fingerprint claimed by a peer mid-flight is a RACE, not an authoring error, so
 * the fold drops that one task and keeps the rest ({@link pruneRacedTasks})
 * instead of refusing the fragment whole.
 *
 * A cluster of more than one also opens every member's session with the same
 * PACK — the shared modules' contents, read once ({@link clusterPack}) — under
 * one cache key, so the modules are in context before the first turn and the
 * prefix is bytes a provider's prompt cache can reuse between members.
 *
 * The driver and the persistence are INJECTED. This service knows nothing about
 * which backend runs the session or where the transcript lands; the command
 * adapter picks both (the configured transport, the run's sessions store).
 */

import { createHash } from 'node:crypto'
import type {
  SessionDriver,
  SessionEvent,
  SessionPersistence,
  SharedPromptPrefix,
} from '@truecourse/agent-loop'
import {
  hasAddressSlot,
  mergeInterfaceCatalogs,
  readAuthoredInterfaceCatalog,
  readInterfaceCatalog,
  authoringRecipeContract,
  sourceDigests,
  staleAuthoredPlaceDiagnostics,
  unsettledAuthoring,
  webScreenAuthoringStates,
  type WebScreenAuthoringInput,
} from '@truecourse/guard-runner'
import type { WebPlaceContext } from '@truecourse/interface-mapper'
import type {
  InterfaceAuthoringRecord,
  InterfaceResource,
  InterfacesFile,
  MapperDiagnostic,
} from '@truecourse/shared'
import { isLabelOnlyRekey, isRootPlace, resolvedInterfaceFingerprint, rootPlaceOf } from '@truecourse/shared'
import { readCachedSessionOutput, storeCachedSessionOutput } from '../agent/session-cache.js'
import { defaultPoolConcurrency, runSessionPool } from '../agent/session-pool.js'
import {
  AUTHORED_SURFACE,
  AuthoredFragmentSchema,
  draftPlaceIndex,
  registryStates,
  stampFragment,
  validateFragment,
  type AuthoredFragment,
} from './draft.js'
import { clusterPlaces, orderClustersLongestFirst, type PlaceCluster } from './cluster.js'
import type { AuthorFinding } from './findings.js'
import { clusterPack, type ClusterPack } from './pack.js'
import { placeSourcePack } from './place-pack.js'
import { ownTaskContext, ownTasks } from './catalog-context.js'
import type { LiveScreens, ObserveScreenResult } from './live-screen.js'
import { interfaceAuthorSessionDef, placeBriefing, placeWorkItem, type SharedPlaceBrief } from './session.js'
import type { SharedComponent } from './shared-places.js'
import { recordAuthoringLedger, registerSharedPlaces, writeAuthoredCatalog } from './write.js'

/**
 * Where a screen's accepted fragment is stored, keyed on the digest of what its
 * session ran over — the same value its ledger row records — and on whether the
 * session had the live screen ({@link fragmentCacheKey}). There is no legacy
 * key: authoring had no cache before this one.
 */
export const INTERFACE_AUTHOR_CACHE_NAME = 'guard/interfaces-author'

/**
 * A screen's cache key: its input digest and the source files it is grounded
 * on (a moved file is a different answer). A fragment authored from source
 * alone is keyed apart from one authored beside the live screen: the live one
 * is what a run that can stand the app up wants, so a source-only fragment
 * (written the time the world would not come up) is served only to another run
 * where it will not.
 */
export function fragmentCacheKey(
  inputFingerprint: string,
  sources: Readonly<Record<string, string>>,
  live: boolean,
): string {
  const files = Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))
  const key = files.length > 0
    ? `${inputFingerprint}:${createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0, 16)}`
    : inputFingerprint
  return live ? `${key}:live` : key
}

/** The source files a place is grounded on: its route module and what it renders. */
function groundingFiles(context: WebPlaceContext | undefined): string[] {
  return context ? [context.module, ...context.renders] : []
}

/** An explicit ask to author again reads no cached fragment: the point of both
 *  `replace` and `refresh` is to spend a session. */
function reauthoring(opts: Pick<AuthorRunOptions, 'replace' | 'refresh'>): boolean {
  return opts.replace === true || opts.refresh === true
}

export interface AuthorRunOptions {
  repoRoot: string
  driver: SessionDriver
  persistence: SessionPersistence
  /** Author only these place ids; default = every screen needing tasks or readable facts. */
  places?: readonly string[]
  /** Re-open every screen, settled or not, reading no cached fragment; each is reconciled against its tasks. */
  replace?: boolean
  /**
   * Re-open the screens whose ledger row says they never settled, whatever
   * their inputs say, and read no cached fragment. This is the explicit ask —
   * a person pressing refresh after a provider outage — and the only thing that
   * retries a failed screen whose inputs have not moved.
   */
  refresh?: boolean
  /** Stop after this many places — the cheap way to try one session first. */
  limit?: number
  /**
   * How many CLUSTERS run at once. Defaults to {@link defaultAuthorConcurrency}.
   * A cluster's own places run one after another whatever this is, and so does
   * the fold; what rises with it is how many peers in other clusters a session
   * cannot see in its briefing (see the module note).
   */
  concurrency?: number
  /**
   * What the AST pass knows about each place: its route module, the
   * modules it renders, the api effects its requests join to. Derived per run by
   * the caller — this service reads analyzer artifacts, it never produces them.
   * A place with no entry is briefed exactly as it was before the pack existed.
   */
  context?: ReadonlyMap<string, WebPlaceContext>
  /**
   * The shared places the context pass found ({@link detectSharedComponents}),
   * and which of them each place renders. Each is registered in the authored
   * catalog as a `component` place and authored ONCE, before the screens, at a
   * screen that renders it; a screen's briefing names the shared places it
   * renders with their tasks instead of handing it their source. A component
   * place the pass no longer finds earns no session. Absent ⇒ no component is
   * authored.
   */
  shared?: {
    components: readonly SharedComponent[]
    rendered: ReadonlyMap<string, readonly string[]>
  }
  /**
   * Stands the running app up, when the caller can: called at most once, and
   * only when a screen's live fragment is not cached — a run served wholly from
   * the cache boots nothing. What it hands back gives every session
   * `observe_screen`, and a screen whose address has no slot is observed once
   * before its session starts so the tree rides the briefing. Absent, or
   * `undefined` back ⇒ the sessions author from source alone. The caller tears
   * the world down after the run.
   */
  openLive?: () => Promise<LiveScreens | undefined>
  signal?: AbortSignal
  onProgress?: (event: AuthorProgress) => void
  /** Every transcript event, as it is persisted — the caller's live view. */
  onSessionEvent?: (placeId: string, event: SessionEvent) => void
  mintSessionId?: () => string
  now?: () => string
}

export type AuthorProgress =
  | { kind: 'place-start'; placeId: string; index: number; total: number }
  | { kind: 'place-done'; place: PlaceResult }

/** What one place's session produced. Every terminal state is one of these. */
export interface PlaceResult {
  placeId: string
  /** Absent when the screen was served from the cache and no session ran. */
  sessionId?: string
  /** The fragment came out of the cache — nothing was spent on this screen. */
  fromCache?: true
  /** `authored` = tasks or resources landed; `empty` = the session found neither;
   *  `rejected` = the outcome broke a rule the write path enforces;
   *  `failed` = the session itself did not reach an outcome. */
  status: 'authored' | 'empty' | 'rejected' | 'failed'
  taskIds: string[]
  unresolved: string[]
  /**
   * Code-vs-docs discrepancies this session found, verbatim. Kept whatever the
   * status: a finding is about the REPOSITORY, so a fragment that was refused
   * still found what it found.
   */
  findings: string[]
  /** Why it was rejected (validation) or how it failed (the session failure). */
  problems: string[]
  /**
   * Tasks a session in flight beside this one authored first — dropped from this
   * fragment so the rest could land. Empty on a serial run, and never a problem:
   * the task exists, it is just somebody else's entry now.
   */
  raced?: string[]
  /** This screen's existing tasks the session retired, each with its reason. */
  retired?: { id: string; reason: string }[]
  spent: { turns: number; tokens: number; costUsd: number }
  /** Whether a resume grant could continue a failed session. */
  resumable?: boolean
}

export interface AuthorRunResult {
  places: PlaceResult[]
  /** Tasks written across the run. */
  authored: number
  /**
   * Re-authored tasks whose fingerprint moved through a reworded step label
   * alone ({@link isLabelOnlyRekey}): a key that moved with nothing behind it.
   */
  labelRekeys: number
  /** The authored catalog path, when anything was written. */
  path?: string
  /** Places whose tasks and readable facts are already established. */
  skipped: string[]
  /**
   * Every finding the run's sessions reported, in work-list order and tagged
   * with the place that found it — what the caller appends to the ledger.
   */
  findings: AuthorFinding[]
  /**
   * What the planning noticed and did not act on: authored screens the
   * derivation no longer backs ({@link staleAuthoredPlaceDiagnostics}). Each one
   * was EXCLUDED from the work-list — a session on an address that only
   * redirects is a session wasted — and is reported here rather than silently
   * dropped. Never stored; the merged catalog readers see is unchanged.
   */
  diagnostics: MapperDiagnostic[]
  spent: { turns: number; tokens: number; costUsd: number }
}

/** A place the run can author against, with the tasks already located there. */
export interface AuthorWorkItem {
  place: InterfaceResource
  /** Ids of the authored tasks whose location resolves to this place. */
  existing: string[]
  /** Tasks or readable facts still need a source reading. */
  needsAuthoring: boolean
  /** Work only for a run whose live world comes up: the row was authored from source alone. */
  awaitsLiveLook: boolean
  /** What the ledger says authoring settled here, when it says anything. */
  record?: InterfaceAuthoringRecord
  /** The digest this screen's session runs over — its ledger row and cache key. */
  inputFingerprint: string
}

/**
 * The work list: every SCREEN the catalog knows, in catalog order, each with the
 * authored tasks already located on it (directly, or through a dialog/panel that
 * sits on it). A screen is the unit because it is what a derivation produces and
 * what an address names — the places nested on it are authored as part of it.
 *
 * Whether a screen is WORK is the ledger's answer ({@link webScreenAuthoringStates}),
 * which is why the recipe contract is a parameter: it is one of the inputs each
 * screen's row settled over. With the working tree, a row whose recorded source
 * files changed is work too, and with the current grounding, so is a row whose
 * set of grounding files is not the one it recorded; when the caller can look
 * at the screens live, so is a row authored from source alone.
 */
export function planWorkItems(
  derived: InterfacesFile | null,
  authored: InterfacesFile | null,
  recipeContract: string,
  opts: Pick<WebScreenAuthoringInput, 'repoRoot' | 'grounding' | 'liveAvailable'> = {},
): AuthorWorkItem[] {
  return webScreenAuthoringStates({ derived, authored, recipeContract, ...opts }).map((state) => ({
    place: state.place,
    existing: state.tasks,
    needsAuthoring: state.needsAuthoring,
    awaitsLiveLook: state.awaitsLiveLook,
    ...(state.record ? { record: state.record } : {}),
    inputFingerprint: state.inputFingerprint,
  }))
}

/** Every web place both halves know, the authored one winning on a shared id. */
function placeIndex(
  derived: InterfacesFile | null,
  authored: InterfacesFile | null,
): Map<string, InterfaceResource> {
  const places = new Map<string, InterfaceResource>()
  for (const place of [
    ...(derived?.resources?.[AUTHORED_SURFACE] ?? []),
    ...(authored?.resources?.[AUTHORED_SURFACE] ?? []),
  ]) {
    places.set(place.id, place)
  }
  return places
}

/** Author the web tasks of every selected place, folding each into the catalog. */
export async function authorWebInterfaces(opts: AuthorRunOptions): Promise<AuthorRunResult> {
  const derived = readInterfaceCatalog(opts.repoRoot)
  let authored = readAuthoredInterfaceCatalog(opts.repoRoot)
  const recipeContract = authoringRecipeContract(opts.repoRoot)

  // THE SHARED PLACES, registered before the work list is planned: each is a
  // root place of its own, so it is planned, ledgered and cached like a screen.
  const components = new Map((opts.shared?.components ?? []).map((component) => [component.id, component]))
  const registered = registerSharedPlaces({
    repoRoot: opts.repoRoot,
    authored,
    derived,
    components: [...components.values()],
    ...(opts.now ? { now: opts.now } : {}),
  })
  if (registered) authored = registered.file

  // The grounding as the context pass found it NOW, when it found any: a pass
  // that could not run leaves every row to be judged by the files it recorded.
  const grounding = opts.context && opts.context.size > 0
    ? new Map([...opts.context].map(([placeId, context]) => [placeId, groundingFiles(context)]))
    : undefined
  // A run that may stand the app up re-opens the screens authored from source
  // alone; if the world then does not come up, they are left as they are.
  const all = planWorkItems(derived, authored, recipeContract, {
    repoRoot: opts.repoRoot,
    ...(grounding ? { grounding } : {}),
    liveAvailable: opts.openLive !== undefined,
  })

  // THE STALE-PLACE RULE — a WORK-LIST rule, never a merge rule.
  // An authored screen the derivation no longer produces (in a repo whose
  // derived web half is non-empty) is an address nobody can stand at any more —
  // the measured case is a route module that now only redirects — and a session
  // spent on it is a session wasted, on every `replace` run, forever. It stays
  // in the merged catalog (a repo whose derivation never ran has no derived half
  // at all, and the
  // empty-derived-half escape hatch below rests on exactly that), but it earns
  // no session: excluded here, reported as a named diagnostic on the result.
  const diagnostics = staleAuthoredPlaceDiagnostics(derived, authored)
  const stale = new Set(diagnostics.map((diagnostic) => diagnostic.subject))

  const named = opts.places && opts.places.length > 0 ? new Set(opts.places) : undefined
  if (named) {
    const unknown = [...named].filter((id) => !all.some((item) => item.place.id === id))
    if (unknown.length > 0) {
      throw new Error(
        `no such place: ${unknown.join(', ')}. The interface catalog lists the places this repository has.`,
      )
    }
    const staleNamed = [...named].filter((id) => stale.has(id))
    if (staleNamed.length > 0) {
      throw new Error(
        `stale authored place: ${staleNamed.join(', ')} — authored as a screen, but no derivation produces it any more ` +
          `(the routing tree moved on, or the module only redirects). Authoring it would spend a session on an address ` +
          `nobody can stand at; remove it from guard/interfaces.authored.json if it is truly gone.`,
      )
    }
  }
  const skipped: string[] = []
  const selected = all.filter((item) => {
    if (stale.has(item.place.id)) return false
    // A component this run's grounding no longer finds shared has no module to
    // brief and no screen to observe it at: it keeps its tasks and earns no session.
    if (item.place.kind === 'component' && !components.has(item.place.id)) {
      skipped.push(item.place.id)
      return false
    }
    if (named) return named.has(item.place.id)
    // An explicit refresh re-opens what never settled, whatever its inputs say:
    // a screen whose provider died is exactly the screen nothing else retries.
    const retry = opts.refresh === true && item.record !== undefined && unsettledAuthoring(item.record)
    if (!item.needsAuthoring && !opts.replace && !retry) {
      skipped.push(item.place.id)
      return false
    }
    return true
  })
  const work = opts.limit != null ? selected.slice(0, opts.limit) : selected

  // What each screen is grounded on NOW, recorded on its ledger row and folded
  // into its cache key: a change to one of these files re-opens the screen.
  const sourcesOf = new Map(
    all.map((item) => [item.place.id, sourceDigests(opts.repoRoot, groundingFiles(opts.context?.get(item.place.id)))]),
  )
  /**
   * A ledger row, with the sources it settled over when the place is grounded.
   * A screen that SETTLED with no live look says so; one that never settled
   * waits for a refresh either way.
   */
  const ledgerRow = (item: AuthorWorkItem, status: PlaceResult['status'], sourceOnly: boolean): InterfaceAuthoringRecord => {
    const sources = sourcesOf.get(item.place.id)!
    return {
      status,
      inputFingerprint: item.inputFingerprint,
      ...(Object.keys(sources).length > 0 ? { sources } : {}),
      ...(sourceOnly && (status === 'authored' || status === 'empty') ? { sourceOnly: true as const } : {}),
    }
  }
  /** What each place's first look saw — filled once it has run. */
  let looks = new Map<string, ObserveScreenResult>()
  const cacheKey = (item: AuthorWorkItem, live: boolean): string =>
    fragmentCacheKey(item.inputFingerprint, sourcesOf.get(item.place.id)!, live)

  // Where a shared component is authored and observed: the first screen that
  // renders it at an address with no slot, else the first that renders it.
  const allPlaces = placeIndex(derived, authored)
  const representative = new Map<string, string>()
  for (const component of components.values()) {
    const addresses = component.screens.flatMap((id) => allPlaces.get(id)?.address ?? [])
    const address = addresses.find((candidate) => !hasAddressSlot(candidate)) ?? addresses[0]
    if (address !== undefined) representative.set(component.id, address)
  }
  /** The shared places a place renders, each with the tasks the catalog already has at it. */
  const sharedPlacesOf = (placeId: string, catalog: InterfacesFile | null): SharedPlaceBrief[] => {
    const merged = mergeInterfaceCatalogs(derived, catalog)
    return (opts.shared?.rendered.get(placeId) ?? []).flatMap((id) => {
      const component = components.get(id)
      return component ? [{ id, title: component.title, tasks: ownTasks(merged, id).map((task) => task.id) }] : []
    })
  }
  /** The place a session authors — its root, and the address it is authored at. */
  const scopeOf = (item: AuthorWorkItem): { screenId: string; address?: string } => {
    const address = item.place.address ?? representative.get(item.place.id)
    return { screenId: item.place.id, ...(address ? { address } : {}) }
  }

  // The screens this run re-opens, once the cache has served what it can: a
  // shared component authored before them may take over a task one of them
  // renders it with, and that screen's session retires or amends its copy.
  let reopening: readonly AuthorWorkItem[] = []
  /** The existing tasks a component's draft may twin: those of the re-opening screens that render it. */
  const yieldingTo = (item: AuthorWorkItem): ReadonlySet<string> =>
    new Set(
      item.place.kind === 'component'
        ? reopening
            .filter((screen) => opts.shared?.rendered.get(screen.place.id)?.includes(item.place.id))
            .flatMap((screen) => screen.existing)
        : [],
    )

  const results: PlaceResult[] = []
  const prepared = new Map<string, PreparedPlace['place']>()
  const spent = { turns: 0, tokens: 0, costUsd: 0 }
  let authoredCount = 0
  let labelRekeys = 0
  let path: string | undefined

  /** Lay rows over the ledger and keep the in-memory catalog in step. */
  const recordLedger = (rows: Readonly<Record<string, InterfaceAuthoringRecord>>, views?: Record<string, string>): void => {
    const written = recordAuthoringLedger({
      repoRoot: opts.repoRoot,
      authored,
      derived,
      rows,
      ...(views ? { views } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    })
    authored = written.file
    path = written.path
  }

  // THE LEDGER'S MIGRATION, judged once: a screen with no row that the old
  // inference calls done gets one for free, with the digest it stands at now.
  // From here on its settlement is recorded rather than re-inferred, and it
  // cost no session to say so.
  const migrated = Object.fromEntries(
    all
      .filter((item) => item.record === undefined && !item.needsAuthoring && !stale.has(item.place.id))
      .map((item) => [item.place.id, ledgerRow(item, 'authored', false)]),
  )
  if (Object.keys(migrated).length > 0) recordLedger(migrated)

  // A component the grounding no longer finds shared earns no session, so its
  // row is brought to where it stands — its inputs now, grounded on nothing —
  // or a module that moved under it would call it work on every later setup.
  const unshared = grounding
    ? all.filter((item) => item.place.kind === 'component' && !components.has(item.place.id) && item.record && item.needsAuthoring)
    : []
  if (unshared.length > 0) {
    recordLedger(Object.fromEntries(unshared.map((item) => [item.place.id, ledgerRow(item, item.record!.status, false)])))
  }

  // THE VIEWS this run's context pass read, what it found shared decided over
  // them: recorded, so a later setup knows to look again when one moves.
  if (opts.context && opts.context.size > 0) {
    const views = sourceDigests(opts.repoRoot, [...opts.context.values()].flatMap((place) => [place.module, ...place.renders, ...place.renderClosure]))
    if (JSON.stringify(views) !== JSON.stringify(authored?.authoringViews ?? {})) recordLedger({}, views)
  }

  /**
   * Fold one accepted fragment: validate it against the catalog as it stands,
   * write what it authored, and record the screen's row. Both paths into the
   * catalog run through here — the live session's outcome and the cached
   * fragment a hit serves — so a hit writes exactly what the session wrote.
   * `false` means the fragment was refused, which for a hit is a miss.
   */
  const foldFragment = (
    item: AuthorWorkItem,
    fragment: AuthoredFragment,
    briefedWith: InterfacesFile | null,
    carryUnaccounted: boolean,
  ): PreparedPlace => {
    const result = preparePlace({
      item,
      scope: scopeOf(item),
      fragment,
      derived,
      authored,
      briefedWith,
      carryUnaccounted,
      yielding: yieldingTo(item),
    })
    if (result.candidate) {
      const before = new Map((authored?.interfaces ?? []).map((task) => [task.id, task]))
      for (const task of result.candidate.interfaces) {
        const prior = before.get(task.id)
        // A key that MOVED, and moved for a rewording alone. A step whose
        // locator resolves to a declared readable is not re-keyed by its label
        // any more, and the stored fingerprints say so before the labels do.
        if (prior && prior.fingerprint !== task.fingerprint && isLabelOnlyRekey(prior, task)) labelRekeys++
      }
      const written = writeAuthoredCatalog({
        repoRoot: opts.repoRoot,
        candidate: result.candidate,
        derived,
        now: opts.now,
      })
      authored = written.file
      path = written.path
      authoredCount += result.place.taskIds.length
    }
    return result
  }

  // THE CACHE PROBE, before any session starts. A screen whose inputs have not
  // moved is served from the fragment its last session handed back, folded in
  // work-list order exactly as a peer that already landed would be — so the
  // sessions that DO run are briefed with it. An entry the catalog no longer
  // accepts (a peer took an id since) is a miss like any other.
  //
  // The live fragment is probed first. Only its misses stand the app up, and a
  // source-only fragment is read only when the app would not come up: that is
  // the fragment this run would have written itself.
  const serveCached = async (items: readonly AuthorWorkItem[], live: boolean): Promise<AuthorWorkItem[]> => {
    const misses: AuthorWorkItem[] = []
    for (const item of items) {
      const cached = reauthoring(opts)
        ? null
        : await readCachedSessionOutput({
            repoRoot: opts.repoRoot,
            cacheName: INTERFACE_AUTHOR_CACHE_NAME,
            key: cacheKey(item, live),
            schema: AuthoredFragmentSchema,
          })
      if (cached === null) {
        misses.push(item)
        continue
      }
      // A cached fragment was written against the catalog of its day: an
      // existing task it never mentions stands as it is.
      const result = foldFragment(item, cached, authored, true)
      if (result.place.status === 'rejected') {
        misses.push(item)
        continue
      }
      const place: PlaceResult = { ...result.place, spent: { turns: 0, tokens: 0, costUsd: 0 }, fromCache: true }
      results.push(place)
      recordLedger({ [item.place.id]: ledgerRow(item, place.status, !live) })
      opts.onProgress?.({ kind: 'place-done', place })
    }
    return misses
  }
  const liveMisses = opts.openLive ? await serveCached(work, true) : [...work]
  const live = liveMisses.length > 0 ? await opts.openLive?.() : undefined
  // A screen owed only a live look is left as it stands when none came up.
  const lookless = live ? [] : liveMisses.filter((item) => item.awaitsLiveLook)
  skipped.push(...lookless.map((item) => item.place.id))
  const pending = live ? liveMisses : await serveCached(liveMisses.filter((item) => !item.awaitsLiveLook), false)
  reopening = pending.filter((item) => item.place.kind !== 'component')

  // THE FIRST LOOK, before any session starts: every pending screen whose
  // address has no slot is opened once, as the default principal, so its tree
  // (or where that principal was sent instead) is in the briefing — the cached
  // prefix — rather than bought with a turn. Whom else to observe it as is the
  // session's call. A slotted address needs a value the session reads, so it
  // observes itself.
  looks = await firstLooks(pending, scopeOf, live, opts.signal)

  // THE PHASES: the shared components first, then the screens, so a screen's
  // briefing names the tasks its shared places already carry. Within a phase the
  // clusters run side by side.
  const runSessions = async (items: readonly AuthorWorkItem[]): Promise<void> => {
    if (items.length === 0) return
    // THE CLUSTERS: the places that read the same modules, grouped. They
    // become the pool's serial groups — one worker per cluster, members in order.
    const clusters = clusterPlaces({
      places: items.map((item) => item.place.id),
      context: opts.context ?? new Map(),
    })
    const clusterOf = new Map<string, PlaceCluster>()
    for (const cluster of clusters) {
      for (const placeId of cluster.places) clusterOf.set(placeId, cluster)
    }
    // THE HAND-OFF ORDER (step 2j): longest cluster first. The pool starts serial
    // groups in first-appearance order of the item list, so the ORDER of this
    // list IS the schedule — LPT here means the longest serial chain starts at
    // t=0 instead of last. The REPORT is unaffected: results are re-sorted to
    // the work-list order below, whatever order the sessions ran in.
    const itemOf = new Map(items.map((item) => [item.place.id, item]))
    const scheduled = orderClustersLongestFirst(clusters).flatMap((cluster) =>
      cluster.places.map((placeId) => itemOf.get(placeId)!),
    )
    // The pack, read ONCE per cluster at its first member: every member opens with
    // the same bytes, which is what makes it a shared prefix rather than a
    // per-session copy of the same files. Members run serially, so "first member"
    // is well-defined and the read happens when the cluster starts, not before.
    const packs = new Map<string, { pack?: ClusterPack; prefix?: SharedPromptPrefix }>()
    const packOf = (placeId: string) => {
      const cluster = clusterOf.get(placeId)!
      if (!packs.has(cluster.id)) {
        const pack = clusterPack(opts.repoRoot, cluster)
        packs.set(cluster.id, pack ? { pack, prefix: { messages: [pack.text], cacheKey: cluster.id } } : {})
      }
      return packs.get(cluster.id)!
    }

    // Per-session captures, keyed by place: the catalog each session was BRIEFED
    // with (taken when its def is built — the pool builds def and briefing in one
    // tick). Outcome validation reads the live catalog —
    // between the two lies everything its peers landed while it was thinking. For
    // a peer of the same cluster there is nothing there: it already folded.
    const briefed = new Map<string, InterfacesFile | null>()
    const placeOf = new Map(items.map((item) => [placeWorkItem(item.place.id), item.place.id]))

    await runSessionPool<AuthorWorkItem, AuthoredFragment>({
      items: scheduled,
      workItem: (item) => placeWorkItem(item.place.id),
      serialKey: (item) => clusterOf.get(item.place.id)!.id,
      sharedPrefix: (item) => packOf(item.place.id).prefix,
      session: (item) => {
        // A session may amend or retire THIS place's own tasks and nothing else:
        // every other authored entry is somebody else's work.
        const replaceable = new Set(item.existing)
        briefed.set(item.place.id, authored)
        return {
          ...interfaceAuthorSessionDef({
            repoRoot: opts.repoRoot,
            derived,
            // Tools must see peers' accepted work, even on a resumed session.
            get authored() { return authored },
            replaceable,
            scope: scopeOf(item),
            yielding: yieldingTo(item),
            ...(live ? { live } : {}),
          }),
          validateOutcome(fragment) {
            // Validate and write synchronously before the loop marks the session
            // completed. No peer can change the catalog between these operations.
            const result = foldFragment(item, fragment, briefed.get(item.place.id) ?? null, false)
            prepared.set(item.place.id, result.place)
            if (result.place.status === 'rejected') {
              return `The catalog cannot accept this outcome. Correct these problems, run check_draft on the corrected pieces, and return the draftId of the check that accepted them:\n- ${result.place.problems.join('\n- ')}`
            }
          },
        }
      },
      briefing: (item) => {
        // The catalog as it stood when this session started: every place already
        // folded, and none of the peers still running beside it.
        const briefedWith = briefed.get(item.place.id) ?? null
        const places = placeIndex(derived, briefedWith)
        const component = components.get(item.place.id)
        const address = scopeOf(item).address
        return [
          placeBriefing({
            place: item.place,
            existing: item.existing,
            ...(component
              ? { component: { module: component.module, screens: component.screens, ...(address ? { address } : {}) } }
              : {}),
            sharedPlaces: sharedPlacesOf(item.place.id, briefedWith),
            ownTaskContext: ownTaskContext({ derived, authored: briefedWith, screenId: item.place.id }),
            sourcePack: placeSourcePack(opts.repoRoot, opts.context?.get(item.place.id), packOf(item.place.id).pack?.modules)?.text,
            states: registryStates(derived, briefedWith),
            screens: screenTable(places),
            nested: placesOn(item.place.id, places),
            ...(opts.context?.get(item.place.id)
              ? { context: opts.context.get(item.place.id)! }
              : {}),
            ...(live
              ? {
                  live: {
                    screens: live,
                    ...(looks.get(item.place.id) ? { observation: looks.get(item.place.id)! } : {}),
                  },
                }
              : {}),
          }),
        ]
      },
      driver: opts.driver,
      persistence: opts.persistence,
      ...(opts.concurrency !== undefined ? { concurrency: opts.concurrency } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.mintSessionId ? { mintSessionId: opts.mintSessionId } : {}),
      ...(opts.now ? { now: opts.now } : {}),
      onProgress: (event) => {
        if (event.kind !== 'item-start') return
        opts.onProgress?.({
          kind: 'place-start',
          placeId: placeOf.get(event.workItem)!,
          index: event.index,
          total: event.total,
        })
      },
      onSessionEvent: (workItem, event) => opts.onSessionEvent?.(placeOf.get(workItem)!, event),
      // Persistence happens in validateOutcome; the fold records final spend
      // and failures after any corrections have finished.
      fold: async (item, outcome, sessionId) => {
        const last = prepared.get(item.place.id)
        const place: PlaceResult = outcome.status === 'completed'
          ? { ...last!, sessionId, spent: outcome.spent }
          : {
              placeId: item.place.id, sessionId, spent: outcome.spent,
              status: 'failed', taskIds: [],
              unresolved: last?.unresolved ?? [],
              findings: last?.findings ?? [],
              problems: [...(last?.problems ?? []), describeFailure(outcome.failure)],
              resumable: outcome.resumable,
            }
        results.push(place)
        // The ledger row, whatever the verdict: a screen that failed is a screen
        // this run REACHED, and recording that is what stops the next run paying
        // for the same failure. The digest is the one the work list planned over.
        recordLedger({ [item.place.id]: ledgerRow(item, place.status, live === undefined) })
        // The fragment an accepted outcome produced, under this screen's digest:
        // the next run over the same inputs folds it instead of buying it again.
        if (outcome.status === 'completed' && (place.status === 'authored' || place.status === 'empty')) {
          await storeCachedSessionOutput(
            {
              repoRoot: opts.repoRoot,
              cacheName: INTERFACE_AUTHOR_CACHE_NAME,
              key: cacheKey(item, live !== undefined),
            },
            outcome.output,
          )
        }
        spent.turns += place.spent.turns
        spent.tokens += place.spent.tokens
        spent.costUsd += place.spent.costUsd
        opts.onProgress?.({ kind: 'place-done', place })
      },
    })
  }
  await runSessions(pending.filter((item) => item.place.kind === 'component'))
  await runSessions(pending.filter((item) => item.place.kind !== 'component'))

  // A shared component may have taken over a task of a screen re-opened in
  // this run, on the promise that the screen's session retires its copy. A
  // screen whose session did not settle never did: its copy goes now, since
  // the component's twin IS that task, and one invocable thing is one entry.
  const settled = new Set(results.filter((place) => place.status === 'authored' || place.status === 'empty').map((place) => place.placeId))
  const takenOver = new Set(
    results.filter((place) => components.has(place.placeId)).flatMap((place) => place.taskIds),
  )
  const placesNow = placeIndex(derived, authored)
  const takenKeys = new Set((authored?.interfaces ?? []).filter((task) => takenOver.has(task.id)).map((task) => task.fingerprint))
  const orphaned = new Set(
    reopening
      .filter((screen) => !settled.has(screen.place.id))
      .flatMap((screen) => screen.existing)
      .filter((id) => {
        const task = authored?.interfaces.find((candidate) => candidate.id === id)
        if (!task || task.type !== AUTHORED_SURFACE) return false
        const place = task.at ? placesNow.get(task.at) : undefined
        return takenKeys.has(task.fingerprint) || takenKeys.has(resolvedInterfaceFingerprint(task, place))
      }),
  )
  if (authored && orphaned.size > 0) {
    const written = writeAuthoredCatalog({
      repoRoot: opts.repoRoot,
      candidate: { ...authored, interfaces: authored.interfaces.filter((task) => !orphaned.has(task.id)) },
      derived,
      now: opts.now,
    })
    authored = written.file
    path = written.path
  }

  // Completion order is provider latency; the report is the work list.
  const order = new Map(work.map((item, index) => [item.place.id, index]))
  results.sort((a, b) => (order.get(a.placeId) ?? 0) - (order.get(b.placeId) ?? 0))
  const findings = results.flatMap((place) =>
    place.findings.map((note) => ({ placeId: place.placeId, note })),
  )

  return {
    places: results,
    authored: authoredCount,
    labelRekeys,
    ...(path ? { path } : {}),
    skipped,
    findings,
    diagnostics,
    spent,
  }
}

/** How many places the first look opens at once. */
const OBSERVE_CONCURRENCY = 4

/**
 * Take every pending place's first look, a few places at a time: a place whose
 * address carries no slot is OBSERVED as the default principal, and what it saw
 * rides the briefing — where it was sent when it was sent away, a refusal too,
 * so the briefing says why instead of saying nothing.
 */
async function firstLooks(
  items: readonly AuthorWorkItem[],
  scopeOf: (item: AuthorWorkItem) => { address?: string },
  live: LiveScreens | undefined,
  signal?: AbortSignal,
): Promise<Map<string, ObserveScreenResult>> {
  const looks = new Map<string, ObserveScreenResult>()
  if (!live) return looks
  const queue = items.flatMap((item) => {
    const address = scopeOf(item).address
    return address && !hasAddressSlot(address) ? [{ item, address }] : []
  })
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < queue.length && !signal?.aborted) {
      const { item, address } = queue[next++]!
      looks.set(item.place.id, await live.observer.observe({ path: address }))
    }
  }
  await Promise.all(Array.from({ length: Math.min(OBSERVE_CONCURRENCY, queue.length) }, worker))
  return looks
}

/**
 * How many clusters run at once by default — the pool's own default, re-exported
 * under this module's name. See {@link defaultPoolConcurrency} for
 * why it is small and which knob (`TRUECOURSE_MAX_CONCURRENCY`) moves it.
 */
export { defaultPoolConcurrency as defaultAuthorConcurrency }

interface PrepareInput {
  item: AuthorWorkItem
  /** The place the session authored, and the address it authored it at. */
  scope: { screenId: string; address?: string }
  fragment: AuthoredFragment
  derived: InterfacesFile | null
  /** The catalog as it stands NOW — what the fragment is validated against. */
  authored: InterfacesFile | null
  /** The catalog the session was briefed with; the difference is its peers' work. */
  briefedWith: InterfacesFile | null
  /** Keep an existing task the fragment never mentions instead of refusing it (a cached fragment). */
  carryUnaccounted: boolean
  /** Other places' tasks the fragment may twin, their screens reconciling later in the run. */
  yielding: ReadonlySet<string>
}

interface PreparedPlace {
  place: Omit<PlaceResult, 'sessionId' | 'spent'>
  candidate?: InterfacesFile
}

/**
 * Validate the proposed output against all work accepted so far. The screen's
 * existing tasks are the ones it may amend or retire, and the ones it has to
 * account for.
 */
function preparePlace(input: PrepareInput): PreparedPlace {
  const { item, derived, authored, briefedWith } = input
  const base = { placeId: item.place.id }
  const prior = new Set(item.existing)

  const unresolved = [...(input.fragment.unresolved ?? [])]
  const findings = [...(input.fragment.findings ?? [])]
  const { fragment, raced } = pruneRacedTasks(
    input.fragment,
    briefedWith,
    authored,
    prior,
    draftPlaceIndex(derived, authored, input.fragment.resources ?? []),
  )
  const racedField = raced.length > 0 ? { raced } : {}
  if (prior.size === 0 && fragment.interfaces.length === 0 && (fragment.resources?.length ?? 0) === 0) {
    // Either the session honestly found nothing, or everything it found was
    // authored by a peer first. Both are empty, and `raced` says which.
    return {
      place: { ...base, status: 'empty', taskIds: [], unresolved, findings, problems: [], ...racedField },
    }
  }

  const validation = validateFragment({
    derived,
    authored,
    fragment,
    replaceable: prior,
    carryUnaccounted: input.carryUnaccounted,
    scope: input.scope,
    yielding: input.yielding,
  })
  if (!validation.ok) {
    // The loop returns these errors to the session before accepting its output.
    return {
      place: {
        ...base,
        status: 'rejected',
        taskIds: [],
        unresolved,
        findings,
        problems: validation.errors,
        ...racedField,
      },
    }
  }
  const retired = (fragment.retired ?? []).filter((entry) => prior.has(entry.id))
  return {
    place: {
      ...base,
      status: 'authored',
      taskIds: fragment.interfaces.map((task) => task.id),
      unresolved,
      findings,
      problems: [],
      ...racedField,
      ...(retired.length > 0 ? { retired } : {}),
    },
    candidate: validation.authored,
  }
}

/**
 * Drop the tasks a session in flight beside this one claimed first.
 *
 * A collision with an entry that was ALREADY there when this session was briefed
 * is an authoring error — the session was shown that entry and authored over it
 * anyway, and `validateFragment` refuses the fragment for it. A collision with
 * an entry that appeared WHILE the session ran is a race: nothing told it, and
 * refusing the whole fragment would throw away a screen's work over one id two
 * settings pages both wanted to call `web/create-webhook`. So exactly the raced
 * tasks come out, and the rest of the place lands.
 *
 * Both identities are checked, because both are refusals: the `id` (one id names
 * one thing) and the FINGERPRINT (one entry + steps is one task, whatever it is
 * called).
 */
export function pruneRacedTasks(
  fragment: AuthoredFragment,
  briefedWith: InterfacesFile | null,
  authored: InterfacesFile | null,
  replaceable: ReadonlySet<string>,
  /** The places the draft stands on, so both sides of the fingerprint
   *  comparison are computed the way the write path computes one. */
  places?: ReadonlyMap<string, InterfaceResource>,
): { fragment: AuthoredFragment; raced: string[] } {
  const before = new Set((briefedWith?.interfaces ?? []).map((iface) => iface.id))
  const landedIds = new Set<string>()
  const landedFingerprints = new Set<string>()
  for (const iface of authored?.interfaces ?? []) {
    if (before.has(iface.id) || replaceable.has(iface.id)) continue
    landedIds.add(iface.id)
    landedFingerprints.add(iface.fingerprint)
  }
  if (landedIds.size === 0) return { fragment, raced: [] }

  const raced: string[] = []
  const kept = stampFragment(fragment, places).interfaces.filter((task) => {
    if (!landedIds.has(task.id) && !landedFingerprints.has(task.fingerprint)) return true
    raced.push(task.id)
    return false
  })
  if (raced.length === 0) return { fragment, raced: [] }
  const byId = new Map(fragment.interfaces.map((task) => [task.id, task]))
  return {
    fragment: { ...fragment, interfaces: kept.map((task) => byId.get(task.id)!) },
    raced,
  }
}

/**
 * The screens the briefing states: id and address, catalog order. It
 * is the whole screen list rather than this place's neighbourhood, because `to`
 * may name any of them — a task that navigates away leaves the user anywhere.
 */
function screenTable(
  places: ReadonlyMap<string, InterfaceResource>,
): { id: string; address?: string }[] {
  return [...places.values()]
    .filter((place) => place.kind === 'screen')
    .map((place) => ({ id: place.id, ...(place.address ? { address: place.address } : {}) }))
}

/** The dialogs and panels that sit on one root place, however deeply nested. */
function placesOn(
  rootId: string,
  places: ReadonlyMap<string, InterfaceResource>,
): InterfaceResource[] {
  return [...places.values()].filter((place) => !isRootPlace(place) && rootPlaceOf(place.id, places)?.id === rootId)
}

function describeFailure(failure: { kind: string } & Record<string, unknown>): string {
  switch (failure.kind) {
    case 'budget-exhausted':
      return `the session ran out of turns without reaching ${String(failure.notReached)}`
    case 'context-exhausted':
      return 'the session hit its context ceiling'
    case 'malformed':
      return `the session ended malformed: ${String(failure.detail)}`
    case 'transport':
      return `the provider failed (${String(failure.class)}): ${String(failure.detail)}`
    case 'session-lost':
      return `the provider session ${String(failure.providerSessionId)} is gone`
    default:
      return failure.kind
  }
}



