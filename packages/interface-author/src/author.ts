/**
 * THE RUN — authoring sessions over places, folded into the authored catalog.
 *
 * This is the agentic pipeline's shape at the command level (§3.9): a run over
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
 * THE POOL, and the one thing it costs. Sessions are network-bound: a place is
 * ~20 turns of provider latency and almost no local work, so running them one at
 * a time makes the wall clock the sum of a hundred round-trip stacks. They run
 * `concurrency` at a time instead — but the FOLD stays strictly serial, because
 * a fragment is validated against the catalog it is about to join and then
 * written to it, and two of those interleaved would each validate against a
 * catalog the other is in the middle of changing.
 *
 * WHAT THE POOL CONSUMES IS CLUSTERS, NOT PLACES (item 4). A cluster is the
 * places whose sessions read the same modules ({@link clusterPlaces}), and its
 * members run SERIALLY: each one is briefed with its peers' work already folded
 * in. That is where the agreement actually matters — every duplicate-id
 * collision the pilot produced was between two places of one cluster, two
 * sessions naming one settings dialog twice because neither could see the other.
 * Running a cluster serially costs nothing in wall clock (the clusters run in
 * parallel with each other, and there are as many of them as the pool has
 * workers) and buys back the collisions that were worth having.
 *
 * What concurrency still costs is BRIEFING FRESHNESS ACROSS clusters. A session
 * is briefed with the catalog as it stands when the session starts, so the peers
 * in flight in OTHER clusters are invisible to it: they cannot be in its state
 * registry, and their tasks cannot be in its `list_interfaces`. Two consequences,
 * and both are handled rather than hoped away — a state named twice under two
 * ids is what the closing reconciliation (item 3) settles; and a task id or
 * fingerprint claimed by a peer mid-flight is a RACE, not an authoring error, so
 * the fold drops that one task and keeps the rest ({@link pruneRacedTasks})
 * instead of refusing the fragment whole.
 *
 * A cluster of more than one also opens every member's session with the same
 * PACK — the shared modules' contents, read once ({@link clusterPack}) — under
 * one cache key, so the modules are in context before the first turn and the
 * prefix is bytes a provider's prompt cache can reuse between members.
 *
 * The driver and the persistence are INJECTED. This package knows nothing about
 * which backend runs the session or where the transcript lands; `@truecourse/core`
 * picks both (the configured transport, the run's sessions store).
 */

import os from 'node:os'
import pLimit from 'p-limit'
import {
  runAgentLoop,
  type SessionDriver,
  type SessionEvent,
  type SessionPersistence,
  type SharedPromptPrefix,
} from '@truecourse/agent-loop'
import { readAuthoredInterfaceCatalog, readInterfaceCatalog } from '@truecourse/guard-runner'
import type { WebPlaceContext } from '@truecourse/interface-mapper'
import type { InterfaceResource, InterfacesFile } from '@truecourse/shared'
import {
  AUTHORED_SURFACE,
  candidateAuthored,
  registryStates,
  stampFragment,
  validateFragment,
  type AuthoredFragment,
} from './draft.js'
import { clusterPlaces } from './cluster.js'
import { clusterPack } from './pack.js'
import { interfaceAuthorSessionDef, placeBriefing, placeWorkItem } from './session.js'
import { writeAuthoredCatalog } from './write.js'

export interface AuthorRunOptions {
  repoRoot: string
  driver: SessionDriver
  persistence: SessionPersistence
  /** Author only these place ids; default = every screen with no authored task yet. */
  places?: readonly string[]
  /** Re-author places that already carry authored tasks (their tasks may be replaced). */
  replace?: boolean
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
   * What the AST pass knows about each place (item 105): its route module, the
   * modules it renders, the api effects its requests join to. Derived per run by
   * the caller — this package reads analyzer artifacts, it never produces them.
   * A place with no entry is briefed exactly as it was before the pack existed.
   */
  context?: ReadonlyMap<string, WebPlaceContext>
  signal?: AbortSignal
  onProgress?: (event: AuthorProgress) => void
  /** Every transcript event, as it is persisted — the CLI's live line. */
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
  sessionId: string
  /** `authored` = tasks landed; `empty` = the session honestly found none;
   *  `rejected` = the outcome broke a rule the write path enforces;
   *  `failed` = the session itself did not reach an outcome. */
  status: 'authored' | 'empty' | 'rejected' | 'failed'
  taskIds: string[]
  unresolved: string[]
  /** Why it was rejected (validation) or how it failed (the session failure). */
  problems: string[]
  /**
   * Tasks a session in flight beside this one authored first — dropped from this
   * fragment so the rest could land. Empty on a serial run, and never a problem:
   * the task exists, it is just somebody else's entry now.
   */
  raced?: string[]
  spent: { turns: number; tokens: number; costUsd: number }
  /** Whether a resume grant could continue a failed session (§3.3). */
  resumable?: boolean
}

