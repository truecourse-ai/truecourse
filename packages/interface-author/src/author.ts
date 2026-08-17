/**
 * THE RUN — one authoring session per place, folded into the authored catalog.
 *
 * This is the agentic pipeline's shape at the command level (§3.9): a run over
 * work items, each item one session through `runAgentLoop`, each session's
 * outcome validated and persisted before the next one starts. Three properties
 * follow from folding after every place rather than at the end:
 *
 * - a later session SEES the earlier ones — its `list_interfaces` and its
 *   uniqueness checks run against the catalog as it now stands, so two places
 *   cannot author the same task twice;
 * - an interrupted run keeps what it finished, because each place's write is
 *   atomic and complete;
 * - a session that fails costs exactly its own place. Failures are DATA here,
 *   the way `runAgentLoop` hands them back — the run reports them and continues.
 *
 * The driver and the persistence are INJECTED. This package knows nothing about
 * which backend runs the session or where the transcript lands; `@truecourse/core`
 * picks both (the configured transport, the run's sessions store).
 */

import {
  runAgentLoop,
  type SessionDriver,
  type SessionEvent,
  type SessionPersistence,
} from '@truecourse/agent-loop'
import { readAuthoredInterfaceCatalog, readInterfaceCatalog } from '@truecourse/guard-runner'
import type { InterfaceResource, InterfacesFile } from '@truecourse/shared'
import {
  AUTHORED_SURFACE,
  candidateAuthored,
  stampFragment,
  validateFragment,
  type AuthoredFragment,
} from './draft.js'
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
  const places = new Map<string, InterfaceResource>()
  for (const place of [
    ...(derived?.resources?.[AUTHORED_SURFACE] ?? []),
    ...(authored?.resources?.[AUTHORED_SURFACE] ?? []),
  ]) {
    places.set(place.id, place)
  }
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

  for (const [index, item] of work.entries()) {
    opts.onProgress?.({ kind: 'place-start', placeId: item.place.id, index, total: work.length })
    // A named/`--replace` re-author may replace THIS place's own tasks and
    // nothing else: every other authored entry is somebody else's work.
    const replaceable = new Set(named || opts.replace ? item.existing : [])
    const result = await authorOnePlace({ ...opts, derived, authored, item, replaceable })
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
  }

  return { places: results, authored: authoredCount, ...(path ? { path } : {}), skipped, spent }
}

interface OnePlaceInput extends AuthorRunOptions {
  derived: InterfacesFile | null
  authored: InterfacesFile | null
  item: AuthorWorkItem
  replaceable: Set<string>
}

async function authorOnePlace(
  input: OnePlaceInput,
): Promise<{ place: PlaceResult; candidate?: InterfacesFile }> {
  const { item, derived, authored, replaceable } = input
  const sessionId = (input.mintSessionId ?? (() => globalThis.crypto.randomUUID()))()
  const scope = {
    screenId: item.place.id,
    ...(item.place.address ? { address: item.place.address } : {}),
  }
  const def = interfaceAuthorSessionDef({
    repoRoot: input.repoRoot,
    derived,
    authored,
    replaceable,
    scope,
  })

  const outcome = await runAgentLoop<AuthoredFragment>({
    def,
    workItem: placeWorkItem(item.place.id),
    initialMessages: [placeBriefing(item.place, item.existing)],
    driver: input.driver,
    persistence: tee(input.persistence, (event) => input.onSessionEvent?.(item.place.id, event)),
    sessionId,
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.mintSessionId ? { mintSessionId: input.mintSessionId } : {}),
    ...(input.now ? { now: input.now } : {}),
  }).outcome

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

  const fragment = outcome.output
  const unresolved = [...(fragment.unresolved ?? [])]
  if (fragment.interfaces.length === 0) {
    return { place: { ...base, status: 'empty', taskIds: [], unresolved, problems: [] } }
  }

  const validation = validateFragment({ derived, authored, fragment, replaceable, scope })
  if (!validation.ok) {
    // The session had `check_draft` and either never called it or ignored it.
    // The fragment is dropped whole: half a place's tasks is not a place.
    return {
      place: { ...base, status: 'rejected', taskIds: [], unresolved, problems: validation.errors },
    }
  }
  return {
    place: {
      ...base,
      status: 'authored',
      taskIds: fragment.interfaces.map((task) => task.id),
      unresolved,
      problems: [],
    },
    candidate: validation.authored ?? candidateAuthored(authored, stampFragment(fragment), replaceable),
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
