/**
 * WHICH SCREENS AUTHORING OWES WORK — the read side of the authoring ledger
 * (`interfaces.authored.json`'s `authoring` map), and the per-screen input
 * digest that decides when a screen is work again.
 *
 * It lives here, beside the catalog readers, because three callers on three
 * sides of the dependency graph need the same answer and none of them may
 * import the others: the authoring run itself, the setup step's zero-work gate,
 * and the pre-flight estimate that quotes the bill before either runs.
 *
 * THE RULE, per screen:
 *
 *  - a ledger row saying `authored` or `empty` is SETTLED — the session reached
 *    an outcome the write path accepted, and nothing re-opens it but an explicit
 *    re-author;
 *  - a row saying `failed` or `rejected` is work again only when the screen's
 *    input digest MOVED. A provider that died costs that screen one run, not
 *    one run every setup forever, and the setup report names it so a person can
 *    ask for a retry;
 *  - NO row is a screen from before the ledger: it is judged ONCE by the old
 *    inference (it carries a task and every readable kind is established) so an
 *    upgrade re-authors nothing, and the run writes it a row.
 */

import crypto from 'node:crypto'
import type {
  Interface,
  InterfaceAuthoringRecord,
  InterfaceResource,
  InterfacesFile,
} from '@truecourse/shared'
import { staleAuthoredPlaceDiagnostics, webScreensNeedingReadables } from './store.js'

/** The surface authoring writes — the one nothing derives. */
const AUTHORED_SURFACE = 'web'

/**
 * THE AUTHORING STAGE'S VERSION, bumped by hand. Rewording the prompt does not
 * make a screen's authored tasks wrong; a prompt change that fixes WRONG output
 * bumps this in the same commit, which re-opens every screen and re-keys every
 * cached fragment.
 */
export const INTERFACE_AUTHOR_STAGE_VERSION = 1

/** One screen, what authoring has settled on it, and what it would run over. */
export interface WebScreenAuthoringState {
  place: InterfaceResource
  /** Ids of the authored tasks located on this screen (directly or nested). */
  tasks: string[]
  /** The ledger's row, when this screen has one. */
  record?: InterfaceAuthoringRecord
  /** The digest a session for this screen would run over — its cache key too. */
  inputFingerprint: string
  /** A session is owed here: no settled row, or a failed one whose inputs moved. */
  needsAuthoring: boolean
}

export interface WebScreenAuthoringInput {
  /** The derived snapshot (`guard/interfaces.json`), or null when none exists. */
  derived: InterfacesFile | null
  /** The authored half as it stands on disk, or null when nothing is authored. */
  authored: InterfacesFile | null
  /** The recipe CONTRACT the tasks would be authored against. */
  recipeContract: string
}

/**
 * Every SCREEN both catalog halves know, in catalog order, with what authoring
 * has settled on it. Pure: it reads no tree and writes nothing.
 */
export function webScreenAuthoringStates(
  input: WebScreenAuthoringInput,
): WebScreenAuthoringState[] {
  const places = placeIndex(input.derived, input.authored)
  const screens = [...places.values()].filter((place) => place.kind === 'screen')
  const located = new Map<string, string[]>()
  for (const task of input.authored?.interfaces ?? []) {
    if (task.type !== AUTHORED_SURFACE) continue
    const screen = task.at ? screenOf(task.at, places) : screenAt(routeOf(task), screens)
    if (!screen) continue
    located.set(screen, [...(located.get(screen) ?? []), task.id])
  }
  const unestablished = webScreensNeedingReadables(input.derived, input.authored)
  const ledger = input.authored?.authoring ?? {}
  const derivedPlaces = derivedPlaceIndex(input.derived)

  return screens.map((place) => {
    const record = ledger[place.id]
    const inputFingerprint = fingerprintOf(derivedPlaces, place, input.recipeContract)
    return {
      place,
      tasks: located.get(place.id) ?? [],
      ...(record ? { record } : {}),
      inputFingerprint,
      needsAuthoring: record
        ? unsettledAuthoring(record) && record.inputFingerprint !== inputFingerprint
        : // The old inference, for a screen written before the ledger: a screen
          // that carries a task and has every readable kind established is what
          // a settled session leaves behind, so it is not re-bought.
          unestablished.has(place.id) ||
          (!located.has(place.id) &&
            !input.authored?.resources?.[AUTHORED_SURFACE]?.some(
              (candidate) => candidate.id === place.id && candidate.readables,
            )),
    }
  })
}