export interface AuthorRunResult {
  places: PlaceResult[]
  /** Tasks written across the run. */
  authored: number
  /** The authored catalog path, when anything was written. */
  path?: string
  /** Places that were skipped because they already carry authored tasks. */
  skipped: string[]
  spent: { turns: number; tokens: number; costUsd: number }
}

/** A place the run can author against, with the tasks already located there. */
export interface AuthorWorkItem {
  place: InterfaceResource
  /** Ids of the authored tasks whose location resolves to this place. */
  existing: string[]
}

/**
 * The work list: every SCREEN the catalog knows, in catalog order, each with the
 * authored tasks already located on it (directly, or through a dialog/panel that
 * sits on it). A screen is the unit because it is what a derivation produces and
 * what an address names — the places nested on it are authored as part of it.
 */
export function planWorkItems(
  derived: InterfacesFile | null,
  authored: InterfacesFile | null,
): AuthorWorkItem[] {
  const places = placeIndex(derived, authored)
  const screens = [...places.values()].filter((place) => place.kind === 'screen')

  const located = new Map<string, string[]>()
  for (const task of authored?.interfaces ?? []) {
    if (task.type !== AUTHORED_SURFACE) continue
    const screen = task.at ? screenOf(task.at, places) : screenAt(routeOf(task), screens)
    if (!screen) continue
    located.set(screen, [...(located.get(screen) ?? []), task.id])
  }
  return screens.map((place) => ({ place, existing: located.get(place.id) ?? [] }))
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

  const all = planWorkItems(derived, authored)
  const named = opts.places && opts.places.length > 0 ? new Set(opts.places) : undefined
  if (named) {
    const unknown = [...named].filter((id) => !all.some((item) => item.place.id === id))
    if (unknown.length > 0) {
      throw new Error(
        `no such place: ${unknown.join(', ')}. \`truecourse guard interfaces\` lists the places this repository has.`,
      )
    }
  }
  const skipped: string[] = []
  const selected = all.filter((item) => {
    if (named) return named.has(item.place.id)
    if (item.existing.length > 0 && !opts.replace) {
      skipped.push(item.place.id)
      return false
    }
    return true
  })
  const work = opts.limit != null ? selected.slice(0, opts.limit) : selected

  const results: PlaceResult[] = []
  const spent = { turns: 0, tokens: 0, costUsd: 0 }
  let authoredCount = 0
  let path: string | undefined

  // THE CLUSTERS (item 8): the places that read the same modules, grouped. The
  // pool consumes these — one worker per cluster, its members in order.
  const clusters = clusterPlaces({
    places: work.map((item) => item.place.id),
    context: opts.context ?? new Map(),
  })
  const itemOf = new Map(work.map((item) => [item.place.id, item]))
  const positionOf = new Map(work.map((item, index) => [item.place.id, index]))

  const runCluster = pLimit(Math.max(1, opts.concurrency ?? defaultAuthorConcurrency()))
  const fold = serially()

  await Promise.all(
    clusters.map((cluster) =>
      runCluster(async () => {
        // Read ONCE, before the cluster's first session: every member opens with
        // the same bytes, which is what makes it a shared prefix rather than a
        // per-session copy of the same files.
        const pack = clusterPack(opts.repoRoot, cluster)
        const sharedPrefix: SharedPromptPrefix | undefined = pack
          ? { messages: [pack.text], cacheKey: cluster.id }
          : undefined

        for (const placeId of cluster.places) {
          // A run the caller aborted starts nothing else. The sessions already in
          // flight get the signal and end themselves.
          if (opts.signal?.aborted) return
          const item = itemOf.get(placeId)!
          opts.onProgress?.({
            kind: 'place-start',
            placeId,
            index: positionOf.get(placeId) ?? 0,
            total: work.length,
          })
          // A named/`--replace` re-author may replace THIS place's own tasks and
          // nothing else: every other authored entry is somebody else's work.
          const replaceable = new Set(named || opts.replace ? item.existing : [])
          // The catalog this session is BRIEFED with, captured before it starts.
          // The fold below re-reads the live one — between the two lies everything
          // its peers landed while it was thinking. For a peer of this cluster
          // there is nothing there: it already folded.
          const briefedWith = authored
          const outcome = await runPlaceSession({
            ...opts,
            derived,
            authored: briefedWith,
            item,
            replaceable,
            ...(sharedPrefix ? { sharedPrefix } : {}),
          })

          // THE FOLD, one place at a time however many sessions are running: the
          // fragment is validated against the catalog it is about to join, and
          // that catalog cannot be moving while it is checked.
          await fold(() => {
            const result = foldOnePlace({
              outcome,
              item,
              derived,
              authored,
              briefedWith,
              replaceable,
            })
            results.push(result.place)
            spent.turns += result.place.spent.turns
            spent.tokens += result.place.spent.tokens
            spent.costUsd += result.place.spent.costUsd

            if (result.candidate) {
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
            opts.onProgress?.({ kind: 'place-done', place: result.place })
          })
        }
      }),
    ),
  )

  // Completion order is provider latency; the report is the work list.
  const order = new Map(work.map((item, index) => [item.place.id, index]))
  results.sort((a, b) => (order.get(a.placeId) ?? 0) - (order.get(b.placeId) ?? 0))

  return { places: results, authored: authoredCount, ...(path ? { path } : {}), skipped, spent }
}

/**
 * How many clusters run at once by default. Small on purpose: the limit here is
 * not the machine, it is that a session cannot see the work of a peer in another
 * cluster (see the module note), so every extra worker buys wall clock and costs
 * a little cross-place agreement. Shares `TRUECOURSE_MAX_CONCURRENCY` with the
 * generator's own limit — one knob for "how much parallel LLM work at once".
 */
export function defaultAuthorConcurrency(): number {
  const declared = process.env.TRUECOURSE_MAX_CONCURRENCY
  if (declared) {
    const n = Number.parseInt(declared, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return Math.min(os.cpus().length, 4)
}

/**
 * A one-at-a-time gate: each call runs after the previous one has settled,
 * whatever order the callers arrive in. The critical section is validate → write
 * → adopt, which is synchronous but re-entrant through the promise queue if it
 * were not gated.
 */
function serially(): <T>(task: () => T) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => T): Promise<T> => {
    const result = tail.then(task)
    tail = result.catch(() => undefined)
    return result
  }
}

interface OnePlaceInput extends AuthorRunOptions {
  derived: InterfacesFile | null
  authored: InterfacesFile | null
  item: AuthorWorkItem
  replaceable: Set<string>
  /** The cluster pack, when this place belongs to a cluster of more than one. */
  sharedPrefix?: SharedPromptPrefix
}

/** What one session produced — the loop's own outcome, plus who produced it. */
type PlaceSession = {
  sessionId: string
  outcome: Awaited<ReturnType<typeof runAgentLoop<AuthoredFragment>>['outcome']>
}

/**
 * THE SESSION — the part that runs concurrently. It reads the repository and
 * hands back a fragment; nothing here touches the catalog, which is why several
 * of these can be in flight at once.
 */
async function runPlaceSession(input: OnePlaceInput): Promise<PlaceSession> {
  const { item, derived, authored, replaceable } = input
  const sessionId = (input.mintSessionId ?? (() => globalThis.crypto.randomUUID()))()
  const scope = scopeOf(item)
  const def = interfaceAuthorSessionDef({
    repoRoot: input.repoRoot,
    derived,
    authored,
    replaceable,
    scope,
  })

  const places = placeIndex(derived, authored)
  const outcome = await runAgentLoop<AuthoredFragment>({
    def,
    workItem: placeWorkItem(item.place.id),
    initialMessages: [
      placeBriefing({
        place: item.place,
        existing: item.existing,
        // The catalog as it stood when this session started: every place already
        // folded, and none of the peers still running beside it.
        states: registryStates(derived, authored),
        screens: screenTable(places),
        nested: placesOn(item.place.id, places),
        ...(input.context?.get(item.place.id) ? { context: input.context.get(item.place.id)! } : {}),
      }),
    ],
    ...(input.sharedPrefix ? { sharedPrefix: input.sharedPrefix } : {}),
    driver: input.driver,
    persistence: tee(input.persistence, (event) => input.onSessionEvent?.(item.place.id, event)),
    sessionId,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.mintSessionId ? { mintSessionId: input.mintSessionId } : {}),
    ...(input.now ? { now: input.now } : {}),
  }).outcome

  return { sessionId, outcome }
}

