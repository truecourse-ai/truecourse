/**
 * THE WRITE — the one place a session's work reaches disk.
 *
 * `guard/interfaces.authored.json` is COMMITTED, hand-owned, and the only home
 * of the surfaces no derivation produces. Nothing re-derives it, so this write
 * is held to the rule the derived snapshot is not: it never replaces the file,
 * it lays a validated fragment over it by id, and an entry it was not asked to
 * replace comes through untouched. A run interrupted after three places leaves
 * three places authored and the rest of the file exactly as it was.
 */

import { atomicWriteJson, guardAuthoredInterfacesPath } from '@truecourse/guard-runner'
import {
  InterfacesFragmentSchema,
  type InterfaceAuthoringRecord,
  type InterfaceResource,
  type InterfacesFile,
} from '@truecourse/shared'
import type { SharedComponent } from './shared-places.js'

export interface WriteAuthoredInput {
  repoRoot: string
  /** The file the fragment produced — {@link candidateAuthored}'s output. */
  candidate: InterfacesFile
  /** The derived snapshot, for the envelope's recipe fingerprint. */
  derived: InterfacesFile | null
  now?: () => string
}

/**
 * Stamp the envelope and write. The envelope is the AUTHORING run's: this file
 * is not a mapping, so `generatedAt` dates the authoring and the recipe
 * fingerprint is carried from the derivation the authoring read (the merge
 * prefers the derived envelope anyway — this keeps the file self-describing
 * rather than blank).
 */
export function writeAuthoredCatalog(input: WriteAuthoredInput): { path: string; file: InterfacesFile } {
  const now = input.now ?? (() => new Date().toISOString())
  const file: InterfacesFile = {
    ...input.candidate,
    generatedAt: now(),
    recipeFingerprint: input.derived?.recipeFingerprint || input.candidate.recipeFingerprint || '',
  }
  // Shape, not cross-references: this file is HALF a catalog, and its `at`/`to`
  // ids resolve against the merge (see `InterfacesFragmentSchema`). The
  // references were already checked against the merged catalog by
  // `validateFragment` — checking them again here, against half a catalog,
  // would refuse every task that stands on a derived place.
  const parsed = InterfacesFragmentSchema.safeParse(file)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new Error(
      `refusing to write ${guardAuthoredInterfacesPath(input.repoRoot)}: ${
        issue ? `${issue.path.join('.')} — ${issue.message}` : 'schema validation failed'
      }`,
    )
  }
  const path = guardAuthoredInterfacesPath(input.repoRoot)
  atomicWriteJson(path, parsed.data)
  return { path, file: parsed.data }
}

export interface RecordAuthoringLedgerInput {
  repoRoot: string
  /** The authored file as it stands; null when nothing has been authored yet. */
  authored: InterfacesFile | null
  /** The derived snapshot, for the envelope's recipe fingerprint. */
  derived: InterfacesFile | null
  /** The rows to lay over the ledger, by screen id. */
  rows: Readonly<Record<string, InterfaceAuthoringRecord>>
  now?: () => string
}

/**
 * Record what authoring settled on one or more screens. Laid over the existing
 * ledger by id and written through the same validated path the fragments take,
 * so a row lands whether or not the session that produced it wrote a task — a
 * screen whose session failed has nothing else to leave behind, and the row IS
 * what keeps the next run from buying that failure again.
 */
export function recordAuthoringLedger(
  input: RecordAuthoringLedgerInput,
): { path: string; file: InterfacesFile } {
  const base: InterfacesFile = input.authored ?? {
    version: 2,
    generatedAt: '',
    recipeFingerprint: '',
    interfaces: [],
  }
  return writeAuthoredCatalog({
    repoRoot: input.repoRoot,
    derived: input.derived,
    candidate: { ...base, authoring: { ...base.authoring, ...input.rows } },
    ...(input.now ? { now: input.now } : {}),
  })
}

export interface RegisterSharedPlacesInput {
  repoRoot: string
  authored: InterfacesFile | null
  derived: InterfacesFile | null
  components: readonly SharedComponent[]
  now?: () => string
}

/**
 * Put every shared component in the authored catalog as a `component` place:
 * its id, its name, and the module it is rendered from. A place already there
 * keeps everything else it carries (its readables above all); nothing is
 * written when every place already stands as it would. `undefined` ⇒ no write.
 */
export function registerSharedPlaces(input: RegisterSharedPlacesInput): { path: string; file: InterfacesFile } | undefined {
  const existing = new Map((input.authored?.resources?.web ?? []).map((place) => [place.id, place]))
  const registered = input.components.map((component): InterfaceResource => ({
    ...existing.get(component.id),
    id: component.id,
    kind: 'component',
    title: component.title,
    description: `shared UI rendered from ${component.module}`,
  }))
  const changed = registered.filter((place) => JSON.stringify(place) !== JSON.stringify(existing.get(place.id)))
  if (changed.length === 0) return undefined
  const base: InterfacesFile = input.authored ?? { version: 2, generatedAt: '', recipeFingerprint: '', interfaces: [] }
  const byId = new Map(changed.map((place) => [place.id, place]))
  const web = (base.resources?.web ?? []).map((place) => byId.get(place.id) ?? place)
  for (const place of changed) if (!existing.has(place.id)) web.push(place)
  return writeAuthoredCatalog({
    repoRoot: input.repoRoot,
    derived: input.derived,
    candidate: { ...base, resources: { ...base.resources, web } },
    ...(input.now ? { now: input.now } : {}),
  })
}