/** A row that never reached an accepted outcome — the two retryable words. */
export function unsettledAuthoring(record: InterfaceAuthoringRecord): boolean {
  return record.status === 'failed' || record.status === 'rejected'
}

/**
 * THE PER-SCREEN INPUT DIGEST — what decides whether a session for this screen
 * would produce something else, and therefore both when a failed screen retries
 * and what its cached fragment is keyed on. Four inputs, and the reasons the
 * rest are left out matter as much as the four:
 *
 *  - the STAGE VERSION, so a prompt fix that changes what a session should say
 *    re-opens every screen by hand;
 *  - the RECIPE CONTRACT, the promise the tasks are authored against (it also
 *    keeps two repositories of one workspace from sharing a cache entry for a
 *    screen they happen to name alike);
 *  - the DERIVED place itself — its address, its kind, its title, the facts the
 *    briefing states about it;
 *  - the DERIVED places nested on it, which the briefing states beside it.
 *
 * What a session is shown about its OWN prior output — the tasks it authored
 * there, the readables it established — is deliberately absent: folding it
 * would move the digest the moment the session wrote, and every screen would be
 * work again forever. The peer-wide context (every screen's address, the state
 * registry) is absent for the neighbouring reason: it moves whenever ANY screen
 * is authored, which would re-key every screen for a change to somebody else.
 * And the screen's SOURCE is absent because it is not what re-opens the step —
 * the step's own key is the derived place set plus the contract — so folding it
 * here would promise a retry no run ever performs.
 */
export function screenAuthoringFingerprint(input: {
  derived: InterfacesFile | null
  place: InterfaceResource
  recipeContract: string
}): string {
  return fingerprintOf(derivedPlaceIndex(input.derived), input.place, input.recipeContract)
}

function fingerprintOf(
  derived: ReadonlyMap<string, InterfaceResource>,
  place: InterfaceResource,
  recipeContract: string,
): string {
  const own = derived.get(place.id) ?? place
  const nested = [...derived.values()]
    .filter((candidate) => candidate.id !== own.id && screenOf(candidate.id, derived) === own.id)
    .sort((a, b) => a.id.localeCompare(b.id))
  const material = {
    stage: `interface-author-v${INTERFACE_AUTHOR_STAGE_VERSION}`,
    recipeContract,
    places: [own, ...nested].map(placeMaterial),
  }
  return crypto.createHash('sha256').update(JSON.stringify(material)).digest('hex')
}

/** One place in fixed field order — never the file's own key order. */
function placeMaterial(place: InterfaceResource): readonly string[] {
  return [place.id, place.kind, place.title, place.address ?? '', place.of ?? '', place.description ?? '']
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

function derivedPlaceIndex(derived: InterfacesFile | null): Map<string, InterfaceResource> {
  return new Map((derived?.resources?.[AUTHORED_SURFACE] ?? []).map((place) => [place.id, place]))
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
function routeOf(task: Pick<Interface, 'steps' | 'entry'>): string | undefined {
  const first = task.steps[0]
  if (first?.kind === 'navigate') return first.route
  return 'path' in task.entry ? task.entry.path : undefined
}

function screenAt(address: string | undefined, screens: readonly InterfaceResource[]): string | undefined {
  if (!address) return undefined
  return screens.find((screen) => screen.address === address)?.id
}

/**
 * The screens a run would author, ledger-aware: everything owed work, minus the
 * authored screens no derivation backs any more (a session on an address nobody
 * can stand at is a session wasted — the authoring run's own stale-place rule).
 */
export function webScreensNeedingAuthoring(input: WebScreenAuthoringInput): Set<string> {
  const stale = new Set(
    staleAuthoredPlaceDiagnostics(input.derived, input.authored).map((d) => d.subject),
  )
  return new Set(
    webScreenAuthoringStates(input)
      .filter((state) => state.needsAuthoring && !stale.has(state.place.id))
      .map((state) => state.place.id),
  )
}