interface FoldInput {
  session: PlaceSession
  item: AuthorWorkItem
  derived: InterfacesFile | null
  /** The catalog as it stands NOW — what the fragment is validated against. */
  authored: InterfacesFile | null
  /** The catalog the session was briefed with; the difference is its peers' work. */
  briefedWith: InterfacesFile | null
  replaceable: Set<string>
}

/**
 * THE FOLD — the part that runs one at a time. It reads the catalog as it now
 * stands, not as the session was briefed, because the answer to "is this id
 * taken" changed while the session was thinking.
 */
function foldOnePlace(
  input: Omit<FoldInput, 'session'> & { outcome: PlaceSession },
): { place: PlaceResult; candidate?: InterfacesFile } {
  const { item, derived, authored, briefedWith, replaceable } = input
  const { sessionId, outcome } = input.outcome
  const base = { placeId: item.place.id, sessionId, spent: outcome.spent }

  if (outcome.status === 'failed') {
    return {
      place: {
        ...base,
        status: 'failed',
        taskIds: [],
        unresolved: [],
        problems: [describeFailure(outcome.failure)],
        resumable: outcome.resumable,
      },
    }
  }

  const unresolved = [...(outcome.output.unresolved ?? [])]
  const { fragment, raced } = pruneRacedTasks(outcome.output, briefedWith, authored, replaceable)
  const racedField = raced.length > 0 ? { raced } : {}
  if (fragment.interfaces.length === 0) {
    // Either the session honestly found nothing, or everything it found was
    // authored by a peer first. Both are empty, and `raced` says which.
    return { place: { ...base, status: 'empty', taskIds: [], unresolved, problems: [], ...racedField } }
  }

  const validation = validateFragment({
    derived,
    authored,
    fragment,
    replaceable,
    scope: scopeOf(item),
  })
  if (!validation.ok) {
    // The session had `check_draft` and either never called it or ignored it.
    // The fragment is dropped whole: half a place's tasks is not a place.
    return {
      place: { ...base, status: 'rejected', taskIds: [], unresolved, problems: validation.errors, ...racedField },
    }
  }
  return {
    place: {
      ...base,
      status: 'authored',
      taskIds: fragment.interfaces.map((task) => task.id),
      unresolved,
      problems: [],
      ...racedField,
    },
    candidate: validation.authored ?? candidateAuthored(authored, stampFragment(fragment), replaceable),
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
  const kept = stampFragment(fragment).interfaces.filter((task) => {
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
 * The screens the briefing states (item 9): id and address, catalog order. It
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

/** The dialogs and panels that sit on one screen, however deeply nested. */
function placesOn(
  screenId: string,
  places: ReadonlyMap<string, InterfaceResource>,
): { id: string; kind: string; title: string }[] {
  return [...places.values()]
    .filter((place) => place.kind !== 'screen' && screenOf(place.id, places) === screenId)
    .map((place) => ({ id: place.id, kind: place.kind, title: place.title }))
}

/** The place a session authors — its screen, and the address it sits at. */
function scopeOf(item: AuthorWorkItem): { screenId: string; address?: string } {
  return {
    screenId: item.place.id,
    ...(item.place.address ? { address: item.place.address } : {}),
  }
}

/** Wrap persistence so the caller sees every event the transcript records. */
function tee(persistence: SessionPersistence, observe: (event: SessionEvent) => void): SessionPersistence {
  return {
    appendEvent(sessionId, event) {
      persistence.appendEvent(sessionId, event)
      observe(event)
    },
    updateIndex: (entry) => persistence.updateIndex(entry),
    readEvents: (sessionId) => persistence.readEvents(sessionId),
  }
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

/** The screen a place sits on, walking `of` up; a screen resolves to itself. */
function screenOf(id: string, places: ReadonlyMap<string, InterfaceResource>): string | undefined {
  const seen = new Set<string>()
  let current: string | undefined = id
  while (current && !seen.has(current)) {
    seen.add(current)
    const place: InterfaceResource | undefined = places.get(current)
    if (!place) return undefined
    if (place.kind === 'screen') return place.id
    current = place.of
  }
  return undefined
}

/** The route a task starts at — its first navigate step, else its entry. */
function routeOf(task: { steps: readonly { kind: string }[]; entry: unknown }): string | undefined {
  const first = task.steps[0] as { kind: string; route?: string } | undefined
  if (first?.kind === 'navigate') return first.route
  const entry = task.entry as { path?: string }
  return entry.path
}

function screenAt(address: string | undefined, screens: readonly InterfaceResource[]): string | undefined {
  if (!address) return undefined
  return screens.find((screen) => screen.address === address)?.id
}
