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
 *  - a ledger row is work again when the screen's input digest MOVED, or one
 *    of the source files its session was grounded on changed, or (when the
 *    caller knows the current grounding) a file joined or left that set —
 *    whatever the row's status. A settled screen re-opened this way is RECONCILED against
 *    the tasks it already has (kept, amended, retired), never re-invented;
 *  - otherwise it is not: a settled row stays settled, and a `failed` or
 *    `rejected` one waits for an explicit refresh. A provider that died costs
 *    that screen one run, not one run every setup forever, and the setup report
 *    names it so a person can ask for a retry;
 *  - NO row is a screen from before the ledger: it is judged ONCE by the old
 *    inference (it carries a task and every readable kind is established) so an
 *    upgrade re-authors nothing, and the run writes it a row.
 */

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  isRootPlace,
  rootPlaceOf,
  type Interface,
  type InterfaceAuthoringRecord,
  type InterfaceResource,
  type InterfacesFile,
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
export const INTERFACE_AUTHOR_STAGE_VERSION = 5

/**
 * One screen — or one shared component, the other place authoring owes a
 * session — what authoring has settled on it, and what it would run over.
 */
export interface WebScreenAuthoringState {
  place: InterfaceResource
  /** Ids of the authored tasks located on this screen (directly or nested). */
  tasks: string[]
  /** The ledger's row, when this screen has one. */
  record?: InterfaceAuthoringRecord
  /** The digest a session for this screen would run over — its cache key too. */
  inputFingerprint: string
  /** A session is owed here: no settled row, or a row whose inputs or sources moved. */
  needsAuthoring: boolean
}

export interface WebScreenAuthoringInput {
  /** The derived snapshot (`guard/interfaces.json`), or null when none exists. */
  derived: InterfacesFile | null
  /** The authored half as it stands on disk, or null when nothing is authored. */
  authored: InterfacesFile | null
  /** The recipe CONTRACT the tasks would be authored against. */
  recipeContract: string
  /**
   * The working tree, when the caller has one: a row's recorded source files
   * are re-read against it. Absent ⇒ only the input digest is compared.
   */
  repoRoot?: string
  /**
   * The files each place is grounded on NOW (its route module and what it
   * renders), when the caller derived them. With it (and `repoRoot`), a row is
   * work again when the file SET it recorded differs from this one — a module
   * moved into or out of the place's grounding, as when a component becomes
   * shared and leaves every screen that rendered it — or a digest moved. A place
   * the map does not name is grounded on nothing. Without it, only the files the
   * row recorded are re-read.
   */
  grounding?: ReadonlyMap<string, readonly string[]>
}

/**
 * Every SCREEN and every shared COMPONENT both catalog halves know (the root
 * places, {@link isRootPlace}), in catalog order, with what authoring has
 * settled on it. It writes nothing, and reads the tree only for the source files
 * a row recorded (when `repoRoot` is given).
 */
export function webScreenAuthoringStates(
  input: WebScreenAuthoringInput,
): WebScreenAuthoringState[] {
  const places = placeIndex(input.derived, input.authored)
  const roots = [...places.values()].filter(isRootPlace)
  const screens = roots.filter((place) => place.kind === 'screen')
  const located = new Map<string, string[]>()
  for (const task of input.authored?.interfaces ?? []) {
    if (task.type !== AUTHORED_SURFACE) continue
    const screen = task.at ? rootPlaceOf(task.at, places)?.id : screenAt(routeOf(task), screens)
    if (!screen) continue
    located.set(screen, [...(located.get(screen) ?? []), task.id])
  }
  const unestablished = webScreensNeedingReadables(input.derived, input.authored)
  const ledger = input.authored?.authoring ?? {}
  const derivedPlaces = derivedPlaceIndex(input.derived)

  return roots.map((place) => {
    const record = ledger[place.id]
    const inputFingerprint = fingerprintOf(derivedPlaces, place, input.recipeContract)
    return {
      place,
      tasks: located.get(place.id) ?? [],
      ...(record ? { record } : {}),
      inputFingerprint,
      needsAuthoring: record
        ? record.inputFingerprint !== inputFingerprint ||
          (input.repoRoot !== undefined &&
            sourcesMoved(input.repoRoot, record.sources, input.grounding && (input.grounding.get(place.id) ?? [])))
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

/** What a file that cannot be read records in place of a digest. */
const MISSING_SOURCE = 'missing'

/**
 * Each repo-relative file's content digest, the way a ledger row records the
 * source a session was grounded on. A file that cannot be read is recorded as
 * missing, so its reappearance moves the row too.
 */
export function sourceDigests(repoRoot: string, files: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const file of [...new Set(files)].sort()) {
    try {
      out[file] = crypto.createHash('sha256').update(fs.readFileSync(path.join(repoRoot, file))).digest('hex').slice(0, 16)
    } catch {
      out[file] = MISSING_SOURCE
    }
  }
  return out
}

/**
 * Whether a row's grounding moved: with `current` (the files the place is
 * grounded on now), whether that set of files and their digests differs from
 * the recorded one; without it, whether any recorded file reads differently
 * now. No record against no current file moves nothing.
 */
export function sourcesMoved(
  repoRoot: string,
  sources: Readonly<Record<string, string>> | undefined,
  current?: readonly string[],
): boolean {
  const recorded = sources ?? {}
  const now = sourceDigests(repoRoot, current ?? Object.keys(recorded))
  const files = Object.keys(now)
  return files.length !== Object.keys(recorded).length || files.some((file) => recorded[file] !== now[file])
}

/** A row that never reached an accepted outcome — the two retryable words. */
export function unsettledAuthoring(record: InterfaceAuthoringRecord): boolean {
  return record.status === 'failed' || record.status === 'rejected'
}

/**
 * THE PER-SCREEN INPUT DIGEST — what decides whether a session for this screen
 * would produce something else, and therefore both when a screen is re-opened
 * and (with its sources) what its cached fragment is keyed on. Four inputs, and the reasons the
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
 * And the screen's SOURCE is kept beside it rather than in it: the files are
 * only known once the analyzer grounds the place, so the row records them with
 * their digests ({@link sourceDigests}) and the check re-reads just those.
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
    .filter((candidate) => candidate.id !== own.id && rootPlaceOf(candidate.id, derived)?.id === own.id)
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
